import { createClient, SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Chat Supabase (vksavlswhatwqglsbnfi) - Chat data store
// ============================================================
const chatUrl = process.env.SUPABASE_URL || "https://placeholder.supabase.co";
const chatKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "placeholder-key";

export const supabase: SupabaseClient = createClient(chatUrl, chatKey, {
  auth: { persistSession: false },
});

// ============================================================
// Main Platform Supabase (akiecgwcxadcpqlvntmf) - Auth & user lookups
// Used for: session token validation (sso_tokens), user profiles (users)
// ============================================================
const mainUrl = process.env.MAIN_SUPABASE_URL || "https://placeholder.supabase.co";
const mainKey = process.env.MAIN_SUPABASE_SERVICE_KEY || "placeholder-key";

export const mainSupabase: SupabaseClient = createClient(mainUrl, mainKey, {
  auth: { persistSession: false },
});
