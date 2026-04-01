import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// GET /api/unread-count - Get total unread message count with per-conversation breakdown
export async function GET(request: NextRequest) {
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

    // Get all conversations with unread counts from denormalized field
    const { data: memberships } = await supabase
      .from("conversation_members")
      .select("conversation_id, unread_count")
      .eq("user_id", auth.sub);

    if (!memberships || memberships.length === 0) {
      return NextResponse.json(
        { total_unread: 0, conversations: [] },
        { status: 200, headers }
      );
    }

    let totalUnread = 0;
    const unreadConvIds: string[] = [];

    for (const m of memberships) {
      if (m.unread_count > 0) {
        totalUnread += m.unread_count;
        unreadConvIds.push(m.conversation_id);
      }
    }

    // Fetch conversation details for ones with unreads
    let conversations: any[] = [];
    if (unreadConvIds.length > 0) {
      const { data: convData } = await supabase
        .from("conversations")
        .select("id, type, name, last_message_content, last_message_at, last_message_type")
        .in("id", unreadConvIds)
        .eq("status", "active");

      const membershipMap = new Map(
        memberships.map((m) => [m.conversation_id, m.unread_count])
      );

      conversations = (convData || []).map((conv) => ({
        conversation_id: conv.id,
        type: conv.type,
        name: conv.name,
        unread_count: membershipMap.get(conv.id) || 0,
        last_message: conv.last_message_content,
        last_message_at: conv.last_message_at,
        last_message_type: conv.last_message_type,
      }));
    }

    return NextResponse.json(
      {
        total_unread: totalUnread,
        conversations,
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Unread count error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
