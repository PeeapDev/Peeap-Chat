# Peeap Chat System Rebuild - Implementation Guide

## Status: ALL PHASES COMPLETE (1-7)

---

## What's Done (Backend)

### Phase 1: Auth Migration (COMPLETE)
- `src/lib/supabase.ts` — Dual Supabase clients (chat + main platform)
- `src/lib/auth.ts` — Session token auth via `sso_tokens` table (replaced JWKS/jose)
- `src/lib/users.ts` — User sync from main Supabase `users` table
- `src/lib/cors.ts` — Added store/shipping/cards/chat origins
- `package.json` — Removed `jose` dependency

**Env vars needed on Vercel for peeap-chat:**
```
MAIN_SUPABASE_URL=https://akiecgwcxadcpqlvntmf.supabase.co
MAIN_SUPABASE_SERVICE_KEY=<main platform service role key>
PEEAP_API_URL=https://api.peeap.com
POS_API_URL=https://store.peeap.com
SERVICE_SECRET=<shared service secret>
```

### Phase 2: Database Schema (COMPLETE)
- `supabase/migrations/002_chat_rebuild.sql` — Run this in Supabase SQL Editor on `vksavlswhatwqglsbnfi`
- Adds 7 new tables + E2EE columns on messages + helper functions + RLS + triggers

### Phase 3: API Routes (COMPLETE)
New routes built:
| Route | Method | Purpose |
|-------|--------|---------|
| `/api/conversations/:id/commands` | POST/GET | Slash command execution |
| `/api/ecommerce/messages` | POST | Service-to-service (POS/shipping) |
| `/api/keys` | POST/GET | Key register/replenish/backup |
| `/api/keys/:userId` | GET | Fetch key bundle for E2EE |
| `/api/media/upload` | POST | Encrypted media upload |
| `/api/admin/broadcasts` | POST/GET | System broadcasts |

Existing route updated:
- `/api/conversations/:id/messages` POST — Now accepts `encrypted_content`, `encryption_metadata`, `is_encrypted`

---

## What's Remaining

### Phase 4: E2EE Crypto Libraries

#### 4.1 Protocol Summary
- **Key Exchange**: X3DH (Extended Triple Diffie-Hellman) using X25519 curves
- **Message Encryption**: AES-256-GCM with random 12-byte nonce per message
- **Group Chat**: Fan-out encryption (random symmetric key encrypted per-member)
- **System Messages**: Server encrypts using recipient's public identity key

#### 4.2 Web Crypto Library (`apps/web/src/lib/e2ee/`)

Create 4 files:

**`crypto.ts`** — Core crypto primitives:
```typescript
// Key generation
async function generateX25519KeyPair(): Promise<CryptoKeyPair>
// Uses Web Crypto API: crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveKey"])
// Fallback: tweetnacl-js box.keyPair() for older browsers

// Shared secret derivation
async function deriveSharedSecret(privateKey: CryptoKey, publicKey: CryptoKey): Promise<CryptoKey>
// Uses ECDH key derivation

// Message encryption
async function encryptMessage(key: ArrayBuffer, plaintext: string): Promise<{ ciphertext: string; nonce: string }>
// AES-256-GCM with crypto.getRandomValues() for nonce
// Returns base64(nonce || ciphertext || authTag)

// Message decryption
async function decryptMessage(key: ArrayBuffer, encryptedContent: string): Promise<string>
// Splits nonce, ciphertext, tag from base64 input

// HKDF key derivation
async function hkdf(inputKeyMaterial: ArrayBuffer, salt: ArrayBuffer, info: string): Promise<ArrayBuffer>

// Key serialization
async function exportKey(key: CryptoKey): Promise<string> // base64
async function importKey(base64Key: string): Promise<CryptoKey>
```

**`keyStore.ts`** — IndexedDB key storage:
```typescript
// Database: "peeap-e2ee-keys"
// Object stores: "identity_keys", "signed_prekeys", "one_time_prekeys", "sessions"

class E2EEKeyStore {
  async init(): Promise<void>
  async saveIdentityKeyPair(keyPair: CryptoKeyPair): Promise<void>
  async getIdentityKeyPair(): Promise<CryptoKeyPair | null>
  async saveSignedPreKey(id: number, keyPair: CryptoKeyPair, signature: string): Promise<void>
  async generateOneTimePreKeys(startId: number, count: number): Promise<PreKeyBundle[]>
  async getSession(userId: string): Promise<SessionState | null>
  async saveSession(userId: string, session: SessionState): Promise<void>
  async clearAll(): Promise<void> // For logout
}
```

**`session.ts`** — E2EE session management:
```typescript
class E2EESession {
  // X3DH key exchange
  async initiateSession(recipientUserId: string): Promise<SessionState>
  // 1. Fetch key bundle from GET /api/keys/:userId/bundle
  // 2. Generate ephemeral key
  // 3. Compute DH1-DH4
  // 4. Derive master secret via HKDF
  // 5. Store session locally

  async getOrCreateSession(userId: string): Promise<SessionState>

  // Per-message encrypt/decrypt
  async encryptForRecipient(userId: string, plaintext: string): Promise<EncryptedPayload>
  async decryptFromSender(userId: string, payload: EncryptedPayload): Promise<string>

  // Group encryption
  async encryptForGroup(memberIds: string[], plaintext: string): Promise<GroupEncryptedPayload>
  async decryptGroupMessage(payload: GroupEncryptedPayload): Promise<string>
}
```

**`keyBackup.ts`** — PIN-based backup/restore:
```typescript
// Backup: PBKDF2(pin, salt, 100000, SHA-256) → AES key → encrypt all private keys
async function backupKeys(pin: string): Promise<void>
// 1. Export all private keys from keyStore
// 2. Generate random salt
// 3. Derive AES key from PIN via PBKDF2
// 4. Encrypt serialized keys with AES-256-GCM
// 5. Upload to POST /api/keys { action: "backup" }

// Restore: Fetch backup → derive key from PIN → decrypt → import keys
async function restoreKeys(pin: string): Promise<boolean>
// 1. GET /api/keys (backup)
// 2. Derive AES key from PIN
// 3. Decrypt bundle
// 4. Import all keys into keyStore
```

**Web dependency to add**: `tweetnacl` (npm) as X25519 fallback for older browsers.

#### 4.3 Flutter Crypto Library (`apps/mobile/lib/core/crypto/`)

Create 4 files:

**`e2ee_service.dart`** — Core crypto:
```dart
class E2EEService {
  // Uses pointycastle for X25519, encrypt package for AES-256-GCM

  AsymmetricKeyPair generateX25519KeyPair()
  Uint8List deriveSharedSecret(Uint8List privateKey, Uint8List publicKey)
  EncryptedData encryptMessage(Uint8List key, String plaintext)
  String decryptMessage(Uint8List key, EncryptedData data)
  Uint8List hkdf(Uint8List inputKey, Uint8List salt, String info)
}
```

**`key_manager.dart`** — Key lifecycle:
```dart
class KeyManager {
  // Uses flutter_secure_storage for private key storage

  Future<void> generateAndRegisterKeys() // Called on first login
  Future<KeyBundle> getKeyBundle(String userId) // Fetch from API
  Future<void> replenishPreKeys() // When count < 10
  Future<void> backupKeys(String pin) // PBKDF2 + AES backup
  Future<bool> restoreKeys(String pin) // Restore on new device
  Future<bool> hasKeys() // Check if device has keys
}
```

**`chat_crypto.dart`** — High-level encrypt/decrypt:
```dart
class ChatCrypto {
  // Transparent message encryption for chat_service.dart

  Future<Map<String, dynamic>> encryptMessage(String recipientId, String content)
  // Returns: { encrypted_content, encryption_metadata, is_encrypted: true }

  Future<String> decryptMessage(String senderId, Map<String, dynamic> message)
  // Extracts encrypted_content + metadata, decrypts, returns plaintext

  Future<Map<String, dynamic>> encryptGroupMessage(List<String> memberIds, String content)
  Future<String> decryptGroupMessage(Map<String, dynamic> message)
}
```

**`key_backup.dart`** — PIN-based backup:
```dart
class KeyBackup {
  Future<void> backup(String pin) // PBKDF2 + encrypt + upload
  Future<bool> restore(String pin) // Download + decrypt + import
  Future<bool> hasBackup() // Check if backup exists on server
}
```

**Flutter packages already available**: `encrypt: ^5.0.3`, `pointycastle: ^3.9.1`, `flutter_secure_storage: ^10.0.0`

**May need to add**: `cryptography_flutter` or use pointycastle's X25519 directly.

---

### Phase 5: Randomized PIN Keypad

#### 5.1 Web Component (`apps/web/src/components/chat/RandomizedPinKeypad.tsx`)

```tsx
// React modal component
// Props: { isOpen, onClose, onVerified, title?, description? }
//
// State: shuffledDigits (Fisher-Yates shuffle on mount + on error)
// Uses crypto.getRandomValues() for secure shuffle
//
// Layout: 4x3 grid (3 rows of 3 digits + bottom row: biometric/digit/delete)
// Calls: api.peeap.com/api/auth/verify-pin to validate
// Returns: Promise<boolean> via onVerified callback
//
// Fisher-Yates shuffle:
//   const digits = ['0','1','2','3','4','5','6','7','8','9'];
//   const arr = new Uint32Array(10);
//   crypto.getRandomValues(arr);
//   for (let i = 9; i > 0; i--) {
//     const j = arr[i] % (i + 1);
//     [digits[i], digits[j]] = [digits[j], digits[i]];
//   }
```

#### 5.2 Flutter Widget Update (`apps/mobile/lib/shared/widgets/pin_verification_sheet.dart`)

Add `randomize` parameter:
```dart
static Future<bool?> show(BuildContext context, {
  required String userId,
  bool randomize = false,  // NEW - only true for chat financial commands
  String? transactionAmount,
  String? transactionCurrency,
  String? recipientName,
})

// In state:
List<String> _shuffledDigits = ['0','1','2','3','4','5','6','7','8','9'];

void _shuffleDigits() {
  final random = Random.secure();
  for (int i = _shuffledDigits.length - 1; i > 0; i--) {
    int j = random.nextInt(i + 1);
    final temp = _shuffledDigits[i];
    _shuffledDigits[i] = _shuffledDigits[j];
    _shuffledDigits[j] = temp;
  }
  setState(() {});
}

// Call _shuffleDigits() in initState if randomize == true
// Call _shuffleDigits() again on incorrect PIN attempt
// Build grid from _shuffledDigits instead of hardcoded '1','2','3'...
```

---

### Phase 6: Client Integration

#### 6.1 Web Chat Service (`apps/web/src/services/chat.service.ts`)

New service replacing direct Supabase access + schoolChat.service.ts:

```typescript
const CHAT_API = import.meta.env.VITE_CHAT_API_URL || 'https://chat.peeap.com/api';

class ChatService {
  private getToken() { return authService.getTokens()?.sessionToken; }

  // Conversations
  async getConversations(params?): Promise<Conversation[]>
  async createConversation(type, memberIds, name?): Promise<Conversation>
  async getConversation(id): Promise<Conversation>

  // Messages (with automatic E2EE)
  async sendMessage(conversationId, content, type, richContent?): Promise<Message>
  // → Encrypts via e2eeSession.encryptForRecipient() before sending

  async getMessages(conversationId, params?): Promise<Message[]>
  // → Decrypts each message via e2eeSession.decryptFromSender()

  // Slash commands
  async executeCommand(conversationId, command, args, pinVerified?): Promise<CommandResult>

  // Key management
  async registerKeys(keyBundle): Promise<void>
  async getKeyBundle(userId): Promise<KeyBundle>

  // Media
  async uploadMedia(conversationId, file, isEncrypted?): Promise<MediaResult>

  // Realtime: Use Supabase client pointed at chat Supabase for subscriptions
  subscribeToMessages(conversationId, callback): RealtimeChannel
  subscribeToConversations(callback): RealtimeChannel
}
```

**Env var to add**: `VITE_CHAT_API_URL=https://chat.peeap.com/api`

**Supabase client for realtime** (chat Supabase, anon key):
```typescript
const chatSupabase = createClient(
  import.meta.env.VITE_CHAT_SUPABASE_URL,
  import.meta.env.VITE_CHAT_SUPABASE_ANON_KEY
);
```

**Env vars**: `VITE_CHAT_SUPABASE_URL`, `VITE_CHAT_SUPABASE_ANON_KEY`

#### 6.2 Web Chat UI Components (`apps/web/src/components/chat/` + `apps/web/src/pages/ChatPage.tsx`)

Components needed:
- `ChatPage.tsx` — Main chat page with sidebar + conversation view
- `ChatSidebar.tsx` — Conversation list with search + new chat button
- `ChatConversation.tsx` — Message list + input area
- `MessageBubble.tsx` — Single message with E2EE lock icon
- `SlashCommandParser.tsx` — Autocomplete for `/` commands
- `ProductCard.tsx` — Render product_card messages
- `InvoiceCard.tsx` — Render invoice messages with pay button
- `ShippingCard.tsx` — Render shipping_update messages with tracking
- `PaymentConfirmation.tsx` — Render payment_confirmation messages
- `RandomizedPinKeypad.tsx` — PIN popup for financial commands
- `VoiceRecorder.tsx` — Voice message recording

#### 6.3 Mobile Chat Migration

**`apps/mobile/lib/core/services/chat_service.dart`** — Replace Supabase direct queries with HTTP API calls:
```dart
class ChatService {
  final String _baseUrl; // chat.peeap.com/api
  final String _sessionToken;

  // Replace: _client.from('direct_message_threads')
  // With:    http.get('$_baseUrl/conversations', headers: {'Authorization': 'Bearer $_sessionToken'})

  // Add E2EE layer via ChatCrypto
  Future<void> sendMessage(String threadId, String content, String type) async {
    final encrypted = await _chatCrypto.encryptMessage(recipientId, content);
    await _apiCall('/conversations/$threadId/messages', method: 'POST', body: encrypted);
  }
}
```

**`apps/mobile/lib/core/config/env_config.dart`** — Add:
```dart
static const chatApiUrl = 'https://chat.peeap.com/api';
static const chatSupabaseUrl = 'https://vksavlswhatwqglsbnfi.supabase.co';
static const chatSupabaseAnonKey = '<anon key>';
```

**`apps/mobile/lib/features/chat/presentation/screens/chat_screen.dart`** — Add:
- Slash command detection in text input (starts with `/`)
- Autocomplete dropdown for commands
- Product/invoice/shipping card widgets for rich messages
- E2EE lock icon on encrypted messages
- Voice message recording button

---

### Phase 7: Data Migration

**Script**: `peeap-chat/scripts/migrate_chat_data.ts`

```typescript
// Run once after all other phases are deployed
// Reads from main Supabase, writes to chat Supabase

// Step 1: Migrate direct_message_threads → conversations
// Step 2: Migrate direct_messages → messages (is_encrypted=false)
// Step 3: Migrate school_chat_threads → conversations (type=school_direct/school_class)
// Step 4: Migrate school_chat_messages → messages
// Step 5: Create conversation_members from thread participants
// Step 6: Log ID mappings for reference

// After 30 days with no issues: deprecate old tables on main Supabase
```

---

## Deployment Checklist

### Before deploying:
1. Run `002_chat_rebuild.sql` on chat Supabase (`vksavlswhatwqglsbnfi`)
2. Create `chat-media` storage bucket on chat Supabase
3. Set env vars on Vercel for peeap-chat project
4. Add `tweetnacl` to web app dependencies

### Deploy order:
1. Deploy peeap-chat service (backend)
2. Deploy web app with new chat service + E2EE + PIN keypad
3. Deploy mobile app with updated chat service + crypto
4. Run data migration script
5. Monitor for 30 days, then deprecate old tables

### Testing:
- `curl -H "Authorization: Bearer <session_token>" https://chat.peeap.com/api/conversations` — Verify SSO auth works
- `curl -X POST -H "X-Service-Secret: <secret>" https://chat.peeap.com/api/ecommerce/messages` — Verify service auth
- Register E2EE keys → fetch key bundle → send encrypted message → decrypt
- Test `/send @user 500` → PIN popup → transfer executes
- Simulate POS purchase → verify invoice + shipping messages appear

---

## Architecture Diagram

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Web App    │     │ Mobile App  │     │  POS/Ship   │
│ (my.peeap)  │     │  (Flutter)  │     │ (store/ship)│
└──────┬──────┘     └──────┬──────┘     └──────┬──────┘
       │ E2EE              │ E2EE              │ Service
       │ encrypted         │ encrypted         │ Secret
       ▼                   ▼                   ▼
┌──────────────────────────────────────────────────────┐
│              chat.peeap.com (Next.js 14)             │
│  ┌─────────┐ ┌──────────┐ ┌────────┐ ┌───────────┐  │
│  │ Auth    │ │ Messages │ │ Keys   │ │ Commands  │  │
│  │(SSO tok)│ │(E2EE)    │ │(X3DH)  │ │(/send etc)│  │
│  └────┬────┘ └────┬─────┘ └───┬────┘ └─────┬─────┘  │
│       │           │           │             │        │
│  ┌────▼───────────▼───────────▼─────────────▼─────┐  │
│  │      Chat Supabase (vksavlswhatwqglsbnfi)      │  │
│  │  conversations, messages, user_identity_keys,   │  │
│  │  one_time_prekeys, slash_command_executions,     │  │
│  │  ecommerce_messages, system_broadcasts, etc.     │  │
│  └────────────────────────────────────────────────┘  │
│       │                                              │
│  ┌────▼────────────────────────────────────────────┐ │
│  │      Main Supabase (akiecgwcxadcpqlvntmf)       │ │
│  │  sso_tokens (auth), users (profiles)            │ │
│  └─────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
       │
       │ Financial commands call:
       ▼
┌──────────────┐
│ api.peeap.com│
│ (transfers,  │
│  wallets,    │
│  checkout)   │
└──────────────┘
```

## Slash Command Reference

| Command | Syntax | Requires PIN | Action |
|---------|--------|-------------|--------|
| `/send` | `/send @username 50000` | Yes | Transfer money to user |
| `/invoice` | `/invoice 100000 "Web design"` | Yes | Create and send invoice |
| `/request` | `/request 25000 "Lunch split"` | Yes | Request money from user |
| `/create` | `/create 75000 "Product payment"` | Yes | Create payment link |
| `/transaction` | `/transaction` or `/transaction <id>` | No | Share transaction details |
| `/product` | `/product <product_id>` | No | Send product card |

## E2EE Message Flow

```
SENDER                          SERVER                         RECIPIENT
  │                               │                               │
  │ 1. Check session exists       │                               │
  │    (local IndexedDB/secure    │                               │
  │     storage)                  │                               │
  │                               │                               │
  │ 2. If no session:             │                               │
  │    GET /keys/:recipientId ───►│                               │
  │    ◄── key bundle             │                               │
  │    X3DH → master secret       │                               │
  │    Save session locally       │                               │
  │                               │                               │
  │ 3. Encrypt message:           │                               │
  │    nonce = random(12)         │                               │
  │    ct = AES-GCM(key, nonce,   │                               │
  │         plaintext)            │                               │
  │                               │                               │
  │ 4. POST /messages ───────────►│                               │
  │    { encrypted_content:       │ 5. Store ciphertext           │
  │      base64(nonce||ct||tag),  │    content = "[encrypted]"    │
  │      encryption_metadata,     │    is_encrypted = true        │
  │      is_encrypted: true }     │                               │
  │                               │ 6. Realtime push ────────────►│
  │                               │                               │
  │                               │                    7. Receive │
  │                               │                    8. Get/create session
  │                               │                    9. Decrypt:│
  │                               │                       Split nonce, ct, tag
  │                               │                       AES-GCM decrypt
  │                               │                    10. Display│
```

## PIN Keypad Randomization

```
Standard layout:        Randomized (example):
┌───┬───┬───┐          ┌───┬───┬───┐
│ 1 │ 2 │ 3 │          │ 7 │ 3 │ 9 │
├───┼───┼───┤          ├───┼───┼───┤
│ 4 │ 5 │ 6 │          │ 1 │ 8 │ 4 │
├───┼───┼───┤          ├───┼───┼───┤
│ 7 │ 8 │ 9 │          │ 6 │ 0 │ 2 │
├───┼───┼───┤          ├───┼───┼───┤
│ 🔒│ 0 │ ⌫ │          │ 🔒│ 5 │ ⌫ │
└───┴───┴───┘          └───┴───┴───┘

- Shuffled using Fisher-Yates with crypto.getRandomValues() (web) / Random.secure() (mobile)
- Re-shuffles on each incorrect attempt
- Only activated for chat financial commands (randomize=true)
- Standard keypad kept for wallet/payment PIN entry
```
