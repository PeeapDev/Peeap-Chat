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

    const { order_id, store_id, buyer_user_id, seller_user_id, category, content, rich_content, tracking_number } = parsed.data;

    // Ensure both users exist in chat_users
    await Promise.all([
      getChatUser(buyer_user_id),
      getChatUser(seller_user_id),
    ]);

    // Get or create conversation between buyer and seller
    const { data: convId, error: convError } = await supabase
      .rpc("get_or_create_ecommerce_conversation", {
        p_buyer_id: buyer_user_id,
        p_seller_id: seller_user_id,
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
      order_created: "invoice",
      invoice: "invoice",
      shipping_update: "shipping_update",
      delivery_confirmed: "order_update",
      product_card: "product_card",
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
        case "delivery_confirmed":
          messageContent = `Order #${order_id} has been delivered`;
          break;
        case "product_card":
          messageContent = "Product shared";
          break;
      }
    }

    // Determine sender: seller for invoices, system for shipping
    const senderId = category === "shipping_update" ? seller_user_id : seller_user_id;

    // Create the message
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        conversation_id: convId,
        sender_id: senderId,
        content: messageContent,
        message_type: messageType,
        rich_content: messageRichContent,
        metadata: { source: "ecommerce", order_id, store_id },
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
