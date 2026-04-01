import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// GET /api/messages/:id/reactions
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateAny(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  const { data: reactions, error } = await supabase
    .from("message_reactions")
    .select("id, emoji, user_id, created_at")
    .eq("message_id", params.id)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }

  // Group by emoji
  const grouped: Record<string, { emoji: string; count: number; users: string[] }> = {};
  for (const r of reactions || []) {
    if (!grouped[r.emoji]) {
      grouped[r.emoji] = { emoji: r.emoji, count: 0, users: [] };
    }
    grouped[r.emoji].count++;
    grouped[r.emoji].users.push(r.user_id);
  }

  return NextResponse.json({ reactions: Object.values(grouped) }, { headers });
}

// POST /api/messages/:id/reactions — toggle a reaction
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateAny(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (auth.type !== "user") {
    return NextResponse.json({ error: "User auth required" }, { status: 403, headers });
  }

  const body = await request.json();
  const emoji = body.emoji;

  if (!emoji || typeof emoji !== "string" || emoji.length > 10) {
    return NextResponse.json({ error: "Invalid emoji" }, { status: 400, headers });
  }

  const userId = (auth as { userId: string }).userId;

  // Verify message exists and user has access
  const { data: message } = await supabase
    .from("messages")
    .select("conversation_id")
    .eq("id", params.id)
    .single();

  if (!message) {
    return NextResponse.json({ error: "Message not found" }, { status: 404, headers });
  }

  const { data: member } = await supabase
    .from("conversation_members")
    .select("user_id")
    .eq("conversation_id", message.conversation_id)
    .eq("user_id", userId)
    .single();

  if (!member) {
    return NextResponse.json({ error: "Not a member" }, { status: 403, headers });
  }

  // Toggle: if exists remove, if not add
  const { data: existing } = await supabase
    .from("message_reactions")
    .select("id")
    .eq("message_id", params.id)
    .eq("user_id", userId)
    .eq("emoji", emoji)
    .single();

  if (existing) {
    await supabase.from("message_reactions").delete().eq("id", existing.id);
    return NextResponse.json({ action: "removed", emoji }, { headers });
  }

  const { error } = await supabase.from("message_reactions").insert({
    message_id: params.id,
    user_id: userId,
    emoji,
  });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500, headers });
  }

  return NextResponse.json({ action: "added", emoji }, { headers });
}

// DELETE /api/messages/:id/reactions?emoji=<emoji>
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  const auth = await authenticateAny(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }
  if (auth.type !== "user") {
    return NextResponse.json({ error: "User auth required" }, { status: 403, headers });
  }

  const userId = (auth as { userId: string }).userId;
  const { searchParams } = new URL(request.url);
  const emoji = searchParams.get("emoji");

  if (!emoji) {
    return NextResponse.json({ error: "emoji param required" }, { status: 400, headers });
  }

  await supabase
    .from("message_reactions")
    .delete()
    .eq("message_id", params.id)
    .eq("user_id", userId)
    .eq("emoji", emoji);

  return NextResponse.json({ removed: true }, { headers });
}
