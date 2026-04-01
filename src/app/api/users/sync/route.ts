import { NextRequest, NextResponse } from "next/server";
import { authenticateServiceCall } from "@/lib/auth";
import { syncChatUser } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { SyncUserSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// POST /api/users/sync - Service-to-service user sync
export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  const headers = corsHeaders(origin);

  try {
    if (!authenticateServiceCall(request)) {
      return NextResponse.json(
        { error: "Unauthorized - service secret required" },
        { status: 401, headers }
      );
    }

    const body = await request.json();
    const parsed = SyncUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400, headers }
      );
    }

    const user = await syncChatUser(parsed.data);

    if (!user) {
      return NextResponse.json(
        { error: "Failed to sync user" },
        { status: 500, headers }
      );
    }

    return NextResponse.json({ user }, { status: 200, headers });
  } catch (err: any) {
    console.error("User sync error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
