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

    // Get candidate (incoming, non-deleted) messages, then filter out the ones
    // this user has already acknowledged. PostgREST's `in` takes a literal
    // value list, NOT a SQL subquery — the previous inline subquery string
    // never executed and left the "unread only" filter ineffective, so it
    // re-upserted up to 500 receipts on every call.
    const { data: candidateMessages, error: msgError } = await supabase
      .from("messages")
      .select("id")
      .eq("conversation_id", params.id)
      .eq("is_deleted", false)
      .neq("sender_id", auth.sub)
      .order("created_at", { ascending: false })
      .limit(500);

    if (msgError) {
      return NextResponse.json(
        { error: "Failed to load messages" },
        { status: 500, headers }
      );
    }

    const candidateIds = (candidateMessages || []).map((m) => m.id);

    let alreadyReadIds = new Set<string>();
    if (candidateIds.length > 0) {
      const { data: existingReceipts } = await supabase
        .from("message_read_receipts")
        .select("message_id")
        .eq("user_id", auth.sub)
        .in("message_id", candidateIds);
      alreadyReadIds = new Set((existingReceipts || []).map((r) => r.message_id));
    }

    const unreadMessages = (candidateMessages || []).filter(
      (m) => !alreadyReadIds.has(m.id)
    );

    if (unreadMessages.length > 0) {
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
      { message: "Marked as read", read_count: unreadMessages.length },
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
