import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { SendMessageSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

// GET /api/conversations/:id/messages - Get messages (paginated)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const auth = await authenticateAny(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    const userId = getUserId(auth);

    // Check membership (skip for service auth)
    if (userId) {
      const { data: membership } = await supabase
        .from("conversation_members")
        .select("role")
        .eq("conversation_id", params.id)
        .eq("user_id", userId)
        .single();

      if (!membership) {
        return NextResponse.json(
          { error: "Not a member of this conversation" },
          { status: 403, headers }
        );
      }
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const before = searchParams.get("before"); // cursor: timestamp
    const messageType = searchParams.get("type"); // filter by message_type

    let query = supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", params.id)
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    if (messageType) {
      query = query.eq("message_type", messageType);
    }

    const { data: messages, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch messages" },
        { status: 500, headers }
      );
    }

    // Enrich with sender profiles
    const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
    const profiles = await getChatUsers(senderIds);

    // Get reaction counts per message
    const messageIds = (messages || []).map((m) => m.id);
    let reactionCounts = new Map<string, Record<string, number>>();
    let readByCounts = new Map<string, number>();

    if (messageIds.length > 0) {
      const { data: reactions } = await supabase
        .from("message_reactions")
        .select("message_id, emoji")
        .in("message_id", messageIds);

      for (const r of reactions || []) {
        const existing = reactionCounts.get(r.message_id) || {};
        existing[r.emoji] = (existing[r.emoji] || 0) + 1;
        reactionCounts.set(r.message_id, existing);
      }

      const { data: readReceipts } = await supabase
        .from("message_read_receipts")
        .select("message_id")
        .in("message_id", messageIds);

      for (const r of readReceipts || []) {
        readByCounts.set(r.message_id, (readByCounts.get(r.message_id) || 0) + 1);
      }
    }

    const enriched = (messages || []).map((msg) => ({
      ...msg,
      sender: profiles.get(msg.sender_id) || null,
      reactions: reactionCounts.get(msg.id) || {},
      read_by_count: readByCounts.get(msg.id) || 0,
    }));

    return NextResponse.json(
      {
        messages: enriched.reverse(), // oldest first
        has_more: (messages || []).length === limit,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Get messages error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// POST /api/conversations/:id/messages - Send message
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const auth = await authenticateAny(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    const userId = getUserId(auth);
    if (!userId) {
      return NextResponse.json(
        { error: "Cannot send messages with service auth" },
        { status: 400, headers }
      );
    }

    // Check membership
    const { data: membership } = await supabase
      .from("conversation_members")
      .select("role, permissions")
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .single();

    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this conversation" },
        { status: 403, headers }
      );
    }

    // Check announcement-only restriction
    const { data: conversation } = await supabase
      .from("conversations")
      .select("is_announcement_only")
      .eq("id", params.id)
      .single();

    if (
      conversation?.is_announcement_only &&
      !["owner", "admin"].includes(membership.role)
    ) {
      return NextResponse.json(
        { error: "Only admins can post in announcement-only conversations" },
        { status: 403, headers }
      );
    }

    // Check permissions for restricted types
    if (
      membership.permissions?.can_send_messages === false &&
      !["owner", "admin", "moderator"].includes(membership.role)
    ) {
      return NextResponse.json(
        { error: "You do not have permission to send messages" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const parsed = SendMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const {
      content, message_type, rich_content, attachments, metadata, reply_to,
      encrypted_content, encryption_metadata, is_encrypted,
    } = parsed.data;

    // AI keyword check
    let aiFlagged = false;
    if (content) {
      const { data: keywords } = await supabase
        .from("ai_flag_keywords")
        .select("keyword")
        .eq("is_active", true);

      if (keywords && keywords.length > 0) {
        const lowerContent = content.toLowerCase();
        aiFlagged = keywords.some((k) =>
          lowerContent.includes(k.keyword.toLowerCase())
        );
      }
    }

    // Create message (with E2EE fields if provided)
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: params.id,
        sender_id: userId,
        content: is_encrypted ? "[encrypted]" : (content || null),
        message_type,
        rich_content: rich_content || null,
        attachments: attachments || [],
        metadata: metadata || {},
        reply_to: reply_to || null,
        status: "sent",
        ai_flagged: aiFlagged,
        is_encrypted: is_encrypted || false,
        encrypted_content: encrypted_content || null,
        encryption_metadata: encryption_metadata || null,
      })
      .select()
      .single();

    if (msgError || !message) {
      console.error("Send message error:", msgError);
      return NextResponse.json(
        { error: "Failed to send message" },
        { status: 500, headers }
      );
    }

    // Update sender's last_read_at and reset their unread count
    await supabase
      .from("conversation_members")
      .update({
        last_read_at: new Date().toISOString(),
        unread_count: 0,
      })
      .eq("conversation_id", params.id)
      .eq("user_id", userId);

    return NextResponse.json({ message }, { status: 201, headers });
  } catch (err: any) {
    console.error("Send message error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
