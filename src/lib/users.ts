import { supabase, mainSupabase } from "@/lib/supabase";

// ============================================================
// User management - fetches from main Supabase, caches in chat_users
// ============================================================

export interface UserProfile {
  id: string;
  email: string | null;
  phone: string | null;
  first_name: string | null;
  last_name: string | null;
  profile_picture: string | null;
  account_type: string;
  roles: string[];
}

export interface ChatUser {
  id: string;
  auth_user_id: string | null;
  platform_id: string | null;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  account_type: string;
  roles: string[];
  status: string;
  last_seen_at: string | null;
}

// Simple in-memory cache for user profiles
const userCache = new Map<string, { user: ChatUser; cachedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Parse roles from various formats (PostgreSQL array, JSON array, comma-separated string)
 */
function parseRoles(roles: unknown): string[] {
  if (Array.isArray(roles)) return roles;
  if (typeof roles === "string") {
    const raw = roles.replace(/[{}[\]"]/g, "").trim();
    return raw ? raw.split(",").map((r: string) => r.trim()) : [];
  }
  return [];
}

/**
 * Get or create a chat_user record. Local-first approach:
 * 1. Check chat_users table first
 * 2. If not found, fetch from main Supabase users table and create local record
 */
export async function getChatUser(
  authUserId: string
): Promise<ChatUser | null> {
  // Check cache
  const cached = userCache.get(authUserId);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
    return cached.user;
  }

  // 1. Check chat_users table
  const { data: existing } = await supabase
    .from("chat_users")
    .select("*")
    .eq("auth_user_id", authUserId)
    .single();

  if (existing) {
    const chatUser = existing as ChatUser;
    userCache.set(authUserId, { user: chatUser, cachedAt: Date.now() });
    return chatUser;
  }

  // 2. Fetch from main Supabase users table and create local record
  try {
    const { data: profile, error: fetchError } = await mainSupabase
      .from("users")
      .select("id, email, phone, first_name, last_name, profile_picture, account_type, roles")
      .eq("id", authUserId)
      .single();

    if (fetchError || !profile) return null;

    const displayName =
      [profile.first_name, profile.last_name].filter(Boolean).join(" ") ||
      profile.email ||
      profile.phone ||
      "Unknown User";

    const { data: newUser, error } = await supabase
      .from("chat_users")
      .upsert(
        {
          auth_user_id: authUserId,
          display_name: displayName,
          avatar_url: profile.profile_picture,
          email: profile.email,
          phone: profile.phone,
          account_type: profile.account_type || "personal",
          roles: parseRoles(profile.roles),
          status: "active",
        },
        { onConflict: "auth_user_id" }
      )
      .select()
      .single();

    if (error || !newUser) {
      // Upsert failed (table might not exist) — return profile directly
      console.warn("chat_users upsert failed, returning profile directly:", error?.message);
      const fallbackUser: ChatUser = {
        id: authUserId,
        auth_user_id: authUserId,
        platform_id: null,
        display_name: displayName,
        avatar_url: profile.profile_picture || null,
        email: profile.email || null,
        phone: profile.phone || null,
        account_type: profile.account_type || "personal",
        roles: parseRoles(profile.roles),
        status: "active",
        last_seen_at: null,
      };
      userCache.set(authUserId, { user: fallbackUser, cachedAt: Date.now() });
      return fallbackUser;
    }

    const chatUser = newUser as ChatUser;
    userCache.set(authUserId, { user: chatUser, cachedAt: Date.now() });
    return chatUser;
  } catch (err) {
    console.error("Failed to fetch/create chat user:", err);
    return null;
  }
}

/**
 * Get multiple chat users by auth_user_ids
 */
export async function getChatUsers(
  authUserIds: string[]
): Promise<Map<string, ChatUser>> {
  const results = new Map<string, ChatUser>();
  const uncached: string[] = [];

  for (const id of authUserIds) {
    const cached = userCache.get(id);
    if (cached && Date.now() - cached.cachedAt < CACHE_TTL) {
      results.set(id, cached.user);
    } else {
      uncached.push(id);
    }
  }

  if (uncached.length > 0) {
    // Batch lookup from chat_users table
    const { data: existingUsers } = await supabase
      .from("chat_users")
      .select("*")
      .in("auth_user_id", uncached);

    const foundIds = new Set<string>();
    for (const user of existingUsers || []) {
      const chatUser = user as ChatUser;
      if (chatUser.auth_user_id) {
        results.set(chatUser.auth_user_id, chatUser);
        userCache.set(chatUser.auth_user_id, {
          user: chatUser,
          cachedAt: Date.now(),
        });
        foundIds.add(chatUser.auth_user_id);
      }
    }

    // Also look up by id directly (for guest users who have auth_user_id=null)
    const stillMissing = uncached.filter((id) => !foundIds.has(id));
    if (stillMissing.length > 0) {
      const { data: byId } = await supabase
        .from("chat_users")
        .select("*")
        .in("id", stillMissing);

      for (const user of byId || []) {
        const chatUser = user as ChatUser;
        results.set(chatUser.id, chatUser);
        userCache.set(chatUser.id, { user: chatUser, cachedAt: Date.now() });
        foundIds.add(chatUser.id);
      }
    }

    // For users not in chat_users at all, fetch from main Supabase
    const notFound = uncached.filter((id) => !foundIds.has(id));
    await Promise.all(
      notFound.map(async (id) => {
        const chatUser = await getChatUser(id);
        if (chatUser) {
          results.set(id, chatUser);
        }
      })
    );
  }

  return results;
}

/**
 * Upsert a chat_user from sync data (service-to-service)
 */
export async function syncChatUser(data: {
  auth_user_id: string;
  display_name: string;
  avatar_url?: string | null;
  email?: string | null;
  phone?: string | null;
  account_type?: string;
  roles?: string[];
}): Promise<ChatUser | null> {
  const { data: user, error } = await supabase
    .from("chat_users")
    .upsert(
      {
        auth_user_id: data.auth_user_id,
        display_name: data.display_name,
        avatar_url: data.avatar_url || null,
        email: data.email || null,
        phone: data.phone || null,
        account_type: data.account_type || "personal",
        roles: data.roles || [],
        status: "active",
      },
      { onConflict: "auth_user_id" }
    )
    .select()
    .single();

  if (error || !user) {
    console.error("Failed to sync chat user:", error);
    return null;
  }

  const chatUser = user as ChatUser;
  userCache.set(data.auth_user_id, { user: chatUser, cachedAt: Date.now() });
  return chatUser;
}

/**
 * Search users by name, email, or phone.
 * Searches the main platform users table directly so ALL Peeap users are discoverable,
 * not just those who've already chatted.
 */
export async function searchChatUsers(
  query: string,
  limit: number = 20
): Promise<ChatUser[]> {
  const searchTerm = `%${query}%`;

  // Search main platform users table (the source of truth for all Peeap users)
  const { data: mainUsers, error: mainError } = await mainSupabase
    .from("users")
    .select("id, email, phone, first_name, last_name, profile_picture, account_type, roles")
    .or(
      `first_name.ilike.${searchTerm},last_name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm},username.ilike.${searchTerm}`
    )
    .limit(limit);

  if (mainError) {
    console.error("Main user search error:", mainError);
    // Fallback to chat_users table
    const { data, error } = await supabase
      .from("chat_users")
      .select("*")
      .or(
        `display_name.ilike.${searchTerm},email.ilike.${searchTerm},phone.ilike.${searchTerm}`
      )
      .eq("status", "active")
      .limit(limit);
    if (error) return [];
    return (data || []) as ChatUser[];
  }

  // Map main users to ChatUser format
  return (mainUsers || []).map((u: any) => ({
    id: u.id,
    auth_user_id: u.id,
    platform_id: null,
    display_name: [u.first_name, u.last_name].filter(Boolean).join(" ") || u.email || u.phone || "Unknown",
    avatar_url: u.profile_picture || null,
    email: u.email || null,
    phone: u.phone || null,
    account_type: u.account_type || "personal",
    roles: Array.isArray(u.roles) ? u.roles : [],
    status: "active",
    last_seen_at: null,
  }));
}

/**
 * Legacy compatibility - kept for existing code that uses getUserProfiles
 */
export async function getUserProfiles(
  userIds: string[]
): Promise<Map<string, UserProfile>> {
  const chatUsers = await getChatUsers(userIds);
  const result = new Map<string, UserProfile>();

  for (const [id, cu] of chatUsers) {
    const nameParts = cu.display_name.split(" ");
    result.set(id, {
      id: cu.auth_user_id || cu.id,
      email: cu.email,
      phone: cu.phone,
      first_name: nameParts[0] || null,
      last_name: nameParts.slice(1).join(" ") || null,
      profile_picture: cu.avatar_url,
      account_type: cu.account_type,
      roles: cu.roles,
    });
  }

  return result;
}
