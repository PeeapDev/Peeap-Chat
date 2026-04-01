import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase, mainSupabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { CreateBroadcastSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  return null;
}

async function isAdmin(auth: AuthResult): Promise<boolean> {
  if (auth.type === "service") return true;
  if (auth.type !== "user") return false;

  const adminRoles = ["superadmin", "admin"];
  return auth.payload.roles.some((r) => adminRoles.includes(r));
}

// POST /api/admin/broadcasts - Create and optionally send a system broadcast
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

    if (!(await isAdmin(auth))) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const userId = getUserId(auth) || "system";

    const body = await request.json();
    const parsed = CreateBroadcastSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid broadcast data", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { title, content, target_segment, target_filter, send_now } = parsed.data;

    // Create broadcast record
    const { data: broadcast, error: createError } = await supabase
      .from("system_broadcasts")
      .insert({
        admin_user_id: userId,
        title,
        content,
        target_segment,
        target_filter: target_filter || null,
        status: send_now ? "sending" : "draft",
      })
      .select()
      .single();

    if (createError || !broadcast) {
      return NextResponse.json(
        { error: "Failed to create broadcast" },
        { status: 500, headers }
      );
    }

    // If send_now, deliver messages to targeted users
    if (send_now) {
      let deliveryCount = 0;

      try {
        // Build user query based on segment
        let userQuery = mainSupabase
          .from("users")
          .select("id")
          .eq("is_active", true);

        switch (target_segment) {
          case "merchants":
            userQuery = userQuery.contains("roles", ["merchant"]);
            break;
          case "schools":
            userQuery = userQuery.contains("roles", ["school_admin"]);
            break;
          case "parents":
            userQuery = userQuery.contains("roles", ["parent"]);
            break;
          case "students":
            userQuery = userQuery.contains("roles", ["student"]);
            break;
          case "custom":
            // Custom filter applied via target_filter - e.g., specific user IDs
            if (target_filter?.user_ids) {
              userQuery = userQuery.in("id", target_filter.user_ids as string[]);
            }
            break;
          // 'all' - no additional filter
        }

        const { data: targetUsers } = await userQuery.limit(10000);

        if (targetUsers && targetUsers.length > 0) {
          // Create system messages in batches of 100
          const batchSize = 100;
          for (let i = 0; i < targetUsers.length; i += batchSize) {
            const batch = targetUsers.slice(i, i + batchSize);

            // For each user, find or create a "system" conversation
            const messageInserts = [];
            for (const user of batch) {
              // Find existing system conversation for this user
              let systemConvId: string | null = null;

              const { data: existingConv } = await supabase
                .from("conversations")
                .select("id")
                .eq("type", "support")
                .eq("source", "system_broadcast")
                .eq("created_by", user.id)
                .limit(1)
                .single();

              if (existingConv) {
                systemConvId = existingConv.id;
              } else {
                // Create system conversation for this user
                const { data: newConv } = await supabase
                  .from("conversations")
                  .insert({
                    type: "support",
                    name: "System Notifications",
                    created_by: user.id,
                    source: "system_broadcast",
                    status: "active",
                  })
                  .select("id")
                  .single();

                if (newConv) {
                  systemConvId = newConv.id;

                  // Add user as member
                  await supabase
                    .from("conversation_members")
                    .insert({
                      conversation_id: systemConvId,
                      user_id: user.id,
                      role: "member",
                    });
                }
              }

              if (systemConvId) {
                messageInserts.push({
                  conversation_id: systemConvId,
                  sender_id: userId,
                  content: `**${title}**\n\n${content}`,
                  message_type: "announcement",
                  metadata: { broadcast_id: broadcast.id, source: "system_broadcast" },
                });
              }
            }

            if (messageInserts.length > 0) {
              const { error: insertError } = await supabase
                .from("messages")
                .insert(messageInserts);

              if (!insertError) {
                deliveryCount += messageInserts.length;
              }
            }
          }
        }

        // Update broadcast status
        await supabase
          .from("system_broadcasts")
          .update({
            status: "sent",
            delivery_count: deliveryCount,
            sent_at: new Date().toISOString(),
          })
          .eq("id", broadcast.id);
      } catch (deliveryErr) {
        console.error("Broadcast delivery error:", deliveryErr);

        await supabase
          .from("system_broadcasts")
          .update({
            status: "sent",
            delivery_count: deliveryCount,
            sent_at: new Date().toISOString(),
          })
          .eq("id", broadcast.id);
      }

      return NextResponse.json(
        {
          broadcast: { ...broadcast, status: "sent", delivery_count: deliveryCount },
        },
        { status: 201, headers }
      );
    }

    return NextResponse.json(
      { broadcast },
      { status: 201, headers }
    );
  } catch (err) {
    console.error("Broadcast error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// GET /api/admin/broadcasts - List broadcasts
export async function GET(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    const auth = await authenticateAny(request);
    if (!auth || !(await isAdmin(auth))) {
      return NextResponse.json(
        { error: "Admin access required" },
        { status: 403, headers }
      );
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
    const status = searchParams.get("status");

    let query = supabase
      .from("system_broadcasts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch broadcasts" },
        { status: 500, headers }
      );
    }

    return NextResponse.json({ broadcasts: data }, { headers });
  } catch (err) {
    console.error("List broadcasts error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
