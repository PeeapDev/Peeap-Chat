import { z } from "zod";

// ============================================================
// Conversation schemas
// ============================================================

export const CreateConversationSchema = z.object({
  type: z.enum([
    "direct",
    "group",
    "support",
    "school_direct",
    "school_class",
    "business_channel",
    "widget",
    "b2b",
  ]),
  name: z.string().max(200).optional(),
  member_ids: z.array(z.string().uuid()).min(1),
  metadata: z.record(z.any()).optional(),
  school_id: z.string().optional(),
  school_name: z.string().optional(),
  business_id: z.string().optional(),
  is_announcement_only: z.boolean().optional(),
  platform_id: z.string().uuid().optional(),
});

export const UpdateConversationSchema = z.object({
  name: z.string().max(200).optional(),
  status: z.enum(["active", "archived", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  is_announcement_only: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
});

// ============================================================
// Message schemas
// ============================================================

export const SendMessageSchema = z.object({
  content: z.string().max(10000).optional(),
  message_type: z
    .enum([
      "text",
      "image",
      "file",
      "audio",
      "video",
      "invoice",
      "receipt",
      "payment_request",
      "payment_confirmation",
      "fee_notice",
      "salary_slip",
      "announcement",
      "system",
      "location",
      "contact",
      "sticker",
      "poll",
      "link_preview",
      "product_card",
      "order_update",
      "shipping_update",
      "slash_command_result",
      "payment_link",
      "voice_note",
    ])
    .default("text"),
  rich_content: z.record(z.any()).optional(),
  attachments: z.array(z.record(z.any())).optional(),
  metadata: z.record(z.any()).optional(),
  reply_to: z.string().uuid().optional(),
  // E2EE fields
  encrypted_content: z.string().optional(),
  encryption_metadata: z.record(z.any()).optional(),
  is_encrypted: z.boolean().optional(),
}).refine(
  (data) => data.content || data.rich_content || data.attachments || data.encrypted_content,
  { message: "Message must have content, rich_content, attachments, or encrypted_content" }
);

export const EditMessageSchema = z.object({
  content: z.string().max(10000),
});

// ============================================================
// Member schemas
// ============================================================

export const AddMemberSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1).max(100),
  role: z.enum(["member", "moderator", "observer"]).default("member"),
});

export const UpdateMemberRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: z.enum(["admin", "moderator", "member", "observer"]),
});

export const RemoveMemberSchema = z.object({
  user_ids: z.array(z.string().uuid()).min(1),
});

// ============================================================
// User schemas
// ============================================================

export const SyncUserSchema = z.object({
  auth_user_id: z.string().uuid(),
  display_name: z.string().min(1).max(200),
  avatar_url: z.string().url().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  account_type: z.string().default("personal"),
  roles: z.array(z.string()).default([]),
});

export const SearchUsersSchema = z.object({
  q: z.string().min(1).max(100),
  limit: z.coerce.number().min(1).max(50).default(20),
});

// ============================================================
// Slash command schemas
// ============================================================

const FINANCIAL_COMMANDS = ["invoice", "send", "request", "create"] as const;
const ALL_COMMANDS = ["invoice", "send", "request", "product", "transaction", "create"] as const;

export const ExecuteCommandSchema = z.object({
  command: z.enum(ALL_COMMANDS),
  args: z.record(z.any()).default({}),
  // Raw transaction PIN for money-moving commands. It is NEVER trusted as a
  // client-asserted "already verified" boolean — it is forwarded to the main
  // Peeap API, which verifies it server-side against the user's transaction_pin.
  pin: z.string().min(4).max(12).optional(),
});

export function isFinancialCommand(command: string): boolean {
  return (FINANCIAL_COMMANDS as readonly string[]).includes(command);
}

// ============================================================
// E-commerce message schemas
// ============================================================

export const EcommerceMessageSchema = z.object({
  order_id: z.string().min(1),
  store_id: z.string().min(1),
  buyer_user_id: z.string().uuid(),
  seller_user_id: z.string().uuid(),
  category: z.enum([
    "order_created", "order_update", "invoice", "shipping_update",
    "delivery_confirmed", "product_card", "driver_assigned",
  ]),
  content: z.string().max(10000).optional(),
  rich_content: z.record(z.any()).optional(),
  tracking_number: z.string().optional(),
  // Optional: for driver-specific messages
  driver_user_id: z.string().uuid().optional(),
  idempotency_key: z.string().min(1).max(300).optional(),
});

export const TransactionalMessageSchema = z.object({
  idempotency_key: z.string().min(1).max(300),
  recipient_user_id: z.string().uuid(),
  channel: z.enum(["payments", "marketplace", "school", "invoices", "receipts"]),
  event_type: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  content: z.string().min(1).max(10000),
  message_type: z.enum([
    "text", "invoice", "receipt", "payment_request", "payment_confirmation",
    "fee_notice", "salary_slip", "announcement", "system",
  ]).default("system"),
  rich_content: z.record(z.any()).optional(),
  action_url: z.string().max(2000).optional(),
  source_service: z.string().min(1).max(100),
  source_id: z.string().min(1).max(300),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  send_push: z.boolean().default(true),
});

// ============================================================
// Key exchange schemas
// ============================================================

export const RegisterKeysSchema = z.object({
  device_id: z.string().min(1).max(200),
  identity_public_key: z.string().min(1),
  // Signed prekey + one-time prekeys are optional. The current ECIES message
  // model encrypts directly to the long-term identity key, so a client may
  // register with just its identity key. When a future X3DH/ratchet upgrade
  // needs them, clients supply them and the server stores them as before.
  signed_prekey_public: z.string().min(1).optional(),
  signed_prekey_signature: z.string().optional(),
  signed_prekey_id: z.number().int().min(0).optional(),
  one_time_prekeys: z.array(z.object({
    prekey_id: z.number().int().min(0),
    public_key: z.string().min(1),
  })).max(100).optional(),
});

export const ReplenishKeysSchema = z.object({
  device_id: z.string().min(1).max(200),
  one_time_prekeys: z.array(z.object({
    prekey_id: z.number().int().min(0),
    public_key: z.string().min(1),
  })).min(1).max(100),
});

export const KeyBackupSchema = z.object({
  encrypted_bundle: z.string().min(1),
  salt: z.string().min(1),
  nonce: z.string().min(1),
});

// ============================================================
// Media upload schemas
// ============================================================

export const MediaMetadataSchema = z.object({
  conversation_id: z.string().uuid(),
  file_name: z.string().min(1).max(500),
  file_type: z.string().min(1).max(50),
  file_size: z.number().int().min(1).max(50 * 1024 * 1024), // 50MB max
  mime_type: z.string().optional(),
  width: z.number().int().optional(),
  height: z.number().int().optional(),
  duration_seconds: z.number().optional(),
  is_encrypted: z.boolean().default(true),
});

// ============================================================
// System broadcast schemas
// ============================================================

export const CreateBroadcastSchema = z.object({
  title: z.string().min(1).max(500),
  content: z.string().min(1).max(10000),
  target_segment: z.enum(["all", "merchants", "schools", "parents", "students", "custom"]).default("all"),
  target_filter: z.record(z.any()).optional(),
  send_now: z.boolean().default(false),
});
