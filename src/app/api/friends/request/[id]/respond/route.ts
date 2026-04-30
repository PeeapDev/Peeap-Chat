/**
 * Friend Request Respond API
 *
 * POST /api/friends/request/[id]/respond
 *   Body: { action: "accept" | "reject" }
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, handleCORS } from "@/lib/cors";
import { authenticateRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

export async function OPTIONS(req: NextRequest) {
  return handleCORS(req) || NextResponse.json({});
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const { id: requestId } = await params;

  let body: { action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }

  const { action } = body;
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400, headers });
  }

  if (action === "accept") {
    // Use the RPC function for atomic accept (updates request + inserts bidirectional contacts)
    const { error } = await supabase.rpc("accept_friend_request", {
      request_id: requestId,
      current_user_id: auth.sub,
    });

    if (error) {
      console.error("[FriendRequest] Accept error:", error);
      const msg = error.message?.includes("Not authorized")
        ? "Not authorized"
        : error.message?.includes("no longer pending")
          ? "Request already handled"
          : "Failed to accept request";
      return NextResponse.json({ error: msg }, { status: 400, headers });
    }

    return NextResponse.json({ status: "accepted" }, { headers });
  }

  // Reject
  const { data: request, error: fetchErr } = await supabase
    .from("friend_requests")
    .select("receiver_id, status")
    .eq("id", requestId)
    .single();

  if (fetchErr || !request) {
    return NextResponse.json({ error: "Request not found" }, { status: 404, headers });
  }

  if (request.receiver_id !== auth.sub) {
    return NextResponse.json({ error: "Not authorized" }, { status: 403, headers });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "Request already handled" }, { status: 400, headers });
  }

  const { error: rejectErr } = await supabase
    .from("friend_requests")
    .update({ status: "rejected", responded_at: new Date().toISOString() })
    .eq("id", requestId);

  if (rejectErr) {
    console.error("[FriendRequest] Reject error:", rejectErr);
    return NextResponse.json({ error: "Failed to reject request" }, { status: 500, headers });
  }

  return NextResponse.json({ status: "rejected" }, { headers });
}
