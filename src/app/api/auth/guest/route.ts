import { NextRequest, NextResponse } from "next/server";
import { supabase, mainSupabase } from "@/lib/supabase";
import { randomUUID, randomBytes } from "crypto";
import { addGuestSession } from "@/lib/auth";

const EMBED_CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: EMBED_CORS });
}

// POST /api/auth/guest - Create guest session for embeddable chat
// Body: { name, email, user_id? }
// - user_id: the Peeap user to chat with (creates a direct conversation)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, user_id: targetUserId } = body;

    if (!name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "Name and email are required" },
        { status: 400, headers: EMBED_CORS }
      );
    }

    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();

    // Find or create guest user in chat_users
    const { data: existing } = await supabase
      .from("chat_users")
      .select("id")
      .eq("email", cleanEmail)
      .eq("account_type", "guest")
      .maybeSingle();

    let guestId: string;

    if (existing) {
      guestId = existing.id;
      await supabase
        .from("chat_users")
        .update({ display_name: cleanName })
        .eq("id", guestId);
    } else {
      guestId = randomUUID();
      const { error } = await supabase.from("chat_users").insert({
        id: guestId,
        auth_user_id: null,
        display_name: cleanName,
        email: cleanEmail,
        phone: null,
        avatar_url: null,
        account_type: "guest",
        status: "active",
      });
      if (error) {
        console.error("Failed to create guest user:", error);
        return NextResponse.json(
          { error: "Failed to create guest account" },
          { status: 500, headers: EMBED_CORS }
        );
      }
    }

    // Generate session token
    const token = randomBytes(32).toString("hex");
    addGuestSession(token, guestId, cleanName, cleanEmail);

    let conversationId: string | null = null;
    let targetProfile: { display_name: string; avatar_url: string | null } | null = null;

    if (targetUserId?.trim()) {
      // Fetch the Peeap user's profile from main Supabase
      const { data: peeapUser } = await mainSupabase
        .from("users")
        .select("id, first_name, last_name, profile_picture")
        .eq("id", targetUserId.trim())
        .single();

      if (peeapUser) {
        const displayName =
          [peeapUser.first_name, peeapUser.last_name].filter(Boolean).join(" ") ||
          "Peeap User";
        targetProfile = {
          display_name: displayName,
          avatar_url: peeapUser.profile_picture || null,
        };

        // Look for existing direct conversation between this guest and the Peeap user
        // Check via metadata.embed_guest_email to reuse conversations for the same guest
        const { data: existingConvs } = await supabase
          .from("conversations")
          .select("id")
          .eq("type", "direct")
          .eq("status", "active")
          .contains("metadata", {
            embed_target: targetUserId.trim(),
            embed_guest_email: cleanEmail,
          });

        if (existingConvs && existingConvs.length > 0) {
          conversationId = existingConvs[0].id;

          // Make sure the guest is still a member (might have been removed)
          const { data: membership } = await supabase
            .from("conversation_members")
            .select("user_id")
            .eq("conversation_id", conversationId)
            .eq("user_id", guestId)
            .maybeSingle();

          if (!membership) {
            await supabase.from("conversation_members").insert({
              conversation_id: conversationId,
              user_id: guestId,
              role: "member",
              permissions: {},
            });
          }
        } else {
          // Create new direct conversation between guest and Peeap user
          const { data: newConv, error: convErr } = await supabase
            .from("conversations")
            .insert({
              type: "direct",
              name: null,
              metadata: {
                embed_target: targetUserId.trim(),
                embed_guest_email: cleanEmail,
                embed_guest_name: cleanName,
              },
              created_by: guestId,
              status: "active",
              is_announcement_only: false,
              member_count: 0,
            })
            .select("id")
            .single();

          if (convErr || !newConv) {
            console.error("Failed to create embed conversation:", convErr);
          } else {
            conversationId = newConv.id;

            // Add both the guest and the Peeap user as members
            await supabase.from("conversation_members").insert([
              {
                conversation_id: conversationId,
                user_id: guestId,
                role: "member",
                permissions: {},
              },
              {
                conversation_id: conversationId,
                user_id: targetUserId.trim(),
                role: "owner",
                permissions: {},
              },
            ]);
          }
        }
      }
    }

    return NextResponse.json(
      {
        token,
        user_id: guestId,
        conversation_id: conversationId,
        target_profile: targetProfile,
      },
      { status: 200, headers: EMBED_CORS }
    );
  } catch (err) {
    console.error("Guest auth error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: EMBED_CORS }
    );
  }
}
