import { NextRequest, NextResponse } from "next/server";
import { authenticateAny } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

// GET /api/keys/:userId/bundle - Fetch key bundle for initiating E2EE session
// Returns: identity key, signed prekey, one one-time prekey (consumed atomically)
export async function GET(
  request: NextRequest,
  { params }: { params: { userId: string } }
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

    const requesterId = auth.type === "user" ? auth.userId : null;
    if (!requesterId) {
      return NextResponse.json(
        { error: "User authentication required" },
        { status: 403, headers }
      );
    }

    const targetUserId = params.userId;

    // Fetch active identity key for the target user
    const { data: identityKey, error: ikError } = await supabase
      .from("user_identity_keys")
      .select("*")
      .eq("user_id", targetUserId)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    if (ikError || !identityKey) {
      return NextResponse.json(
        { error: "No encryption keys found for this user. They may not have E2EE enabled." },
        { status: 404, headers }
      );
    }

    // Atomically consume one one-time prekey
    const { data: otpKey } = await supabase.rpc("consume_one_time_prekey", {
      p_user_id: targetUserId,
      p_consumed_by: requesterId,
    });

    // Build key bundle
    const bundle: Record<string, unknown> = {
      identity_key: identityKey.identity_public_key,
      signed_prekey: identityKey.signed_prekey_public,
      signed_prekey_signature: identityKey.signed_prekey_signature,
      signed_prekey_id: identityKey.signed_prekey_id,
      device_id: identityKey.device_id,
    };

    // Include one-time prekey if available
    if (otpKey && otpKey.length > 0) {
      bundle.one_time_prekey = otpKey[0].public_key;
      bundle.one_time_prekey_id = otpKey[0].prekey_id;
    }

    // Check remaining prekey count and warn if low
    const { data: remainingCount } = await supabase.rpc("count_available_prekeys", {
      p_user_id: targetUserId,
    });

    if (remainingCount !== null && remainingCount < 10) {
      bundle.prekey_count_low = true;
      bundle.remaining_prekeys = remainingCount;
    }

    return NextResponse.json({ bundle }, { headers });
  } catch (err) {
    console.error("Get key bundle error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
