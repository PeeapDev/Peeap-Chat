import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUsers } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { CreateConversationSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

// GET /api/conversations - List user's conversations
export async function GET(request: NextRequest) {
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
        { error: "Cannot list conversations for service auth" },
        { status: 400, headers }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");
    const type = searchParams.get("type");
    const status = searchParams.get("status") || "active";
    const pinnedOnly = searchParams.get("pinned") === "true";

    // Get conversations the user is a member of
    let memberQuery = supabase
      .from("conversation_members")
      .select("conversation_id, unread_count, pinned, is_muted, notification_preference, last_read_at")
      .eq("user_id", userId);

    if (pinnedOnly) {
      memberQuery = memberQuery.eq("pinned", true);
    }

    const { data: memberships, error: memberError } = await memberQuery;

    if (memberError) {
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500, headers }
      );
    }

    if (!memberships || memberships.length === 0) {
      return NextResponse.json(
        { conversations: [] },
        { status: 200, headers }
      );
    }

    const conversationIds = memberships.map((m) => m.conversation_id);
    const membershipMap = new Map(
      memberships.map((m) => [m.conversation_id, m])
    );

    // Fetch conversations
    let convQuery = supabase
      .from("conversations")
      .select("*")
      .in("id", conversationIds)
      .eq("status", status)
      .order("last_message_at", { ascending: false, nullsFirst: false });

    if (type) {
      convQuery = convQuery.eq("type", type);
    }

    convQuery = convQuery.range(offset, offset + limit - 1);

    const { data: conversations, error: convError } = await convQuery;

    if (convError) {
      return NextResponse.json(
        { error: "Failed to fetch conversations" },
        { status: 500, headers }
      );
    }

    // Collect all member IDs for profile enrichment
    const allMemberIds = new Set<string>();
    const convMembersMap = new Map<string, any[]>();

    await Promise.all(
      (conversations || []).map(async (conv) => {
        const { data: members } = await supabase
          .from("conversation_members")
          .select("user_id, role, last_read_at")
          .eq("conversation_id", conv.id)
          .limit(10); // Only fetch first 10 members for list view

        convMembersMap.set(conv.id, members || []);
        (members || []).forEach((m) => allMemberIds.add(m.user_id));
      })
    );

    // Batch fetch profiles
    const profiles = await getChatUsers([...allMemberIds]);

    // Enrich conversations
    const enriched = (conversations || []).map((conv) => {
      const myMembership = membershipMap.get(conv.id);
      const members = convMembersMap.get(conv.id) || [];

      return {
        ...conv,
        members: members.map((m) => ({
          ...m,
          profile: profiles.get(m.user_id) || null,
        })),
        unread_count: myMembership?.unread_count || 0,
        pinned: myMembership?.pinned || false,
        is_muted: myMembership?.is_muted || false,
      };
    });

    // Sort: pinned first, then by last_message_at
    enriched.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      const aTime = a.last_message_at || a.updated_at;
      const bTime = b.last_message_at || b.updated_at;
      return new Date(bTime).getTime() - new Date(aTime).getTime();
    });

    return NextResponse.json(
      { conversations: enriched },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("List conversations error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// POST /api/conversations - Create conversation
export async function POST(request: NextRequest) {
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
        { error: "Cannot create conversations with service auth" },
        { status: 400, headers }
      );
    }

    const body = await request.json();
    const parsed = CreateConversationSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const {
      type,
      name,
      member_ids,
      metadata,
      school_id,
      school_name,
      business_id,
      is_announcement_only,
      platform_id,
    } = parsed.data;

    // For direct messages, check if conversation already exists
    if (type === "direct" && member_ids.length === 1) {
      const otherUserId = member_ids[0];

      const { data: existingConvId } = await supabase.rpc(
        "get_or_create_direct_conversation",
        { user_a: userId, user_b: otherUserId }
      );

      if (existingConvId) {
        const { data: existingConv } = await supabase
          .from("conversations")
          .select("*")
          .eq("id", existingConvId)
          .single();

        if (existingConv) {
          // Enrich with member profiles
          const { data: existingMembers } = await supabase
            .from("conversation_members")
            .select("user_id, role, last_read_at")
            .eq("conversation_id", existingConvId);

          const existingMemberIds = (existingMembers || []).map((m) => m.user_id);
          const existingProfiles = await getChatUsers(existingMemberIds);

          return NextResponse.json(
            {
              conversation: {
                ...existingConv,
                members: (existingMembers || []).map((m) => ({
                  ...m,
                  profile: existingProfiles.get(m.user_id) || null,
                })),
              },
              existing: true,
            },
            { status: 200, headers }
          );
        }
      }
    }

    // Determine default permissions based on type
    const defaultPermissions: Record<string, any> = {};
    if (type === "school_class" || type === "business_channel") {
      defaultPermissions.can_send_messages = false;
      defaultPermissions.can_add_members = false;
    }

    // Create conversation
    const { data: conversation, error: convError } = await supabase
      .from("conversations")
      .insert({
        type,
        name: name || null,
        metadata: metadata || {},
        created_by: userId,
        source: auth.type === "platform" ? "platform" : "peeap",
        platform_id: platform_id || (auth.type === "platform" ? auth.platformId : null),
        school_id: school_id || null,
        school_name: school_name || null,
        business_id: business_id || null,
        status: "active",
        is_announcement_only: is_announcement_only || false,
        member_count: 0, // trigger will update
      })
      .select()
      .single();

    if (convError || !conversation) {
      console.error("Create conversation error:", convError);
      return NextResponse.json(
        { error: "Failed to create conversation" },
        { status: 500, headers }
      );
    }

    // Add creator as owner
    const allMembers = [
      {
        conversation_id: conversation.id,
        user_id: userId,
        role: "owner",
        permissions: {},
      },
      ...member_ids
        .filter((id) => id !== userId)
        .map((id) => ({
          conversation_id: conversation.id,
          user_id: id,
          role: "member" as string,
          permissions: defaultPermissions,
        })),
    ];

    const { error: memberError } = await supabase
      .from("conversation_members")
      .insert(allMembers);

    if (memberError) {
      // Cleanup on failure
      await supabase.from("conversations").delete().eq("id", conversation.id);
      return NextResponse.json(
        { error: "Failed to add members" },
        { status: 500, headers }
      );
    }

    // Re-fetch conversation with updated member_count
    const { data: finalConv } = await supabase
      .from("conversations")
      .select("*")
      .eq("id", conversation.id)
      .single();

    // Enrich with member profiles
    const { data: convMembers } = await supabase
      .from("conversation_members")
      .select("user_id, role, last_read_at")
      .eq("conversation_id", conversation.id);

    const memberUserIds = (convMembers || []).map((m) => m.user_id);
    const profiles = await getChatUsers(memberUserIds);

    const enrichedConv = {
      ...(finalConv || conversation),
      members: (convMembers || []).map((m) => ({
        ...m,
        profile: profiles.get(m.user_id) || null,
      })),
    };

    return NextResponse.json(
      { conversation: enrichedConv },
      { status: 201, headers }
    );
  } catch (err: any) {
    console.error("Create conversation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
