import { NextResponse } from "next/server";

const DEFAULT_ORIGINS = [
  "https://my.peeap.com",
  "https://checkout.peeap.com",
  "https://school.peeap.com",
  "https://plus.peeap.com",
  "https://store.peeap.com",
  "https://shipping.peeap.com",
  "https://chat.peeap.com",
  "https://cards.peeap.com",
  "http://localhost:5173",
  "http://localhost:5175",
  "http://localhost:3000",
  "http://localhost:3200",
  "http://localhost:3300",
  "http://localhost:3500",
];

function getAllowedOrigins(): string[] {
  const envOrigins = process.env.ALLOWED_ORIGINS;
  if (envOrigins) {
    return [...DEFAULT_ORIGINS, ...envOrigins.split(",").map((o) => o.trim())];
  }
  return DEFAULT_ORIGINS;
}

export function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = getAllowedOrigins();
  const effectiveOrigin =
    origin && allowed.includes(origin) ? origin : allowed[0];

  return {
    "Access-Control-Allow-Origin": effectiveOrigin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-Service-Secret, X-Api-Key",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
  };
}

export function handleCORS(request: Request): NextResponse | null {
  if (request.method === "OPTIONS") {
    const origin = request.headers.get("origin");
    return new NextResponse(null, {
      status: 204,
      headers: corsHeaders(origin),
    });
  }
  return null;
}
