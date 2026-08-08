import { NextResponse } from "next/server";
import { mainSupabase, supabase } from "@/lib/supabase";
import { corsHeaders } from "@/lib/cors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const startedAt = Date.now();
  const headers = corsHeaders(request.headers.get("origin"));

  const [chatResult, mainResult] = await Promise.all([
    supabase.from("conversations").select("id", { head: true, count: "exact" }).limit(1),
    mainSupabase.from("users").select("id", { head: true, count: "exact" }).limit(1),
  ]);

  const chatConnected = !chatResult.error;
  const mainConnected = !mainResult.error;
  const healthy = chatConnected && mainConnected;

  return NextResponse.json(
    {
      name: "Peeap Chat API",
      status: healthy ? "healthy" : "down",
      checks: {
        chat_database: { connected: chatConnected },
        identity_database: { connected: mainConnected },
      },
      response_time_ms: Date.now() - startedAt,
      timestamp: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503, headers }
  );
}

export async function OPTIONS(request: Request) {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders(request.headers.get("origin")),
  });
}
