import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import {
  AddMemberSchema,
  UpdateMemberRoleSchema,
  RemoveMemberSchema,
} from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

const ROLE_HIERARCHY: Record<string, number> = {
  owner: 4,
  admin: 3,
  moderator: 2,
  member: 1,
  observer: 0,
};

// GET /api/conversations/:id/members - List members
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

    const { data: members, error } = await supabase
      .from("conversation_members")
      .select("user_id, role, joined_at, last_read_at, permissions, unread_count, is_muted, notification_preference, pinned")
      .eq("conversation_id", params.id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch members" },
        { status: 500, headers }
      );
    }

    const memberIds = (members || []).map((m) => m.user_id);
    const profiles = await getChatUsers(memberIds);

    return NextResponse.json(
      {
        members: (members || []).map((m) => ({
          ...m,
          profile: profiles.get(m.user_id) || null,
        })),
      },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("List members error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// POST /api/conversations/:id/members - Add members
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
        { error: "Cannot add members with service auth" },
        { status: 400, headers }
      );
    }

    // Check caller is admin+
    const { data: callerMembership } = await supabase
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .single();

    if (!callerMembership || ROLE_HIERARCHY[callerMembership.role] < ROLE_HIERARCHY.admin) {
      return NextResponse.json(
        { error: "Only admins can add members" },
        { status: 403, headers }
      );
    }

    // Check conversation type allows adding members
    const { data: conversation } = await supabase
      .from("conversations")
      .select("type")
      .eq("id", params.id)
      .single();

    if (!conversation) {
      return NextResponse.json(
        { error: "Conversation not found" },
        { status: 404, headers }
      );
    }

    if (conversation.type === "direct") {
      return NextResponse.json(
        { error: "Cannot add members to direct conversations" },
        { status: 400, headers }
      );
    }

    const body = await request.json();
    const parsed = AddMemberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { user_ids, role } = parsed.data;

    // Filter out existing members
    const { data: existingMembers } = await supabase
      .from("conversation_members")
      .select("user_id")
      .eq("conversation_id", params.id)
      .in("user_id", user_ids);

    const existingIds = new Set((existingMembers || []).map((m) => m.user_id));
    const newUserIds = user_ids.filter((id) => !existingIds.has(id));

    if (newUserIds.length === 0) {
      return NextResponse.json(
        { message: "All users are already members", added: 0 },
        { status: 200, headers }
      );
    }

    const newMembers = newUserIds.map((id) => ({
      conversation_id: params.id,
      user_id: id,
      role,
      permissions: {},
    }));

    const { error } = await supabase
      .from("conversation_members")
      .insert(newMembers);

    if (error) {
      return NextResponse.json(
        { error: "Failed to add members" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: "Members added", added: newUserIds.length },
      { status: 201, headers }
    );
  } catch (err: any) {
    console.error("Add members error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// PUT /api/conversations/:id/members - Change member role
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
        { error: "Cannot change roles with service auth" },
        { status: 400, headers }
      );
    }

    // Only owner can change roles
    const { data: callerMembership } = await supabase
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .single();

    if (!callerMembership || callerMembership.role !== "owner") {
      return NextResponse.json(
        { error: "Only the owner can change member roles" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const parsed = UpdateMemberRoleSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { user_id, role } = parsed.data;

    if (user_id === userId) {
      return NextResponse.json(
        { error: "Cannot change your own role" },
        { status: 400, headers }
      );
    }

    const { error } = await supabase
      .from("conversation_members")
      .update({ role })
      .eq("conversation_id", params.id)
      .eq("user_id", user_id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to update role" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: "Role updated", user_id, role },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Update member role error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// DELETE /api/conversations/:id/members - Remove members
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
        { error: "Cannot remove members with service auth" },
        { status: 400, headers }
      );
    }

    // Check caller is admin+
    const { data: callerMembership } = await supabase
      .from("conversation_members")
      .select("role")
      .eq("conversation_id", params.id)
      .eq("user_id", userId)
      .single();

    if (!callerMembership || ROLE_HIERARCHY[callerMembership.role] < ROLE_HIERARCHY.admin) {
      return NextResponse.json(
        { error: "Only admins can remove members" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const parsed = RemoveMemberSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { user_ids } = parsed.data;

    // Cannot remove the owner
    const { data: targetMembers } = await supabase
      .from("conversation_members")
      .select("user_id, role")
      .eq("conversation_id", params.id)
      .in("user_id", user_ids);

    const hasOwner = (targetMembers || []).some((m) => m.role === "owner");
    if (hasOwner) {
      return NextResponse.json(
        { error: "Cannot remove the conversation owner" },
        { status: 400, headers }
      );
    }

    const { error } = await supabase
      .from("conversation_members")
      .delete()
      .eq("conversation_id", params.id)
      .in("user_id", user_ids);

    if (error) {
      return NextResponse.json(
        { error: "Failed to remove members" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: "Members removed", removed: user_ids.length },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Remove members error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
