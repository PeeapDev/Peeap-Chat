/**
 * Friends API
 *
 * GET  /api/friends         — List my friends (accepted contacts)
 * DELETE /api/friends?userId=<id>  — Remove a friend (deletes both contact rows)
 */

import { NextRequest, NextResponse } from "next/server";
import { corsHeaders, handleCORS } from "@/lib/cors";
import { authenticateRequest } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";

export async function OPTIONS(req: NextRequest) {
  return handleCORS(req) || NextResponse.json({});
}

// GET /api/friends — list my friends
export async function GET(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const { data: contacts, error } = await supabase
    .from("contacts")
    .select("*")
    .eq("user_id", auth.sub)
    .eq("is_blocked", false)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[Friends] List error:", error);
    return NextResponse.json({ error: "Failed to load friends" }, { status: 500, headers });
  }

  // Enrich with user profiles
  const contactUserIds = (contacts || []).map((c) => c.contact_user_id);
  const profiles = contactUserIds.length > 0 ? await getChatUsers(contactUserIds) : new Map();

  const friends = (contacts || []).map((c) => ({
    ...c,
    profile: profiles.get(c.contact_user_id) || null,
  }));

  return NextResponse.json({ friends }, { headers });
}

// DELETE /api/friends?userId=<id> — remove a friend
export async function DELETE(req: NextRequest) {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const friendUserId = req.nextUrl.searchParams.get("userId");
  if (!friendUserId) {
    return NextResponse.json({ error: "userId parameter required" }, { status: 400, headers });
  }

  // Delete both directions
  const { error: err1 } = await supabase
    .from("contacts")
    .delete()
    .eq("user_id", auth.sub)
    .eq("contact_user_id", friendUserId);

  const { error: err2 } = await supabase
    .from("contacts")
    .delete()
    .eq("user_id", friendUserId)
    .eq("contact_user_id", auth.sub);

  if (err1 || err2) {
    console.error("[Friends] Remove error:", err1, err2);
    return NextResponse.json({ error: "Failed to remove friend" }, { status: 500, headers });
  }

  return NextResponse.json({ ok: true }, { headers });
}
