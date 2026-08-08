// ============================================================
// Peeap Chat - IndexedDB offline storage (idb wrapper)
// Stores auth, conversations, messages, and user profiles locally
// so the app loads instantly without API calls on every visit.
// ============================================================

import type { Conversation, Message, ChatUser } from "./types";

const DB_NAME = "peeap-chat";
const DB_VERSION = 2;

interface AuthRecord {
  token: string;
  userId: string;
  user: ChatUser | null;
  savedAt: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbPromise: Promise<any> | null = null;

async function getDB() {
  if (typeof window === "undefined") return null;
  if (!dbPromise) {
    // Dynamic import to avoid SSR issues
    const { openDB } = await import("idb");
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("auth")) {
          db.createObjectStore("auth");
        }
        if (!db.objectStoreNames.contains("conversations")) {
          db.createObjectStore("conversations", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("messages")) {
          const msgStore = db.createObjectStore("messages", { keyPath: "id" });
          msgStore.createIndex("by_conversation", "conversation_id");
        }
        if (!db.objectStoreNames.contains("users")) {
          db.createObjectStore("users", { keyPath: "id" });
        }
        // v2: E2EE identity material (private key + device id), on-device only.
        if (!db.objectStoreNames.contains("e2ee")) {
          db.createObjectStore("e2ee");
        }
      },
    });
  }
  return dbPromise;
}

// ── Auth ─────────────────────────────────────────────────────

export async function saveAuth(
  token: string,
  userId: string,
  user: ChatUser | null
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const record: AuthRecord = { token, userId, user, savedAt: Date.now() };
  await db.put("auth", record, "session");
}

export async function loadAuth(): Promise<AuthRecord | null> {
  const db = await getDB();
  if (!db) return null;
  const record = await db.get("auth", "session");
  if (!record) return null;
  // Expire after 30 days
  if (Date.now() - record.savedAt > 30 * 24 * 60 * 60 * 1000) {
    await db.delete("auth", "session");
    return null;
  }
  return record;
}

export async function clearAuth(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete("auth", "session");
}

// ── Conversations ────────────────────────────────────────────

export async function saveConversations(
  conversations: Conversation[]
): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction("conversations", "readwrite");
  await Promise.all([
    ...conversations.map((c) => tx.store.put(c)),
    tx.done,
  ]);
}

export async function loadConversations(): Promise<Conversation[]> {
  const db = await getDB();
  if (!db) return [];
  const all: Conversation[] = await db.getAll("conversations");
  // Sort by last_message_at desc
  return all.sort((a: Conversation, b: Conversation) => {
    const ta = a.last_message_at || a.created_at || "";
    const tb = b.last_message_at || b.created_at || "";
    return tb.localeCompare(ta);
  });
}

// ── Messages ─────────────────────────────────────────────────

export async function saveMessages(messages: Message[]): Promise<void> {
  const db = await getDB();
  if (!db || messages.length === 0) return;
  const tx = db.transaction("messages", "readwrite");
  await Promise.all([
    ...messages.map((m) => tx.store.put(m)),
    tx.done,
  ]);
}

export async function loadMessages(
  conversationId: string,
  limit = 50
): Promise<Message[]> {
  const db = await getDB();
  if (!db) return [];
  const index = db.transaction("messages", "readonly").store.index("by_conversation");
  const all: Message[] = await index.getAll(conversationId);
  // Sort by created_at asc, return last N
  all.sort((a: Message, b: Message) => (a.created_at || "").localeCompare(b.created_at || ""));
  return all.slice(-limit);
}

// ── User Profiles ────────────────────────────────────────────

export async function saveUser(user: ChatUser): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.put("users", user);
}

export async function loadUser(userId: string): Promise<ChatUser | null> {
  const db = await getDB();
  if (!db) return null;
  return (await db.get("users", userId)) ?? null;
}

// ── E2EE identity (private key + device id) ──────────────────
// Stored per (userId) so switching accounts on a shared device doesn't leak
// one user's private key to another.

interface E2EEIdentityRecord {
  userId: string;
  privateKeyB64: string; // PKCS8 base64 of the ECDH identity private key
  publicKeyB64: string; // SPKI base64
  deviceId: string;
  savedAt: number;
}

export async function saveE2EEIdentity(rec: {
  userId: string;
  privateKeyB64: string;
  publicKeyB64: string;
  deviceId: string;
}): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const record: E2EEIdentityRecord = { ...rec, savedAt: Date.now() };
  await db.put("e2ee", record, `identity:${rec.userId}`);
}

export async function loadE2EEIdentity(
  userId: string
): Promise<E2EEIdentityRecord | null> {
  const db = await getDB();
  if (!db) return null;
  return (await db.get("e2ee", `identity:${userId}`)) ?? null;
}

export async function clearE2EEIdentity(userId: string): Promise<void> {
  const db = await getDB();
  if (!db) return;
  await db.delete("e2ee", `identity:${userId}`);
}

// A stable per-device id, generated once and reused across accounts.
export async function getOrCreateDeviceId(): Promise<string> {
  const db = await getDB();
  if (!db) return "web-ephemeral";
  const existing = await db.get("e2ee", "device_id");
  if (existing) return existing as string;
  const id = `web-${crypto.randomUUID()}`;
  await db.put("e2ee", id, "device_id");
  return id;
}

// ── Clear all data (logout) ──────────────────────────────────

export async function clearAllData(): Promise<void> {
  const db = await getDB();
  if (!db) return;
  const tx = db.transaction(
    ["auth", "conversations", "messages", "users", "e2ee"],
    "readwrite"
  );
  await Promise.all([
    tx.objectStore("auth").clear(),
    tx.objectStore("conversations").clear(),
    tx.objectStore("messages").clear(),
    tx.objectStore("users").clear(),
    tx.objectStore("e2ee").clear(),
    tx.done,
  ]);
}
