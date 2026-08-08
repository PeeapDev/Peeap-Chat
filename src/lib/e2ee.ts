// ============================================================
// Peeap Chat — End-to-end encryption core (WebCrypto)
// ============================================================
//
// Model: encrypt-to-each-recipient (ECIES-style), one message key per message.
//
//   - Each user/device has a long-term ECDH P-256 "identity" keypair. The
//     PUBLIC key is published to the server (user_identity_keys); the PRIVATE
//     key never leaves the device except as a password-encrypted backup blob.
//   - For each message the sender:
//       1. generates a random 256-bit content key (CK) + 96-bit IV,
//       2. encrypts the plaintext with AES-256-GCM(CK, IV),
//       3. generates a fresh ephemeral ECDH keypair (E),
//       4. for each recipient R: shared = ECDH(E_priv, R_identity_pub);
//          wrapKey = HKDF-SHA256(shared); wrapped = AES-256-GCM(wrapKey, CK),
//       5. stores { sender_ek_pub, recipient_keys: {userId: wrapped} }.
//   - A recipient reverses it with their identity PRIVATE key + sender_ek_pub.
//
// The server only ever sees ciphertext and wrapped keys — never CK or
// plaintext. This is genuine E2EE.
//
// KNOWN LIMITATION (documented on purpose, not a bug): there is no Double
// Ratchet, so this does not provide per-message forward secrecy against
// compromise of a long-term identity private key — an attacker who steals a
// user's identity key can decrypt past messages addressed to that user. The
// per-message ephemeral sender key does limit exposure from a single leaked
// message key. Upgrading to a ratchet is future work.
// ============================================================

const ECDH_ALGO = { name: "ECDH", namedCurve: "P-256" } as const;
const AES = "AES-GCM";
const SESSION_VERSION = 1;
const HKDF_INFO = "peeap-e2ee-v1";
const PBKDF2_ITERATIONS = 210_000;

export interface EncryptionMetadataV1 {
  sender_ek_pub: string;
  sender_ik_id: string;
  session_version: number;
  recipient_keys: Record<string, string>;
}

export interface EncryptResult {
  encrypted_content: string;
  encryption_metadata: EncryptionMetadataV1;
}

export interface KeyBackupBlob {
  encrypted_bundle: string;
  salt: string;
  nonce: string;
}

// ── byte helpers ─────────────────────────────────────────────

// Copy any typed array into a fresh, non-shared ArrayBuffer. WebCrypto's DOM
// types want a concrete `ArrayBuffer` (not the generic `Uint8Array<ArrayBufferLike>`
// TS 5.7+ produces), so every buffer we hand to crypto.subtle goes through this.
function ab(u: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(u.byteLength);
  new Uint8Array(out).set(u);
  return out;
}

function utf8(s: string): ArrayBuffer {
  return ab(new TextEncoder().encode(s));
}

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function subtle(): SubtleCrypto {
  if (typeof crypto === "undefined" || !crypto.subtle) {
    throw new Error("WebCrypto (crypto.subtle) is not available in this environment");
  }
  return crypto.subtle;
}

export function isE2EESupported(): boolean {
  return (
    typeof crypto !== "undefined" &&
    !!crypto.subtle &&
    typeof crypto.getRandomValues === "function"
  );
}

// ── Identity keypair ─────────────────────────────────────────

export async function generateIdentity(): Promise<CryptoKeyPair> {
  return subtle().generateKey(ECDH_ALGO, true, ["deriveBits"]);
}

export async function exportPublicKey(key: CryptoKey): Promise<string> {
  return toB64(await subtle().exportKey("spki", key));
}

export async function importPublicKey(b64: string): Promise<CryptoKey> {
  return subtle().importKey("spki", ab(fromB64(b64)), ECDH_ALGO, true, []);
}

export async function exportPrivateKey(key: CryptoKey): Promise<string> {
  return toB64(await subtle().exportKey("pkcs8", key));
}

export async function importPrivateKey(b64: string): Promise<CryptoKey> {
  return subtle().importKey("pkcs8", ab(fromB64(b64)), ECDH_ALGO, true, ["deriveBits"]);
}

// ── Shared-secret -> AES wrap key ────────────────────────────

async function deriveWrapKey(
  privateKey: CryptoKey,
  publicKey: CryptoKey,
  saltBytes: Uint8Array
): Promise<CryptoKey> {
  const sharedBits = await subtle().deriveBits(
    { name: "ECDH", public: publicKey },
    privateKey,
    256
  );
  const hkdfKey = await subtle().importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: ab(saltBytes), info: utf8(HKDF_INFO) },
    hkdfKey,
    { name: AES, length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

// ── Encrypt for a set of recipients ──────────────────────────

/**
 * @param recipientPubKeys map of userId -> base64(SPKI identity public key).
 *        Include the sender's OWN userId so the sender can read their own
 *        message from another device.
 */
export async function encryptForRecipients(
  plaintext: string,
  recipientPubKeys: Record<string, string>,
  senderDeviceId: string
): Promise<EncryptResult> {
  const enc = new TextEncoder();

  // 1. Random content key + encrypt the plaintext.
  const contentKey = await subtle().generateKey({ name: AES, length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await subtle().encrypt({ name: AES, iv: ab(iv) }, contentKey, ab(enc.encode(plaintext)))
  );
  const ckRaw = new Uint8Array(await subtle().exportKey("raw", contentKey));

  // 2. Fresh ephemeral keypair for this message.
  const eph = await generateIdentity();
  const senderEkPub = await exportPublicKey(eph.publicKey);

  // 3. Wrap the content key for each recipient.
  const recipient_keys: Record<string, string> = {};
  for (const [userId, pubB64] of Object.entries(recipientPubKeys)) {
    const recipientPub = await importPublicKey(pubB64);
    const wrapKey = await deriveWrapKey(eph.privateKey, recipientPub, enc.encode(userId));
    const iv2 = crypto.getRandomValues(new Uint8Array(12));
    const wrapped = new Uint8Array(
      await subtle().encrypt({ name: AES, iv: ab(iv2) }, wrapKey, ab(ckRaw))
    );
    recipient_keys[userId] = toB64(concat(iv2, wrapped));
  }

  return {
    encrypted_content: toB64(concat(iv, ciphertext)),
    encryption_metadata: {
      sender_ek_pub: senderEkPub,
      sender_ik_id: senderDeviceId,
      session_version: SESSION_VERSION,
      recipient_keys,
    },
  };
}

// ── Decrypt a message addressed to me ────────────────────────

export async function decryptMessage(
  encryptedContent: string,
  metadata: EncryptionMetadataV1,
  myUserId: string,
  myPrivateKey: CryptoKey
): Promise<string> {
  const enc = new TextEncoder();
  const wrappedB64 = metadata.recipient_keys?.[myUserId];
  if (!wrappedB64) {
    throw new Error("Message has no key for this user");
  }

  const ephPub = await importPublicKey(metadata.sender_ek_pub);
  const wrapKey = await deriveWrapKey(myPrivateKey, ephPub, enc.encode(myUserId));

  const wrappedBytes = fromB64(wrappedB64);
  const iv2 = wrappedBytes.subarray(0, 12);
  const wrapped = wrappedBytes.subarray(12);
  const ckRaw = await subtle().decrypt({ name: AES, iv: ab(iv2) }, wrapKey, ab(wrapped));
  const contentKey = await subtle().importKey("raw", ckRaw, { name: AES, length: 256 }, false, [
    "decrypt",
  ]);

  const contentBytes = fromB64(encryptedContent);
  const iv = contentBytes.subarray(0, 12);
  const ct = contentBytes.subarray(12);
  const pt = await subtle().decrypt({ name: AES, iv: ab(iv) }, contentKey, ab(ct));
  return new TextDecoder().decode(pt);
}

// ── Password-encrypted private-key backup (cloud recovery) ────

async function deriveBackupKey(
  password: string,
  saltBytes: Uint8Array,
  usage: KeyUsage
): Promise<CryptoKey> {
  const baseKey = await subtle().importKey("raw", utf8(password), "PBKDF2", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "PBKDF2", salt: ab(saltBytes), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    baseKey,
    { name: AES, length: 256 },
    false,
    [usage]
  );
}

/** Encrypt the base64 private key with a key derived from the recovery password. */
export async function backupPrivateKey(
  privateKeyB64: string,
  password: string
): Promise<KeyBackupBlob> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const aesKey = await deriveBackupKey(password, salt, "encrypt");
  const bundle = await subtle().encrypt(
    { name: AES, iv: ab(nonce) },
    aesKey,
    utf8(privateKeyB64)
  );
  return { encrypted_bundle: toB64(bundle), salt: toB64(salt), nonce: toB64(nonce) };
}

/** Reverse backupPrivateKey. Throws if the password is wrong (GCM tag fails). */
export async function restorePrivateKey(
  blob: KeyBackupBlob,
  password: string
): Promise<string> {
  const aesKey = await deriveBackupKey(password, fromB64(blob.salt), "decrypt");
  const pt = await subtle().decrypt(
    { name: AES, iv: ab(fromB64(blob.nonce)) },
    aesKey,
    ab(fromB64(blob.encrypted_bundle))
  );
  return new TextDecoder().decode(pt);
}
