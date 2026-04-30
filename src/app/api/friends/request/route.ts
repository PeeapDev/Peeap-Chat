/**
 * Friend Requests API
 *
 * POST /api/friends/request  — Send a friend request
 * GET  /api/friends/request  — List incoming + outgoing pending requests
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, handleCORS } from "@/lib/cors";
import { authenticateRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";

export async function OPTIONS(req: NextRequest) {
  return handleCORS(req) || NextResponse.json({});
}

// POST /api/friends/request — send a friend request
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  let body: { receiver_id?: string; message?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers });
  }

  const { receiver_id, message } = body;
  if (!receiver_id) {
    return NextResponse.json({ error: "receiver_id is required" }, { status: 400, headers });
  }

  if (receiver_id === auth.sub) {
    return NextResponse.json({ error: "Cannot send friend request to yourself" }, { status: 400, headers });
  }

  // Check if already friends
  const { data: existing } = await supabase
    .from("contacts")
    .select("id")
    .eq("user_id", auth.sub)
    .eq("contact_user_id", receiver_id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Already friends" }, { status: 409, headers });
  }

  // Check for existing pending request (either direction)
  const { data: pendingReq } = await supabase
    .from("friend_requests")
    .select("id, sender_id, status")
    .or(`and(sender_id.eq.${auth.sub},receiver_id.eq.${receiver_id}),and(sender_id.eq.${receiver_id},receiver_id.eq.${auth.sub})`)
    .eq("status", "pending")
    .maybeSingle();

  if (pendingReq) {
    // If they already sent us a request, auto-accept it
    if (pendingReq.sender_id === receiver_id) {
      const { error: acceptErr } = await supabase.rpc("accept_friend_request", {
        request_id: pendingReq.id,
        current_user_id: auth.sub,
      });

      if (acceptErr) {
        console.error("[FriendRequest] Auto-accept error:", acceptErr);
        return NextResponse.json({ error: "Failed to accept mutual request" }, { status: 500, headers });
      }

      return NextResponse.json({ status: "accepted", message: "They already sent you a request — you are now friends!" }, { headers });
    }

    return NextResponse.json({ error: "Friend request already sent" }, { status: 409, headers });
  }

  // Create the request
  const { data: request, error } = await supabase
    .from("friend_requests")
    .insert({
      sender_id: auth.sub,
      receiver_id,
      message: (message || "").slice(0, 200),
    })
    .select()
    .single();

  if (error) {
    console.error("[FriendRequest] Create error:", error);
    return NextResponse.json({ error: "Failed to send friend request" }, { status: 500, headers });
  }

  return NextResponse.json({ request }, { status: 201, headers });
}

// GET /api/friends/request — list pending requests
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  // Incoming requests (sent to me)
  const { data: incoming, error: inErr } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("receiver_id", auth.sub)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  // Outgoing requests (sent by me)
  const { data: outgoing, error: outErr } = await supabase
    .from("friend_requests")
    .select("*")
    .eq("sender_id", auth.sub)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (inErr || outErr) {
    console.error("[FriendRequest] List error:", inErr, outErr);
    return NextResponse.json({ error: "Failed to load requests" }, { status: 500, headers });
  }

  // Enrich with profiles
  const allUserIds = [
    ...(incoming || []).map((r) => r.sender_id),
    ...(outgoing || []).map((r) => r.receiver_id),
  ];
  const profiles = allUserIds.length > 0 ? await getChatUsers(allUserIds) : new Map();

  const enrichedIncoming = (incoming || []).map((r) => ({
    ...r,
    sender: profiles.get(r.sender_id) || null,
  }));

  const enrichedOutgoing = (outgoing || []).map((r) => ({
    ...r,
    receiver: profiles.get(r.receiver_id) || null,
  }));

  return NextResponse.json({
    incoming: enrichedIncoming,
    outgoing: enrichedOutgoing,
    incoming_count: enrichedIncoming.length,
  }, { headers });
}
