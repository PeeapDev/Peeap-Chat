import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { EditMessageSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

// PUT /api/messages/:id - Edit message
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
        { error: "Cannot edit messages with service auth" },
        { status: 400, headers }
      );
    }

    // Get message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .select("id, sender_id, created_at, is_deleted, metadata")
      .eq("id", params.id)
      .single();

    if (msgError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404, headers }
      );
    }

    // Ecommerce transaction messages cannot be edited
    if ((message.metadata as Record<string, unknown>)?.source === "ecommerce") {
      return NextResponse.json(
        { error: "Transaction messages cannot be edited" },
        { status: 403, headers }
      );
    }

    if (message.is_deleted) {
      return NextResponse.json(
        { error: "Cannot edit a deleted message" },
        { status: 400, headers }
      );
    }

    // Only sender can edit
    if (message.sender_id !== userId) {
      return NextResponse.json(
        { error: "Only the sender can edit this message" },
        { status: 403, headers }
      );
    }

    // Check 15-minute edit window
    const messageAge = Date.now() - new Date(message.created_at).getTime();
    const FIFTEEN_MINUTES = 15 * 60 * 1000;
    if (messageAge > FIFTEEN_MINUTES) {
      return NextResponse.json(
        { error: "Messages can only be edited within 15 minutes of sending" },
        { status: 400, headers }
      );
    }

    const body = await request.json();
    const parsed = EditMessageSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { data: updatedMessage, error: updateError } = await supabase
      .from("messages")
      .update({
        content: parsed.data.content,
        is_edited: true,
        edited_at: new Date().toISOString(),
      })
      .eq("id", params.id)
      .select()
      .single();

    if (updateError || !updatedMessage) {
      return NextResponse.json(
        { error: "Failed to edit message" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: updatedMessage },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Edit message error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// DELETE /api/messages/:id - Delete (soft) a message
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
    if (!userId && auth.type !== "service") {
      return NextResponse.json(
        { error: "Cannot delete messages" },
        { status: 400, headers }
      );
    }

    // Get message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .select("id, sender_id, conversation_id, metadata")
      .eq("id", params.id)
      .single();

    if (msgError || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404, headers }
      );
    }

    // Ecommerce transaction messages cannot be deleted — they are permanent records
    if ((message.metadata as Record<string, unknown>)?.source === "ecommerce") {
      return NextResponse.json(
        { error: "Transaction messages cannot be deleted" },
        { status: 403, headers }
      );
    }

    // Service auth can always delete; otherwise check permissions
    if (auth.type !== "service" && userId) {
      if (message.sender_id !== userId) {
        const { data: membership } = await supabase
          .from("conversation_members")
          .select("role")
          .eq("conversation_id", message.conversation_id)
          .eq("user_id", userId)
          .single();

        if (!membership || !["owner", "admin", "moderator"].includes(membership.role)) {
          return NextResponse.json(
            { error: "Not authorized to delete this message" },
            { status: 403, headers }
          );
        }
      }
    }

    // Soft delete
    const { error } = await supabase
      .from("messages")
      .update({
        is_deleted: true,
        content: null,
        rich_content: null,
        attachments: [],
        metadata: {},
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.id);

    if (error) {
      return NextResponse.json(
        { error: "Failed to delete message" },
        { status: 500, headers }
      );
    }

    return NextResponse.json(
      { message: "Message deleted" },
      { status: 200, headers }
    );
  } catch (err: any) {
    console.error("Delete message error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
