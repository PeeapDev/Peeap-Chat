import { NextRequest, NextResponse } from "next/server";
import { authenticateServiceCall } from "@/lib/auth";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { supabase } from "@/lib/supabase";
import { getChatUser } from "@/lib/users";
import { TransactionalMessageSchema } from "@/lib/validation";

const PAYMENTS_USER_ID = "00000000-0000-4000-8000-000000000001";
const MARKETPLACE_USER_ID = "00000000-0000-4000-8000-000000000002";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

/**
 * Reliable service-to-service delivery for financial messages.
 * School receipts, marketplace receipts and invoices all use the same
 * Peeap-owned conversation, idempotency and notification behavior.
 */
export async function POST(request: NextRequest) {
  const headers = corsHeaders(request.headers.get("origin"));
  if (!authenticateServiceCall(request)) {
    return NextResponse.json({ error: "Service authentication required" }, { status: 401, headers });
  }

  try {
    const parsed = TransactionalMessageSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const input = parsed.data;
    const isMarketplace = input.channel === "marketplace";
    const systemUserId = isMarketplace ? MARKETPLACE_USER_ID : PAYMENTS_USER_ID;
    const systemName = isMarketplace ? "Peeap Marketplace" : "Peeap Payments";
    const recipient = await getChatUser(input.recipient_user_id);
    if (!recipient) {
      return NextResponse.json({ error: "Recipient is not a Peeap user" }, { status: 404, headers });
    }

    // Ensure the trusted system sender has a profile that clients can render.
    const { error: systemUserError } = await supabase.from("chat_users").upsert({
      auth_user_id: systemUserId,
      display_name: systemName,
      account_type: "system",
      roles: ["system"],
      status: "active",
    }, { onConflict: "auth_user_id" });
    if (systemUserError) throw systemUserError;

    // Retried requests return the original message rather than creating duplicates.
    const { data: existing } = await supabase
      .from("messages")
      .select("id, conversation_id, created_at")
      .contains("metadata", { idempotency_key: input.idempotency_key })
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ message: existing, conversation_id: existing.conversation_id, deduplicated: true }, { status: 200, headers });
    }

    const { data: conversationId, error: conversationError } = await supabase.rpc(
      "get_or_create_ecommerce_conversation",
      { p_buyer_id: input.recipient_user_id, p_seller_id: systemUserId }
    );
    if (conversationError || !conversationId) {
      throw conversationError || new Error("Failed to create system conversation");
    }

    const { data: message, error: messageError } = await supabase.from("messages").insert({
      conversation_id: conversationId,
      sender_id: systemUserId,
      content: input.content,
      message_type: input.message_type,
      rich_content: {
        ...(input.rich_content || {}),
        title: input.title,
        channel: input.channel,
        event_type: input.event_type,
        action_url: input.action_url || null,
      },
      metadata: {
        source: "transactional",
        idempotency_key: input.idempotency_key,
        source_service: input.source_service,
        source_id: input.source_id,
      },
    }).select().single();
    if (messageError) throw messageError;

    let notificationDelivered = false;
    try {
      const mainApi = process.env.MAIN_API_URL || process.env.PEEAP_API_URL || "https://api.peeap.com";
      const response = await fetch(`${mainApi}/api/notifications/internal`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Service-Secret": process.env.SERVICE_SECRET || "",
        },
        body: JSON.stringify({
          user_id: input.recipient_user_id,
          type: input.event_type,
          title: input.title,
          message: input.content.slice(0, 500),
          action_url: input.action_url || "/messages",
          source_service: input.source_service,
          source_id: input.source_id,
          priority: input.priority,
          send_push: input.send_push,
        }),
        signal: AbortSignal.timeout(8000),
      });
      notificationDelivered = response.ok;
      if (!response.ok) console.warn("Transactional notification failed:", response.status, await response.text());
    } catch (notificationError) {
      console.warn("Transactional notification failed:", notificationError);
    }

    return NextResponse.json({
      message,
      conversation_id: conversationId,
      deduplicated: false,
      notification_delivered: notificationDelivered,
    }, { status: 201, headers });
  } catch (error) {
    console.error("Transactional message error:", error);
    return NextResponse.json({ error: "Failed to deliver transactional message" }, { status: 500, headers });
  }
}
