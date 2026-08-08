import { NextRequest, NextResponse } from "next/server";
import { authenticateServiceCall } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { getChatUser } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { EcommerceMessageSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// POST /api/ecommerce/messages - Service-to-service endpoint
// Called by POS (store.peeap.com) on purchase and Shipping (shipping.peeap.com) on status change
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    // Only allow service-to-service calls
    if (!authenticateServiceCall(request)) {
      return NextResponse.json(
        { error: "Service authentication required" },
        { status: 401, headers }
      );
    }

    const body = await request.json();
    const parsed = EcommerceMessageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid payload", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { order_id, store_id, buyer_user_id, seller_user_id, category, content, rich_content, tracking_number, driver_user_id, idempotency_key } = parsed.data;

    if (idempotency_key) {
      const { data: existing } = await supabase
        .from("messages")
        .select("id, conversation_id, created_at")
        .contains("metadata", { idempotency_key })
        .limit(1)
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { message: existing, conversation_id: existing.conversation_id, deduplicated: true },
          { status: 200, headers }
        );
      }
    }

    // For driver_assigned, the conversation is between driver and buyer
    const isDriverMessage = category === "driver_assigned" && driver_user_id;
    const participant1 = isDriverMessage ? driver_user_id : buyer_user_id;
    const participant2 = isDriverMessage ? buyer_user_id : seller_user_id;

    // Ensure both users exist in chat_users
    await Promise.all([
      getChatUser(participant1),
      getChatUser(participant2),
    ]);

    // Get or create conversation between the two participants
    const { data: convId, error: convError } = await supabase
      .rpc("get_or_create_ecommerce_conversation", {
        p_buyer_id: participant1,
        p_seller_id: participant2,
      });

    if (convError || !convId) {
      console.error("Failed to get/create conversation:", convError);
      return NextResponse.json(
        { error: "Failed to create conversation" },
        { status: 500, headers }
      );
    }

    // Map category to message type
    const messageTypeMap: Record<string, string> = {
      order_created: "order_update",
      order_update: "order_update",
      invoice: "invoice",
      shipping_update: "shipping_update",
      delivery_confirmed: "order_update",
      product_card: "product_card",
      driver_assigned: "shipping_update",
    };

    const messageType = messageTypeMap[category] || "system";

    // Build message content based on category
    let messageContent = content || "";
    const messageRichContent: Record<string, unknown> = {
      ...rich_content,
      order_id,
      store_id,
      category,
    };

    if (tracking_number) {
      messageRichContent.tracking_number = tracking_number;
    }

    if (!messageContent) {
      switch (category) {
        case "order_created":
          messageContent = `New order #${order_id} placed`;
          break;
        case "invoice":
          messageContent = `Invoice for order #${order_id}`;
          break;
        case "shipping_update":
          messageContent = `Shipping update for order #${order_id}`;
          if (tracking_number) messageContent += ` (Tracking: ${tracking_number})`;
          break;
        case "order_update":
          messageContent = `Order #${order_id} status updated`;
          break;
        case "delivery_confirmed":
          messageContent = `Order #${order_id} has been delivered`;
          break;
        case "product_card":
          messageContent = "Product shared";
          break;
      }
    }

    // Determine sender based on category
    const senderId = isDriverMessage ? driver_user_id : seller_user_id;

    // Create the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: convId,
        sender_id: senderId,
        content: messageContent,
        message_type: messageType,
        rich_content: messageRichContent,
        metadata: { source: "ecommerce", order_id, store_id, ...(idempotency_key ? { idempotency_key } : {}) },
      })
      .select()
      .single();

    if (msgError) {
      console.error("Failed to create message:", msgError);
      return NextResponse.json(
        { error: "Failed to create message" },
        { status: 500, headers }
      );
    }

    // Track in ecommerce_messages table
    const { error: ecomError } = await supabase
      .from("ecommerce_messages")
      .insert({
        conversation_id: convId,
        message_id: message?.id,
        order_id,
        store_id,
        buyer_user_id,
        seller_user_id,
        message_category: category,
        tracking_number,
        order_data: rich_content,
      });

    if (ecomError) {
      console.error("Failed to track ecommerce message:", ecomError);
      // Non-critical - message was already sent
    }

    // ── Create notification on the main Peeap Supabase (for NotificationBell) ──
    // This ensures the bell shows unread chat messages.
    const recipientId = isDriverMessage ? buyer_user_id : (senderId === buyer_user_id ? seller_user_id : buyer_user_id);
    if (recipientId) {
      try {
        const MAIN_API = process.env.MAIN_API_URL || "https://api.peeap.com";
        const SERVICE_SECRET = process.env.SERVICE_SECRET || "";
        // Extract a preview of the message content
        const preview = (messageContent || "").slice(0, 100);
        const storeName = (rich_content as any)?.store_name || "Peeap";
        await fetch(`${MAIN_API}/api/notifications/internal`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Service-Secret": SERVICE_SECRET,
          },
          body: JSON.stringify({
            user_id: recipientId,
            type: "chat_message",
            title: `New message from ${storeName}`,
            message: preview,
            action_url: "/messages",
            source_service: "chat",
            source_id: message?.id,
            priority: "normal",
          }),
        });
      } catch (notifErr) {
        console.warn("[ChatMessage] Failed to create notification:", notifErr);
        // Non-critical
      }
    }

    return NextResponse.json(
      {
        message,
        conversation_id: convId,
        ecommerce_tracked: !ecomError,
      },
      { status: 201, headers }
    );
  } catch (err) {
    console.error("E-commerce message error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
