import { NextRequest, NextResponse } from "next/server";
import { supabase, mainSupabase } from "@/lib/supabase";
import { corsHeaders, handleCORS } from "@/lib/cors";
import { authenticateRequest } from "@/lib/auth";
import crypto from "crypto";
import QRCode from "qrcode";

export const runtime = "nodejs";

/**
 * POST /api/auth/qr - Generate a new QR session
 * Called by the web client to get a QR code to display
 *
 * POST /api/auth/qr - Confirm a QR session (mobile app scans and confirms)
 * Body: { session_id, action: "confirm" }
 * Auth: Bearer <session_token> (mobile user's token)
 */
export async function POST(request: NextRequest) {
  const corsRes = handleCORS(request);
  if (corsRes) return corsRes;
  const origin = request.headers.get("origin");

  try {
    const body = await request.json().catch(() => ({}));

    // If action is "confirm", this is the mobile app confirming the QR scan
    if (body.action === "confirm" && body.session_id) {
      return handleConfirm(request, body.session_id, origin);
    }

    // Otherwise, generate a new QR session
    return handleGenerate(origin);
  } catch (err: unknown) {
    console.error("[QR Auth] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

export async function GET(request: NextRequest) {
  const corsRes = handleCORS(request);
  if (corsRes) return corsRes;
  return NextResponse.json(
    { error: "Use POST to generate or confirm QR session" },
    { status: 405, headers: corsHeaders(request.headers.get("origin")) }
  );
}

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || new NextResponse(null, { status: 204 });
}

// ─── Generate QR Session ─────────────────────────────────────

async function handleGenerate(origin: string | null) {
  const sessionId = crypto.randomUUID();
  const secret = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 min

  // Store in chat Supabase
  const { error } = await supabase.from("qr_login_sessions").insert({
    id: sessionId,
    secret,
    status: "pending",
    expires_at: expiresAt,
  });

  if (error) {
    console.error("[QR Auth] Insert error:", error);
    return NextResponse.json(
      { error: "Failed to create QR session" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  // Generate a scannable QR code as data URL
  const qrContent = JSON.stringify({
    type: "peeap_chat_login",
    session_id: sessionId,
    secret,
  });

  const qrDataUrl = await QRCode.toDataURL(qrContent, {
    width: 280,
    margin: 2,
    color: { dark: "#000000", light: "#ffffff" },
    errorCorrectionLevel: "M",
  });

  return NextResponse.json(
    {
      session_id: sessionId,
      secret,
      expires_at: expiresAt,
      qr_image: qrDataUrl,
    },
    { headers: corsHeaders(origin) }
  );
}

// ─── Confirm QR Session (Mobile App) ─────────────────────────

async function handleConfirm(
  request: NextRequest,
  sessionId: string,
  origin: string | null
) {
  // Authenticate the mobile user (supports SSO tokens + base64 mobile tokens)
  const payload = await authenticateRequest(request);
  if (!payload) {
    return NextResponse.json(
      { error: "Invalid or expired token" },
      { status: 401, headers: corsHeaders(origin) }
    );
  }

  // Find the pending QR session
  const { data: qrSession, error: fetchErr } = await supabase
    .from("qr_login_sessions")
    .select("*")
    .eq("id", sessionId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString())
    .single();

  if (fetchErr || !qrSession) {
    return NextResponse.json(
      { error: "QR session not found, expired, or already used" },
      { status: 404, headers: corsHeaders(origin) }
    );
  }

  // Create a new SSO session token for the web chat client
  const webToken = crypto.randomBytes(48).toString("hex");
  const webExpiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString(); // 30 days

  // Insert into main Supabase sso_tokens
  const { error: tokenErr } = await mainSupabase.from("sso_tokens").insert({
    token: webToken,
    user_id: payload.sub,
    expires_at: webExpiresAt,
    source_app: "chat",
    target_app: "chat",
  });

  if (tokenErr) {
    console.error("[QR Auth] Token creation error:", tokenErr);
    return NextResponse.json(
      { error: "Failed to create session" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }

  // Mark QR session as confirmed with the new token
  await supabase
    .from("qr_login_sessions")
    .update({
      status: "confirmed",
      user_id: payload.sub,
      session_token: webToken,
      confirmed_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  return NextResponse.json(
    {
      success: true,
      message: "Chat session authorized",
      user_name: `${payload.first_name || ""} ${payload.last_name || ""}`.trim() || payload.email,
    },
    { headers: corsHeaders(origin) }
  );
}
