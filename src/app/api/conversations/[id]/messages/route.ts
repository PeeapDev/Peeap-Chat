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

let keywordCache: { values: string[]; loadedAt: number } | null = null;
const KEYWORD_CACHE_MS = 5 * 60 * 1000;

async function getFlagKeywords(): Promise<string[]> {
  if (keywordCache && Date.now() - keywordCache.loadedAt < KEYWORD_CACHE_MS) {
    return keywordCache.values;
  }
  const { data } = await supabase
    .from("ai_flag_keywords")
    .select("keyword")
    .eq("is_active", true);
  const values = (data || []).map((row) => String(row.keyword).toLowerCase());
  keywordCache = { values, loadedAt: Date.now() };
  return values;
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

    // Enrich with sender profiles, reactions and receipts concurrently. These
    // were three serial database round trips on every polling refresh.
    const senderIds = [...new Set((messages || []).map((m) => m.sender_id))];
    const messageIds = (messages || []).map((m) => m.id);
    let reactionCounts = new Map<string, Record<string, number>>();
    let readByCounts = new Map<string, number>();

    const [profiles, reactionsResult, receiptsResult] = await Promise.all([
      getChatUsers(senderIds),
      messageIds.length > 0
        ? supabase.from("message_reactions").select("message_id, emoji").in("message_id", messageIds)
        : Promise.resolve({ data: [] as Array<{ message_id: string; emoji: string }> }),
      messageIds.length > 0
        ? supabase.from("message_read_receipts").select("message_id").in("message_id", messageIds)
        : Promise.resolve({ data: [] as Array<{ message_id: string }> }),
    ]);

      for (const r of reactionsResult.data || []) {
        const existing = reactionCounts.get(r.message_id) || {};
        existing[r.emoji] = (existing[r.emoji] || 0) + 1;
        reactionCounts.set(r.message_id, existing);
      }

      for (const r of receiptsResult.data || []) {
        readByCounts.set(r.message_id, (readByCounts.get(r.message_id) || 0) + 1);
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

    // Membership and conversation policy are independent reads.
    const [membershipResult, conversationResult] = await Promise.all([
      supabase.from("conversation_members")
        .select("role, permissions")
        .eq("conversation_id", params.id)
        .eq("user_id", userId)
        .single(),
      supabase.from("conversations")
        .select("is_announcement_only")
        .eq("id", params.id)
        .single(),
    ]);
    const membership = membershipResult.data;

    if (!membership) {
      return NextResponse.json(
        { error: "Not a member of this conversation" },
        { status: 403, headers }
      );
    }

    // Check announcement-only restriction
    const conversation = conversationResult.data;

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
      const keywords = await getFlagKeywords();
      if (keywords.length > 0) {
        const lowerContent = content.toLowerCase();
        aiFlagged = keywords.some((keyword) => lowerContent.includes(keyword));
      }
    }

    // Create message (with E2EE fields if provided)
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: params.id,
        sender_id: userId,
        // Encrypted messages may include a plaintext delivery fallback for
        // multi-device accounts whose local key no longer matches the latest
        // published key. Older clients omit it and retain the old placeholder.
        content: content || (is_encrypted ? "[encrypted]" : null),
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
