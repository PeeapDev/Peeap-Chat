import { NextRequest } from "next/server";
import { supabase, mainSupabase } from "@/lib/supabase";

// ============================================================
// Auth - Internal SSO (session token validation against main Supabase)
// Replaces the previous JWKS/JWT auth via auth.peeap.com
// ============================================================

export interface AuthPayload {
  sub: string;
  email?: string;
  phone?: string;
  roles: string[];
  first_name?: string;
  last_name?: string;
}

export type AuthResult =
  | { type: "user"; userId: string; payload: AuthPayload }
  | { type: "platform"; platformId: string; platformOwnerId: string }
  | { type: "service" };

// Cache validated sessions to avoid hitting main Supabase on every request
const sessionCache = new Map<
  string,
  { userId: string; payload: AuthPayload; cachedAt: number }
>();
const SESSION_CACHE_TTL = 2 * 60 * 1000; // 2 minutes

// ============================================================
// Guest sessions (for embeddable public chat)
// In-memory store — guests re-enter name/email on server restart
// ============================================================
interface GuestSession {
  userId: string;
  name: string;
  email: string;
  createdAt: number;
}

const guestSessions = new Map<string, GuestSession>();
const GUEST_SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

export function addGuestSession(
  token: string,
  userId: string,
  name: string,
  email: string
) {
  guestSessions.set(token, { userId, name, email, createdAt: Date.now() });
}

function validateGuestToken(token: string): GuestSession | null {
  const session = guestSessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > GUEST_SESSION_TTL) {
    guestSessions.delete(token);
    return null;
  }
  return session;
}

/**
 * Validate a session token against the main platform's sso_tokens table.
 * Returns the auth payload or null if invalid/expired.
 */
export async function validateSessionToken(
  token: string
): Promise<AuthPayload | null> {
  // Check cache first
  const cached = sessionCache.get(token);
  if (cached && Date.now() - cached.cachedAt < SESSION_CACHE_TTL) {
    return cached.payload;
  }

  try {
    // Validate token against sso_tokens table on main Supabase
    const { data: session, error: sessionError } = await mainSupabase
      .from("sso_tokens")
      .select("user_id, expires_at")
      .eq("token", token)
      .gt("expires_at", new Date().toISOString())
      .single();

    if (sessionError || !session) return null;

    // Fetch user profile from main Supabase
    const { data: user, error: userError } = await mainSupabase
      .from("users")
      .select("id, email, phone, first_name, last_name, roles")
      .eq("id", session.user_id)
      .single();

    if (userError || !user) return null;

    // Parse roles (handles PostgreSQL array format, JSON array, or comma-separated)
    let roles: string[] = [];
    if (Array.isArray(user.roles)) {
      roles = user.roles;
    } else if (typeof user.roles === "string") {
      const raw = user.roles.replace(/[{}[\]"]/g, "").trim();
      roles = raw ? raw.split(",").map((r: string) => r.trim()) : [];
    }

    const payload: AuthPayload = {
      sub: user.id,
      email: user.email || undefined,
      phone: user.phone || undefined,
      roles,
      first_name: user.first_name || undefined,
      last_name: user.last_name || undefined,
    };

    // Cache the result
    sessionCache.set(token, {
      userId: user.id,
      payload,
      cachedAt: Date.now(),
    });

    return payload;
  } catch (err) {
    console.error("Session token validation failed:", err);
    return null;
  }
}

/**
 * Extract and validate token from request.
 * Supports:
 *   1. Authorization: Bearer <session_token> (web - SSO token from sso_tokens table)
 *   2. Authorization: Bearer <base64_payload> (mobile - legacy base64({userId, exp}))
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<AuthPayload | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  // Try SSO token first
  const ssoResult = await validateSessionToken(token);
  if (ssoResult) return ssoResult;

  // Fallback: Try guest token (embeddable chat)
  const guest = validateGuestToken(token);
  if (guest) {
    return {
      sub: guest.userId,
      email: guest.email,
      roles: ["guest"],
      first_name: guest.name,
    };
  }

  // Fallback: Try mobile base64 payload format ({userId, exp})
  try {
    const decoded = Buffer.from(token, "base64").toString("utf-8");
    const parsed = JSON.parse(decoded);
    if (parsed.userId && parsed.exp) {
      // Check expiry
      if (parsed.exp < Date.now()) return null;

      // Verify user exists
      const { data: user, error } = await mainSupabase
        .from("users")
        .select("id, email, phone, first_name, last_name, roles")
        .eq("id", parsed.userId)
        .single();

      if (error || !user) return null;

      let roles: string[] = [];
      if (Array.isArray(user.roles)) {
        roles = user.roles;
      } else if (typeof user.roles === "string") {
        const raw = user.roles.replace(/[{}[\]"]/g, "").trim();
        roles = raw ? raw.split(",").map((r: string) => r.trim()) : [];
      }

      return {
        sub: user.id,
        email: user.email || undefined,
        phone: user.phone || undefined,
        roles,
        first_name: user.first_name || undefined,
        last_name: user.last_name || undefined,
      };
    }
  } catch {
    // Not a valid base64 payload - that's fine
  }

  return null;
}

/**
 * Authenticate via internal service secret (for POS, shipping, etc.)
 */
export function authenticateServiceCall(request: NextRequest): boolean {
  const secret = request.headers.get("x-service-secret");
  return !!secret && secret === process.env.SERVICE_SECRET;
}

/**
 * Authenticate via API key (for third-party platforms).
 * Validates X-Api-Key header against the platforms table on chat Supabase.
 */
async function authenticateApiKey(
  request: NextRequest
): Promise<{ platformId: string; ownerId: string } | null> {
  const apiKey = request.headers.get("x-api-key");
  if (!apiKey) return null;

  try {
    const { data: platform, error } = await supabase
      .from("platforms")
      .select("id, owner_user_id")
      .eq("api_key", apiKey)
      .eq("is_active", true)
      .single();

    if (error || !platform) return null;

    return { platformId: platform.id, ownerId: platform.owner_user_id };
  } catch {
    return null;
  }
}

/**
 * Unified authentication - tries all three methods in order:
 * 1. Session Token (Peeap users via internal SSO)
 * 2. API Key (third-party platforms)
 * 3. Service Secret (internal services like POS, shipping)
 *
 * Returns the auth result or null if all methods fail.
 */
export async function authenticateAny(
  request: NextRequest
): Promise<AuthResult | null> {
  // 1. Try session token auth (SSO + mobile base64 + guest)
  const payload = await authenticateRequest(request);
  if (payload) {
    return { type: "user", userId: payload.sub, payload };
  }

  // 2. Try API key auth
  const apiKeyResult = await authenticateApiKey(request);
  if (apiKeyResult) {
    return {
      type: "platform",
      platformId: apiKeyResult.platformId,
      platformOwnerId: apiKeyResult.ownerId,
    };
  }

  // 3. Try service secret
  if (authenticateServiceCall(request)) {
    return { type: "service" };
  }

  return null;
}

/**
 * Extract user ID from a service-to-service call.
 * When a service calls on behalf of a user, the user_id is passed in the body or header.
 */
export function getServiceCallUserId(request: NextRequest): string | null {
  return request.headers.get("x-user-id");
}
