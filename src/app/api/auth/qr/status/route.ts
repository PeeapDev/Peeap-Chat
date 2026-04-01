import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { corsHeaders, handleCORS } from "@/lib/cors";

export const runtime = "nodejs";

/**
 * GET /api/auth/qr/status?session_id=xxx&secret=xxx
 * Polled by the web client to check if the QR was scanned
 *
 * Returns:
 *   { status: "pending" }           - Still waiting for scan
 *   { status: "confirmed", token, user_id }  - Scan confirmed, here's your token
 *   { status: "expired" }           - QR session expired
 */
export async function GET(request: NextRequest) {
  const corsRes = handleCORS(request);
  if (corsRes) return corsRes;
  const origin = request.headers.get("origin");

  try {
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("session_id");
    const secret = searchParams.get("secret");

    if (!sessionId || !secret) {
      return NextResponse.json(
        { error: "session_id and secret are required" },
        { status: 400, headers: corsHeaders(origin) }
      );
    }

    const { data: session, error } = await supabase
      .from("qr_login_sessions")
      .select("status, user_id, session_token, expires_at")
      .eq("id", sessionId)
      .eq("secret", secret)
      .single();

    if (error || !session) {
      return NextResponse.json(
        { status: "expired", error: "Session not found" },
        { headers: corsHeaders(origin) }
      );
    }

    // Check if expired
    if (new Date(session.expires_at) < new Date()) {
      return NextResponse.json(
        { status: "expired" },
        { headers: corsHeaders(origin) }
      );
    }

    if (session.status === "confirmed" && session.session_token) {
      // Clean up - delete the QR session now that it's been consumed
      await supabase
        .from("qr_login_sessions")
        .delete()
        .eq("id", sessionId);

      return NextResponse.json(
        {
          status: "confirmed",
          token: session.session_token,
          user_id: session.user_id,
        },
        { headers: corsHeaders(origin) }
      );
    }

    return NextResponse.json(
      { status: "pending" },
      { headers: corsHeaders(origin) }
    );
  } catch (err: unknown) {
    console.error("[QR Status] Error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: corsHeaders(origin) }
    );
  }
}

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || new NextResponse(null, { status: 204 });
}
