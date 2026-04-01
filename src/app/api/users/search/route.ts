import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { searchChatUsers } from "@/lib/users";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// GET /api/users/search?q=<query>&limit=20
export async function GET(request: NextRequest) {
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
    const q = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);

    if (!q || q.length < 1) {
      return NextResponse.json(
        { error: "Search query 'q' is required" },
        { status: 400, headers }
      );
    }

    const users = await searchChatUsers(q, limit);

    return NextResponse.json({ users }, { status: 200, headers });
  } catch (err: any) {
    console.error("User search error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
