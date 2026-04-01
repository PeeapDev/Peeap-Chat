/**
 * Data Migration Script: Move chat data from main Supabase to chat Supabase
 *
 * Migrates:
 *   1. direct_message_threads → conversations + conversation_members
 *   2. direct_messages → messages
 *   3. school_chat_threads → conversations + conversation_members
 *   4. school_chat_messages → messages
 *
 * Run: npx tsx scripts/migrate_chat_data.ts
 *
 * Prerequisites:
 *   - 002_chat_rebuild.sql already run on chat Supabase
 *   - Environment variables set (see below)
 *
 * Environment:
 *   MAIN_SUPABASE_URL - Main platform Supabase URL
 *   MAIN_SUPABASE_SERVICE_KEY - Main platform service role key
 *   SUPABASE_URL - Chat Supabase URL
 *   SUPABASE_SERVICE_ROLE_KEY - Chat service role key
 */

import { createClient } from "@supabase/supabase-js";

// Load from env or defaults
const MAIN_URL = process.env.MAIN_SUPABASE_URL || "https://akiecgwcxadcpqlvntmf.supabase.co";
const MAIN_KEY = process.env.MAIN_SUPABASE_SERVICE_KEY || "";
const CHAT_URL = process.env.SUPABASE_URL || "https://vksavlswhatwqglsbnfi.supabase.co";
const CHAT_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!MAIN_KEY || !CHAT_KEY) {
  console.error("Missing MAIN_SUPABASE_SERVICE_KEY or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const mainDb = createClient(MAIN_URL, MAIN_KEY, { auth: { persistSession: false } });
const chatDb = createClient(CHAT_URL, CHAT_KEY, { auth: { persistSession: false } });

// ID mapping for reference integrity
const threadToConversation = new Map<string, string>();
let totalMigrated = { conversations: 0, messages: 0, members: 0, skipped: 0, errors: 0 };

async function ensureChatUser(userId: string): Promise<void> {
  // Check if user already exists in chat_users
  const { data: existing } = await chatDb
    .from("chat_users")
    .select("id")
    .eq("auth_user_id", userId)
    .single();

  if (existing) return;

  // Fetch from main Supabase
  const { data: user } = await mainDb
    .from("users")
    .select("id, email, phone, first_name, last_name, profile_picture, account_type, roles")
    .eq("id", userId)
    .single();

  if (!user) return;

  const displayName = [user.first_name, user.last_name].filter(Boolean).join(" ") || user.email || user.phone || "Unknown";

  await chatDb.from("chat_users").upsert(
    {
      auth_user_id: userId,
      display_name: displayName,
      avatar_url: user.profile_picture,
      email: user.email,
      phone: user.phone,
      account_type: user.account_type || "personal",
      roles: Array.isArray(user.roles) ? user.roles : [],
      status: "active",
    },
    { onConflict: "auth_user_id" }
  );
}

// ============================================================
// Step 1: Migrate direct_message_threads → conversations
// ============================================================

async function migrateDirectThreads(): Promise<void> {
  console.log("\n📥 Step 1: Migrating direct_message_threads...\n");

  const { data: threads, error } = await mainDb
    .from("direct_message_threads")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch threads:", error);
    return;
  }

  console.log(`Found ${threads?.length || 0} threads to migrate`);

  for (const thread of threads || []) {
    try {
      const user1 = thread.user1_id;
      const user2 = thread.user2_id;

      // Ensure both users exist in chat_users
      await ensureChatUser(user1);
      await ensureChatUser(user2);

      // Check if conversation already exists (idempotent)
      const { data: existingConv } = await chatDb
        .from("conversations")
        .select("id")
        .eq("metadata->>migrated_from", thread.id)
        .single();

      if (existingConv) {
        threadToConversation.set(thread.id, existingConv.id);
        totalMigrated.skipped++;
        continue;
      }

      // Create conversation
      const { data: conv, error: convError } = await chatDb
        .from("conversations")
        .insert({
          type: "direct",
          created_by: user1,
          source: "migration",
          status: thread.status || "active",
          last_message_content: thread.last_message_preview,
          last_message_sender_id: thread.last_message_by,
          last_message_at: thread.last_message_at,
          metadata: { migrated_from: thread.id, migration_date: new Date().toISOString() },
        })
        .select("id")
        .single();

      if (convError || !conv) {
        console.error(`  ❌ Failed to create conversation for thread ${thread.id}:`, convError);
        totalMigrated.errors++;
        continue;
      }

      threadToConversation.set(thread.id, conv.id);

      // Add members
      await chatDb.from("conversation_members").insert([
        {
          conversation_id: conv.id,
          user_id: user1,
          role: "member",
          unread_count: thread.user1_unread_count || 0,
        },
        {
          conversation_id: conv.id,
          user_id: user2,
          role: "member",
          unread_count: thread.user2_unread_count || 0,
        },
      ]);

      totalMigrated.conversations++;
      totalMigrated.members += 2;

      if (totalMigrated.conversations % 50 === 0) {
        console.log(`  ✅ Migrated ${totalMigrated.conversations} conversations...`);
      }
    } catch (err) {
      console.error(`  ❌ Error migrating thread ${thread.id}:`, err);
      totalMigrated.errors++;
    }
  }

  console.log(`\n✅ Migrated ${totalMigrated.conversations} direct conversations`);
}

// ============================================================
// Step 2: Migrate direct_messages → messages
// ============================================================

async function migrateDirectMessages(): Promise<void> {
  console.log("\n📥 Step 2: Migrating direct_messages...\n");

  let offset = 0;
  const batchSize = 500;
  let messageCount = 0;

  while (true) {
    const { data: messages, error } = await mainDb
      .from("direct_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Failed to fetch messages:", error);
      break;
    }

    if (!messages || messages.length === 0) break;

    const inserts = [];

    for (const msg of messages) {
      const conversationId = threadToConversation.get(msg.thread_id);
      if (!conversationId) {
        totalMigrated.skipped++;
        continue;
      }

      inserts.push({
        conversation_id: conversationId,
        sender_id: msg.sender_id,
        content: msg.content,
        message_type: msg.message_type || "text",
        rich_content: msg.rich_content,
        metadata: {
          ...(msg.metadata || {}),
          migrated_from: msg.id,
          original_thread_id: msg.thread_id,
        },
        status: msg.status || "sent",
        is_encrypted: false, // Old messages are not encrypted
        created_at: msg.created_at,
      });
    }

    if (inserts.length > 0) {
      // Insert in sub-batches of 100
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        const { error: insertError } = await chatDb.from("messages").insert(batch);
        if (insertError) {
          console.error(`  ❌ Batch insert error at offset ${offset + i}:`, insertError);
          totalMigrated.errors++;
        } else {
          messageCount += batch.length;
        }
      }
    }

    offset += batchSize;
    if (messageCount % 1000 === 0 && messageCount > 0) {
      console.log(`  ✅ Migrated ${messageCount} messages...`);
    }

    if (messages.length < batchSize) break;
  }

  totalMigrated.messages += messageCount;
  console.log(`\n✅ Migrated ${messageCount} direct messages`);
}

// ============================================================
// Step 3: Migrate school_chat_threads → conversations
// ============================================================

async function migrateSchoolThreads(): Promise<void> {
  console.log("\n📥 Step 3: Migrating school_chat_threads...\n");

  const { data: threads, error } = await mainDb
    .from("school_chat_threads")
    .select("*")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Failed to fetch school threads:", error);
    return;
  }

  console.log(`Found ${threads?.length || 0} school threads to migrate`);
  let schoolConvCount = 0;

  for (const thread of threads || []) {
    try {
      // Check if already migrated
      const { data: existingConv } = await chatDb
        .from("conversations")
        .select("id")
        .eq("metadata->>migrated_from_school", thread.id)
        .single();

      if (existingConv) {
        threadToConversation.set(thread.id, existingConv.id);
        totalMigrated.skipped++;
        continue;
      }

      // Map thread type
      const typeMap: Record<string, string> = {
        direct: "school_direct",
        class_group: "school_class",
        school_wide: "group",
        support: "support",
      };

      const convType = typeMap[thread.thread_type] || "school_direct";

      // Ensure parent user exists in chat_users
      if (thread.parent_user_id) {
        await ensureChatUser(thread.parent_user_id);
      }

      const { data: conv, error: convError } = await chatDb
        .from("conversations")
        .insert({
          type: convType,
          name: thread.title || thread.class_name || thread.school_name,
          created_by: thread.parent_user_id || thread.created_by_staff_id || "system",
          source: "school_migration",
          school_id: thread.school_id,
          school_name: thread.school_name,
          status: thread.status || "active",
          last_message_content: thread.last_message_preview,
          last_message_at: thread.last_message_at,
          metadata: {
            migrated_from_school: thread.id,
            migration_date: new Date().toISOString(),
            peeap_school_id: thread.peeap_school_id,
            class_id: thread.class_id,
          },
        })
        .select("id")
        .single();

      if (convError || !conv) {
        console.error(`  ❌ Failed to create school conversation ${thread.id}:`, convError);
        totalMigrated.errors++;
        continue;
      }

      threadToConversation.set(thread.id, conv.id);

      // Add parent as member if direct thread
      if (thread.parent_user_id) {
        await chatDb.from("conversation_members").insert({
          conversation_id: conv.id,
          user_id: thread.parent_user_id,
          role: "member",
          unread_count: thread.parent_unread_count || 0,
        });
        totalMigrated.members++;
      }

      schoolConvCount++;
      totalMigrated.conversations++;
    } catch (err) {
      console.error(`  ❌ Error migrating school thread ${thread.id}:`, err);
      totalMigrated.errors++;
    }
  }

  console.log(`\n✅ Migrated ${schoolConvCount} school conversations`);
}

// ============================================================
// Step 4: Migrate school_chat_messages → messages
// ============================================================

async function migrateSchoolMessages(): Promise<void> {
  console.log("\n📥 Step 4: Migrating school_chat_messages...\n");

  let offset = 0;
  const batchSize = 500;
  let messageCount = 0;

  while (true) {
    const { data: messages, error } = await mainDb
      .from("school_chat_messages")
      .select("*")
      .order("created_at", { ascending: true })
      .range(offset, offset + batchSize - 1);

    if (error) {
      console.error("Failed to fetch school messages:", error);
      break;
    }

    if (!messages || messages.length === 0) break;

    const inserts = [];

    for (const msg of messages) {
      const conversationId = threadToConversation.get(msg.thread_id);
      if (!conversationId) {
        totalMigrated.skipped++;
        continue;
      }

      inserts.push({
        conversation_id: conversationId,
        sender_id: msg.sender_id || "system",
        content: msg.content,
        message_type: msg.message_type || "text",
        rich_content: msg.rich_content,
        metadata: {
          ...(msg.metadata || {}),
          migrated_from_school: msg.id,
          sender_type: msg.sender_type,
          sender_role: msg.sender_role,
        },
        status: msg.status || "sent",
        is_encrypted: false,
        created_at: msg.created_at,
      });
    }

    if (inserts.length > 0) {
      for (let i = 0; i < inserts.length; i += 100) {
        const batch = inserts.slice(i, i + 100);
        const { error: insertError } = await chatDb.from("messages").insert(batch);
        if (insertError) {
          console.error(`  ❌ Batch insert error:`, insertError);
          totalMigrated.errors++;
        } else {
          messageCount += batch.length;
        }
      }
    }

    offset += batchSize;
    if (messages.length < batchSize) break;
  }

  totalMigrated.messages += messageCount;
  console.log(`\n✅ Migrated ${messageCount} school messages`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log("╔═══════════════════════════════════════════════╗");
  console.log("║  Peeap Chat Data Migration                   ║");
  console.log("║  Main Supabase → Chat Supabase               ║");
  console.log("╚═══════════════════════════════════════════════╝\n");

  console.log(`Main DB: ${MAIN_URL}`);
  console.log(`Chat DB: ${CHAT_URL}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  await migrateDirectThreads();
  await migrateDirectMessages();
  await migrateSchoolThreads();
  await migrateSchoolMessages();

  console.log("\n╔═══════════════════════════════════════════════╗");
  console.log("║  Migration Complete                           ║");
  console.log("╚═══════════════════════════════════════════════╝\n");
  console.log(`  Conversations: ${totalMigrated.conversations}`);
  console.log(`  Members:       ${totalMigrated.members}`);
  console.log(`  Messages:      ${totalMigrated.messages}`);
  console.log(`  Skipped:       ${totalMigrated.skipped}`);
  console.log(`  Errors:        ${totalMigrated.errors}`);
  console.log(`\nFinished: ${new Date().toISOString()}`);
}

main().catch(console.error);
