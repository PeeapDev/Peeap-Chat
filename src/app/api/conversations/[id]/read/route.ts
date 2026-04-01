import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// PUT /api/conversations/:id/read - Mark conversation as read
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const auth = await authenticateRequest(request);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers }
      );
    }

    const now = new Date().toISOString();

    // Update last_read_at and reset unread_count
    const { error: updateError } = await supabase
      .from("conversation_members")
      .update({ last_read_at: now, unread_count: 0 })
      .eq("conversation_id", params.id)
      .eq("user_id", auth.sub);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to mark as read" },
        { status: 500, headers }
      );
    }

    // Batch insert read receipts for unread messages
    const { data: membership } = await supabase
      .from("conversation_members")
      .select("last_read_at")
      .eq("conversation_id", params.id)
      .eq("user_id", auth.sub)
      .single();

    // Get messages that haven't been read by this user
    const { data: unreadMessages } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", params.id)
      .eq("is_deleted", false)
      .neq("sender_id", auth.sub)
      .not("id", "in", `(SELECT message_id FROM message_read_receipts WHERE user_id = '${auth.sub}')`)
      .limit(500);

    if (unreadMessages && unreadMessages.length > 0) {
      const receipts = unreadMessages.map((m) => ({
        message_id: m.id,
        user_id: auth.sub,
        read_at: now,
      }));

      // Insert in batches to avoid payload limits
      const BATCH_SIZE = 100;
      for (let i = 0; i < receipts.length; i += BATCH_SIZE) {
        const batch = receipts.slice(i, i + BATCH_SIZE);
        await supabase
          .from("message_read_receipts")
          .upsert(batch, { onConflict: "message_id,user_id" });
      }
    }

    return NextResponse.json(
      { message: "Marked as read", read_count: unreadMessages?.length || 0 },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Mark read error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
