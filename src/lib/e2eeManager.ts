// ============================================================
// Peeap Chat — E2EE lifecycle manager
// ============================================================
// Ties the crypto core (e2ee.ts) to key storage (db.ts) and the key-exchange
// API (/api/keys). Holds the in-memory unlocked private key for the session.
//
// Only DIRECT and GROUP conversations are encrypted. Support/school/business/
// widget channels stay server-readable so services can keep posting into them.
// ============================================================

import {
  generateIdentity,
  importPrivateKey,
  exportPrivateKey,
  exportPublicKey,
  encryptForRecipients,
  decryptMessage,
  backupPrivateKey,
  restorePrivateKey,
  isE2EESupported,
  type EncryptResult,
  type EncryptionMetadataV1,
  type KeyBackupBlob,
} from "./e2ee";
import {
  loadE2EEIdentity,
  saveE2EEIdentity,
  getOrCreateDeviceId,
} from "./db";

export type E2EEStatus =
  | "unknown" // not initialised yet
  | "unsupported" // browser has no WebCrypto
  | "ready" // identity loaded & unlocked
  | "needs_setup" // no identity anywhere — user must create one
  | "needs_restore" // server backup exists — user must enter recovery password
  | "off"; // user skipped E2EE for this session

const ENCRYPTED_CONVERSATION_TYPES = new Set(["direct", "group"]);

export function isEncryptableConversationType(type: string | undefined | null): boolean {
  return !!type && ENCRYPTED_CONVERSATION_TYPES.has(type);
}

interface ManagerState {
  status: E2EEStatus;
  userId: string | null;
  token: string;
  deviceId: string | null;
  privateKey: CryptoKey | null;
  publicKeyB64: string | null;
  // userId -> base64 identity public key, or null when the user has no keys.
  pubKeyCache: Map<string, string | null>;
}

const state: ManagerState = {
  status: "unknown",
  userId: null,
  token: "",
  deviceId: null,
  privateKey: null,
  publicKeyB64: null,
  pubKeyCache: new Map(),
};

export function getStatus(): E2EEStatus {
  return state.status;
}

export function isReady(): boolean {
  return state.status === "ready" && !!state.privateKey;
}

export function setToken(token: string) {
  state.token = token;
}

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.token}`,
  };
}

/** Publish our public identity key to the server (idempotent upsert). */
async function registerPublicKey(): Promise<void> {
  if (!state.publicKeyB64 || !state.deviceId) return;
  await fetch("/api/keys", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({
      action: "register",
      device_id: state.deviceId,
      identity_public_key: state.publicKeyB64,
    }),
  });
}

/**
 * Determine E2EE state for this user on this device.
 * - identity in IndexedDB      -> "ready"
 * - server backup exists       -> "needs_restore"
 * - nothing anywhere           -> "needs_setup"
 */
export async function init(userId: string, token: string): Promise<E2EEStatus> {
  state.userId = userId;
  state.token = token;
  state.pubKeyCache.clear();

  if (!isE2EESupported()) {
    state.status = "unsupported";
    return state.status;
  }

  state.deviceId = await getOrCreateDeviceId();

  // 1. Local identity present?
  const local = await loadE2EEIdentity(userId);
  if (local) {
    try {
      state.privateKey = await importPrivateKey(local.privateKeyB64);
      state.publicKeyB64 = local.publicKeyB64;
      state.status = "ready";
      // Best-effort: make sure the server still has our public key.
      registerPublicKey().catch(() => {});
      return state.status;
    } catch {
      // Corrupt local key — fall through to restore/setup.
    }
  }

  // 2. Server backup present?
  try {
    const res = await fetch("/api/keys", { headers: authHeaders() });
    if (res.ok) {
      state.status = "needs_restore";
      return state.status;
    }
  } catch {
    // ignore network errors — treat as needs_setup
  }

  // 3. Nothing anywhere.
  state.status = "needs_setup";
  return state.status;
}

/** Create a brand-new identity, register it, and back it up under `password`. */
export async function setup(password: string): Promise<void> {
  if (!state.userId) throw new Error("E2EE not initialised");
  if (!password || password.length < 8) {
    throw new Error("Recovery password must be at least 8 characters");
  }
  state.deviceId = state.deviceId || (await getOrCreateDeviceId());

  const pair = await generateIdentity();
  const privateKeyB64 = await exportPrivateKey(pair.privateKey);
  const publicKeyB64 = await exportPublicKey(pair.publicKey);

  state.privateKey = pair.privateKey;
  state.publicKeyB64 = publicKeyB64;

  await registerPublicKey();

  // Backup both halves so a restore can re-publish the public key too.
  const bundleStr = JSON.stringify({ priv: privateKeyB64, pub: publicKeyB64 });
  const blob = await backupPrivateKey(bundleStr, password);
  await fetch("/api/keys", {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ action: "backup", ...blob }),
  });

  await saveE2EEIdentity({
    userId: state.userId,
    privateKeyB64,
    publicKeyB64,
    deviceId: state.deviceId,
  });

  state.status = "ready";
}

/** Restore identity from the server backup using the recovery `password`. */
export async function restore(password: string): Promise<void> {
  if (!state.userId) throw new Error("E2EE not initialised");
  state.deviceId = state.deviceId || (await getOrCreateDeviceId());

  const res = await fetch("/api/keys", { headers: authHeaders() });
  if (!res.ok) throw new Error("No key backup found on the server");
  const { backup } = (await res.json()) as { backup: KeyBackupBlob };

  let bundleStr: string;
  try {
    bundleStr = await restorePrivateKey(backup, password);
  } catch {
    throw new Error("Incorrect recovery password");
  }

  let priv: string;
  let pub: string;
  try {
    const parsed = JSON.parse(bundleStr) as { priv: string; pub: string };
    priv = parsed.priv;
    pub = parsed.pub;
  } catch {
    throw new Error("Backup is corrupted");
  }

  state.privateKey = await importPrivateKey(priv);
  state.publicKeyB64 = pub;
  await registerPublicKey();

  await saveE2EEIdentity({
    userId: state.userId,
    privateKeyB64: priv,
    publicKeyB64: pub,
    deviceId: state.deviceId,
  });

  state.status = "ready";
}

/** User chose to skip E2EE for this session — messages will send in plaintext. */
export function skip(): void {
  state.status = "off";
}

export function reset(): void {
  state.status = "unknown";
  state.userId = null;
  state.token = "";
  state.privateKey = null;
  state.publicKeyB64 = null;
  state.pubKeyCache.clear();
}

/** Fetch (and cache) a user's public identity key. null => user has no E2EE. */
async function getRecipientPublicKey(userId: string): Promise<string | null> {
  if (state.pubKeyCache.has(userId)) return state.pubKeyCache.get(userId) ?? null;

  // We already know our own key.
  if (userId === state.userId && state.publicKeyB64) {
    state.pubKeyCache.set(userId, state.publicKeyB64);
    return state.publicKeyB64;
  }

  try {
    const res = await fetch(`/api/keys/${encodeURIComponent(userId)}`, {
      headers: authHeaders(),
    });
    if (!res.ok) {
      state.pubKeyCache.set(userId, null);
      return null;
    }
    const { bundle } = (await res.json()) as { bundle?: { identity_key?: string } };
    const key = bundle?.identity_key ?? null;
    state.pubKeyCache.set(userId, key);
    return key;
  } catch {
    state.pubKeyCache.set(userId, null);
    return null;
  }
}

/**
 * Encrypt `plaintext` for every member of the conversation.
 * Returns null when encryption isn't possible (not ready, or a member has no
 * keys) so the caller can fall back to a labelled plaintext send.
 */
export async function encrypt(
  plaintext: string,
  memberUserIds: string[]
): Promise<EncryptResult | null> {
  if (!isReady() || !state.userId || !state.deviceId) return null;

  const recipients = new Set(memberUserIds);
  recipients.add(state.userId); // so we can read our own message on other devices

  const keys: Record<string, string> = {};
  for (const userId of recipients) {
    const pub = await getRecipientPublicKey(userId);
    if (!pub) return null; // a member has no keys -> cannot fully encrypt
    keys[userId] = pub;
  }

  return encryptForRecipients(plaintext, keys, state.deviceId);
}

/** Decrypt a single message addressed to the current user. */
export async function decrypt(
  encryptedContent: string,
  metadata: EncryptionMetadataV1
): Promise<string> {
  if (!state.privateKey || !state.userId) {
    throw new Error("E2EE locked");
  }
  return decryptMessage(encryptedContent, metadata, state.userId, state.privateKey);
}
