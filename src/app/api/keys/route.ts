import { NextRequest, NextResponse } from "next/server";
import { authenticateAny, type AuthResult } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { handleCORS, corsHeaders } from "@/lib/cors";
import { RegisterKeysSchema, ReplenishKeysSchema, KeyBackupSchema } from "@/lib/validation";

export async function OPTIONS(request: NextRequest) {
  return handleCORS(request) || NextResponse.json({});
}

function getUserId(auth: AuthResult): string | null {
  if (auth.type === "user") return auth.userId;
  return null;
}

// POST /api/keys - Multiplex: register, replenish, or backup based on `action` field
export async function POST(request: NextRequest) {
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
        { error: "User authentication required" },
        { status: 403, headers }
      );
    }

    const body = await request.json();
    const action = body.action as string;

    switch (action) {
      case "register": {
        const parsed = RegisterKeysSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { error: "Invalid key registration data", details: parsed.error.flatten() },
            { status: 400, headers }
          );
        }

        const {
          device_id,
          identity_public_key,
          signed_prekey_public,
          signed_prekey_signature,
          signed_prekey_id,
          one_time_prekeys,
        } = parsed.data;

        // Upsert identity key
        const { error: keyError } = await supabase
          .from("user_identity_keys")
          .upsert(
            {
              user_id: userId,
              device_id,
              identity_public_key,
              signed_prekey_public,
              signed_prekey_signature,
              signed_prekey_id,
              is_active: true,
            },
            { onConflict: "user_id,device_id" }
          );

        if (keyError) {
          console.error("Failed to register identity key:", keyError);
          return NextResponse.json(
            { error: "Failed to register identity key" },
            { status: 500, headers }
          );
        }

        // Batch insert one-time prekeys
        const prekeys = one_time_prekeys.map((pk) => ({
          user_id: userId,
          device_id,
          prekey_id: pk.prekey_id,
          public_key: pk.public_key,
          is_consumed: false,
        }));

        const { error: pkError } = await supabase
          .from("one_time_prekeys")
          .upsert(prekeys, { onConflict: "user_id,device_id,prekey_id" });

        if (pkError) {
          console.error("Failed to register one-time prekeys:", pkError);
          return NextResponse.json(
            { error: "Failed to register one-time prekeys" },
            { status: 500, headers }
          );
        }

        return NextResponse.json(
          {
            registered: true,
            identity_key_registered: true,
            one_time_prekeys_count: one_time_prekeys.length,
          },
          { status: 201, headers }
        );
      }

      case "replenish": {
        const parsed = ReplenishKeysSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { error: "Invalid replenish data", details: parsed.error.flatten() },
            { status: 400, headers }
          );
        }

        const { device_id, one_time_prekeys } = parsed.data;

        const prekeys = one_time_prekeys.map((pk) => ({
          user_id: userId,
          device_id,
          prekey_id: pk.prekey_id,
          public_key: pk.public_key,
          is_consumed: false,
        }));

        const { error } = await supabase
          .from("one_time_prekeys")
          .upsert(prekeys, { onConflict: "user_id,device_id,prekey_id" });

        if (error) {
          return NextResponse.json(
            { error: "Failed to replenish prekeys" },
            { status: 500, headers }
          );
        }

        // Get updated count
        const { data: countData } = await supabase
          .rpc("count_available_prekeys", { p_user_id: userId });

        return NextResponse.json(
          { replenished: one_time_prekeys.length, total_available: countData || 0 },
          { headers }
        );
      }

      case "backup": {
        const parsed = KeyBackupSchema.safeParse(body);
        if (!parsed.success) {
          return NextResponse.json(
            { error: "Invalid backup data", details: parsed.error.flatten() },
            { status: 400, headers }
          );
        }

        const { encrypted_bundle, salt, nonce } = parsed.data;

        const { error } = await supabase
          .from("encrypted_key_backups")
          .upsert(
            {
              user_id: userId,
              encrypted_bundle,
              salt,
              nonce,
              key_version: 1, // Increment on subsequent backups
            },
            { onConflict: "user_id" }
          );

        if (error) {
          return NextResponse.json(
            { error: "Failed to save key backup" },
            { status: 500, headers }
          );
        }

        return NextResponse.json({ backed_up: true }, { headers });
      }

      default:
        return NextResponse.json(
          { error: "Invalid action. Use: register, replenish, or backup" },
          { status: 400, headers }
        );
    }
  } catch (err) {
    console.error("Key management error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}

// GET /api/keys - Get own key backup
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

    const userId = getUserId(auth);
    if (!userId) {
      return NextResponse.json(
        { error: "User authentication required" },
        { status: 403, headers }
      );
    }

    const { data: backup } = await supabase
      .from("encrypted_key_backups")
      .select("encrypted_bundle, salt, nonce, key_version, updated_at")
      .eq("user_id", userId)
      .single();

    if (!backup) {
      return NextResponse.json(
        { error: "No key backup found" },
        { status: 404, headers }
      );
    }

    return NextResponse.json({ backup }, { headers });
  } catch (err) {
    console.error("Get key backup error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers }
    );
  }
}
