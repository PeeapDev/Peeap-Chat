// ============================================================
// Peeap Chat - TypeScript Types
// ============================================================

export interface ChatUser {
  id: string;
  auth_user_id: string | null;
  display_name: string;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  account_type: string;
  status: string;
  last_seen_at: string | null;
}

export interface ConversationMember {
  user_id: string;
  role: "owner" | "admin" | "moderator" | "member" | "observer";
  unread_count: number;
  is_muted: boolean;
  pinned: boolean;
  joined_at: string;
  last_read_at: string | null;
  notification_preference: "all" | "mentions" | "none";
  profile?: ChatUser | null;
}

export type ConversationType =
  | "direct"
  | "group"
  | "support"
  | "school_direct"
  | "school_class"
  | "business_channel"
  | "widget"
  | "b2b";

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  metadata: Record<string, unknown>;
  created_by: string;
  status: "active" | "archived" | "closed";
  priority: "low" | "normal" | "high" | "urgent";
  last_message_content: string | null;
  last_message_sender_id: string | null;
  last_message_at: string | null;
  last_message_type: string | null;
  member_count: number;
  is_announcement_only: boolean;
  members: ConversationMember[];
  unread_count: number;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export type MessageType =
  | "text"
  | "image"
  | "file"
  | "audio"
  | "video"
  | "invoice"
  | "receipt"
  | "payment_request"
  | "payment_confirmation"
  | "fee_notice"
  | "salary_slip"
  | "announcement"
  | "system"
  | "location"
  | "contact"
  | "sticker"
  | "poll"
  | "link_preview"
  | "product_card"
  | "order_update"
  | "shipping_update"
  | "slash_command_result"
  | "payment_link"
  | "voice_note";

export interface MessageReaction {
  emoji: string;
  count: number;
  users: string[];
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string | null;
  message_type: MessageType;
  rich_content: Record<string, unknown> | null;
  attachments: unknown[];
  metadata: Record<string, unknown>;
  reply_to: string | null;
  status: "sending" | "sent" | "delivered" | "read" | "failed";
  is_edited: boolean;
  edited_at: string | null;
  is_deleted: boolean;
  is_encrypted: boolean;
  encrypted_content: string | null;
  encryption_metadata: EncryptionMetadata | null;
  created_at: string;
  sender?: ChatUser;
  reactions?: MessageReaction[];
  read_by_count?: number;
}

// E2EE types
export interface EncryptionMetadata {
  sender_ek_pub: string;
  sender_ik_id: string;
  session_version: number;
  recipient_keys?: Record<string, string>; // {user_id: base64(encrypted_symmetric_key)} for group chats
}

// Slash command types
export type SlashCommand = "invoice" | "send" | "request" | "product" | "transaction" | "create";

export interface SlashCommandExecution {
  id: string;
  conversation_id: string;
  message_id: string | null;
  user_id: string;
  command: SlashCommand;
  args: Record<string, unknown>;
  status: "pending" | "executing" | "completed" | "failed" | "cancelled";
  result: Record<string, unknown> | null;
  requires_pin: boolean;
  pin_verified_at: string | null;
  external_transaction_id: string | null;
  created_at: string;
  completed_at: string | null;
}

// E-commerce message types
export interface EcommerceMessage {
  id: string;
  conversation_id: string;
  message_id: string | null;
  order_id: string;
  store_id: string;
  buyer_user_id: string;
  seller_user_id: string;
  message_category: "order_created" | "invoice" | "shipping_update" | "delivery_confirmed" | "product_card";
  tracking_number: string | null;
  order_data: Record<string, unknown> | null;
  created_at: string;
}

// Key exchange types
export interface UserIdentityKey {
  id: string;
  user_id: string;
  device_id: string;
  identity_public_key: string;
  signed_prekey_public: string;
  signed_prekey_signature: string;
  signed_prekey_id: number;
  is_active: boolean;
  created_at: string;
}

export interface KeyBundle {
  identity_key: string;
  signed_prekey: string;
  signed_prekey_signature: string;
  signed_prekey_id: number;
  one_time_prekey?: string;
  one_time_prekey_id?: number;
}

export interface SystemBroadcast {
  id: string;
  admin_user_id: string;
  title: string;
  content: string;
  target_segment: "all" | "merchants" | "schools" | "parents" | "students" | "custom";
  target_filter: Record<string, unknown> | null;
  delivery_count: number;
  status: "draft" | "sending" | "sent" | "cancelled";
  sent_at: string | null;
  created_at: string;
}

export interface PaymentRequest {
  id: string;
  message_id: string;
  conversation_id: string;
  sender_id: string;
  recipient_id: string | null;
  type: "send_money" | "request_money" | "pay_invoice" | "split_bill";
  amount: number;
  currency: string;
  status: "pending" | "completed" | "declined" | "expired" | "cancelled";
  invoice_data: Record<string, unknown> | null;
  notes: string | null;
  expires_at: string | null;
  created_at: string;
}

export interface UnreadInfo {
  total_unread: number;
  conversations: Array<{
    conversation_id: string;
    unread_count: number;
    last_message: string | null;
    last_message_at: string | null;
  }>;
}
