import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase, mainSupabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { ExecuteCommandSchema, isFinancialCommand } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  if (auth.type === "platform") return auth.platformOwnerId;
  return null;
}

const PEEAP_API_URL = process.env.PEEAP_API_URL || "https://api.peeap.com";
const SERVICE_SECRET = process.env.SERVICE_SECRET || "";

// POST /api/conversations/:id/commands - Execute a slash command
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
        { error: "User authentication required for commands" },
        { status: 403, headers }
      );
    }

    // Verify membership
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

    const body = await request.json();
    const parsed = ExecuteCommandSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid command", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const { command, args, pin_verified } = parsed.data;
    const requiresPin = isFinancialCommand(command);

    // Financial commands require PIN verification
    if (requiresPin && !pin_verified) {
      return NextResponse.json(
        { error: "PIN verification required for financial commands", requires_pin: true },
        { status: 403, headers }
      );
    }

    // Create command execution record
    const { data: execution, error: execError } = await supabase
      .from("slash_command_executions")
      .insert({
        conversation_id: params.id,
        user_id: userId,
        command,
        args,
        status: "executing",
        requires_pin: requiresPin,
        pin_verified_at: requiresPin ? new Date().toISOString() : null,
      })
      .select()
      .single();

    if (execError || !execution) {
      return NextResponse.json(
        { error: "Failed to create command execution" },
        { status: 500, headers }
      );
    }

    let result: Record<string, unknown> = {};
    let messageType = "slash_command_result";
    let messageContent = "";
    let richContent: Record<string, unknown> = {};

    try {
      switch (command) {
        case "send": {
          // /send @username amount - Transfer money
          const { recipient_id, amount, currency = "SLE" } = args as {
            recipient_id?: string;
            amount?: number;
            currency?: string;
          };

          if (!recipient_id || !amount) {
            throw new Error("Missing recipient_id or amount");
          }

          // Call main Peeap API to execute transfer
          const transferRes = await fetch(`${PEEAP_API_URL}/api/shared/transfer`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Secret": SERVICE_SECRET,
              "X-User-Id": userId,
            },
            body: JSON.stringify({
              sender_id: userId,
              recipient_id,
              amount,
              currency,
              description: `Chat transfer via /send`,
            }),
          });

          const transferData = await transferRes.json();
          if (!transferRes.ok) {
            throw new Error(transferData.error || "Transfer failed");
          }

          result = transferData;
          messageType = "payment_confirmation";
          messageContent = `Sent ${currency} ${amount.toLocaleString()} via chat`;
          richContent = {
            type: "send_money",
            amount,
            currency,
            recipient_id,
            transaction_id: transferData.transaction_id,
          };
          break;
        }

        case "invoice": {
          // /invoice - Create an invoice
          const { amount, description, items, due_date, currency = "SLE" } = args as {
            amount?: number;
            description?: string;
            items?: Array<{ name: string; amount: number }>;
            due_date?: string;
            currency?: string;
          };

          if (!amount) {
            throw new Error("Missing amount for invoice");
          }

          // Create payment request record
          const { data: paymentReq, error: prError } = await supabase
            .from("payment_requests")
            .insert({
              conversation_id: params.id,
              sender_id: userId,
              type: "pay_invoice",
              amount,
              currency,
              status: "pending",
              invoice_data: { description, items, due_date },
              expires_at: due_date || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select()
            .single();

          if (prError) throw new Error("Failed to create invoice");

          result = paymentReq;
          messageType = "invoice";
          messageContent = `Invoice: ${currency} ${amount.toLocaleString()}`;
          richContent = {
            invoice_id: paymentReq?.id,
            amount,
            currency,
            description,
            items,
            due_date,
            status: "pending",
          };
          break;
        }

        case "request": {
          // /request amount - Request money
          const { amount, note, currency = "SLE" } = args as {
            amount?: number;
            note?: string;
            currency?: string;
          };

          if (!amount) {
            throw new Error("Missing amount for request");
          }

          const { data: paymentReq } = await supabase
            .from("payment_requests")
            .insert({
              conversation_id: params.id,
              sender_id: userId,
              type: "request_money",
              amount,
              currency,
              status: "pending",
              notes: note,
              expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
            })
            .select()
            .single();

          result = paymentReq || {};
          messageType = "payment_request";
          messageContent = `Requested ${currency} ${amount.toLocaleString()}`;
          richContent = {
            request_id: paymentReq?.id,
            amount,
            currency,
            note,
            status: "pending",
          };
          break;
        }

        case "transaction": {
          // /transaction - Share past transaction details
          const { transaction_id } = args as { transaction_id?: string };

          // Fetch transaction from main platform
          const txRes = await fetch(
            `${PEEAP_API_URL}/api/shared/wallet/transactions?transaction_id=${transaction_id || "latest"}`,
            {
              headers: {
                "X-Service-Secret": SERVICE_SECRET,
                "X-User-Id": userId,
              },
            }
          );

          const txData = await txRes.json();
          result = txData;
          messageType = "slash_command_result";
          messageContent = "Shared transaction details";
          richContent = {
            type: "transaction_share",
            transaction: txData.transaction || txData,
          };
          break;
        }

        case "product": {
          // /product - Send product card
          const { product_id, store_id } = args as {
            product_id?: string;
            store_id?: string;
          };

          if (!product_id) {
            throw new Error("Missing product_id");
          }

          // Fetch product from POS service
          const productRes = await fetch(
            `${process.env.POS_API_URL || "https://store.peeap.com"}/api/products/${product_id}`,
            {
              headers: { "X-Service-Secret": SERVICE_SECRET },
            }
          );

          const productData = await productRes.json();
          result = productData;
          messageType = "product_card";
          messageContent = productData.name || "Product";
          richContent = {
            product_id,
            store_id,
            name: productData.name,
            price: productData.price,
            currency: productData.currency || "SLE",
            image_url: productData.image_url,
            description: productData.description,
            in_stock: productData.in_stock,
          };
          break;
        }

        case "create": {
          // /create - Create payment link
          const { amount, description, currency = "SLE" } = args as {
            amount?: number;
            description?: string;
            currency?: string;
          };

          if (!amount) {
            throw new Error("Missing amount for payment link");
          }

          const createRes = await fetch(`${PEEAP_API_URL}/api/shared/checkout/create`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Service-Secret": SERVICE_SECRET,
              "X-User-Id": userId,
            },
            body: JSON.stringify({ amount, currency, description }),
          });

          const createData = await createRes.json();
          if (!createRes.ok) throw new Error(createData.error || "Failed to create payment link");

          result = createData;
          messageType = "payment_link";
          messageContent = `Payment link: ${currency} ${amount.toLocaleString()}`;
          richContent = {
            checkout_url: createData.checkout_url,
            amount,
            currency,
            description,
          };
          break;
        }
      }

      // Create the result message in the conversation
      const { data: message } = await supabase
        .from("messages")
        .insert({
          conversation_id: params.id,
          sender_id: userId,
          content: messageContent,
          message_type: messageType,
          rich_content: richContent,
          metadata: { command, args, execution_id: execution.id },
        })
        .select()
        .single();

      // Update execution as completed
      await supabase
        .from("slash_command_executions")
        .update({
          status: "completed",
          result,
          message_id: message?.id,
          external_transaction_id: (result as { transaction_id?: string }).transaction_id || null,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return NextResponse.json(
        { execution: { ...execution, status: "completed", result }, message },
        { headers }
      );
    } catch (cmdError: unknown) {
      const errorMessage = cmdError instanceof Error ? cmdError.message : "Command execution failed";

      // Mark as failed
      await supabase
        .from("slash_command_executions")
        .update({
          status: "failed",
          result: { error: errorMessage },
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);

      return NextResponse.json(
        { error: errorMessage, execution_id: execution.id },
        { status: 400, headers }
      );
    }
  } catch (err) {
    console.error("Command execution error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// GET /api/conversations/:id/commands - List recent command executions
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

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    const { data, error } = await supabase
      .from("slash_command_executions")
      .select("*")
      .eq("conversation_id", params.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) {
      return NextResponse.json(
        { error: "Failed to fetch commands" },
        { status: 500, headers }
      );
    }

    return NextResponse.json({ commands: data }, { headers });
  } catch (err) {
    console.error("List commands error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
