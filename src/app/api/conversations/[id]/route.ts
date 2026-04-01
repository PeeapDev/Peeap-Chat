import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { UpdateConversationSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

// GET /api/conversations/:id - Get conversation details
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

    // Get conversation
    const { data: conversation, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", params.id)
      .single();

    if (error || !conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404, headers }
      );
    }

    // Get members with profiles
    const { data: members } = await supabase
      .from("conversation_members")
      .select("user_id, role, joined_at, last_read_at, permissions, unread_count, is_muted, notification_preference, pinned")
      .eq("conversation_id", params.id);

    const memberIds = (members || []).map((m) => m.user_id);
    const profiles = await getChatUsers(memberIds);

    return NextResponse.json(
      {
        conversation: {
          ...conversation,
          members: (members || []).map((m) => ({
            ...m,
            profile: profiles.get(m.user_id) || null,
          })),
        },
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Get conversation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// PUT /api/conversations/:id - Update conversation
export async function PUT(
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
        { error: "Cannot update conversations with service auth" },
        { status: 400, headers }
      );
    }

    // Check membership and role (admin+ can update)
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

    if (!["owner", "admin"].includes(membership.role)) {
      return NextResponse.json(
        { error: "Only admins can update conversation settings" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const parsed = UpdateConversationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const updateData: Record<string, any> = {};
    if (parsed.data.name !== undefined) updateData.name = parsed.data.name;
    if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
    if (parsed.data.priority !== undefined) updateData.priority = parsed.data.priority;
    if (parsed.data.is_announcement_only !== undefined)
      updateData.is_announcement_only = parsed.data.is_announcement_only;
    if (parsed.data.metadata !== undefined) updateData.metadata = parsed.data.metadata;

    const { data: conversation, error } = await supabase
      .from("conversations")
      .update(updateData)
      .eq("id", params.id)
      .select()
      .single();

    if (error || !conversation) {
      return NextResponse.json(
        { error: "Failed to update conversation" },
        { status: 500, headers }
      );
    }

    return NextResponse.json({ conversation }, { status: 200, headers });
  } catch (err: any) {
    console.error("Update conversation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// DELETE /api/conversations/:id - Archive conversation
export async function DELETE(
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
        { error: "Cannot archive conversations with service auth" },
        { status: 400, headers }
      );
    }

    // Only owner can archive
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

    if (!["owner", "admin"].includes(membership.role)) {
      return NextResponse.json(
        { error: "Only owners/admins can archive conversations" },
        { status: 403, headers }
      );
    }

    const { error } = await supabase
      .from("conversations")
      .update({ status: "archived" })
      .eq("id", params.id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to archive conversation" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: "Conversation archived" },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Archive conversation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
