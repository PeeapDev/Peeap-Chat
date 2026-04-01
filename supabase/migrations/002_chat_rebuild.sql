-- ============================================================
-- Peeap Chat Service - Schema Rebuild Migration
-- Target: https://vksavlswhatwqglsbnfi.supabase.co
-- Adds: E2EE, slash commands, e-commerce messaging, system broadcasts
-- Run this in Supabase SQL Editor (additive - no breaking changes)
-- ============================================================


-- ============================================================
-- 1. MODIFY EXISTING TABLES
-- ============================================================

-- 1a. Extend messages table with new message types + E2EE columns
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_message_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_message_type_check CHECK (message_type IN (
  'text', 'image', 'file', 'audio', 'video',
  'invoice', 'receipt', 'payment_request', 'payment_confirmation',
  'fee_notice', 'salary_slip', 'announcement', 'system',
  'location', 'contact', 'sticker', 'poll', 'link_preview',
  -- New types:
  'product_card', 'order_update', 'shipping_update',
  'slash_command_result', 'payment_link', 'voice_note'
));

-- E2EE columns on messages
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encrypted_content TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS encryption_metadata JSONB;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_encrypted BOOLEAN DEFAULT false;

-- Index for encrypted messages
CREATE INDEX IF NOT EXISTS idx_messages_encrypted
  ON messages(conversation_id, is_encrypted) WHERE is_encrypted = true;


-- ============================================================
-- 2. E2EE KEY MANAGEMENT TABLES
-- ============================================================

-- 2a. User identity keys (public keys per device)
CREATE TABLE IF NOT EXISTS user_identity_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  identity_public_key TEXT NOT NULL,       -- X25519 public key (base64)
  signed_prekey_public TEXT NOT NULL,      -- Signed pre-key public (base64)
  signed_prekey_signature TEXT NOT NULL,   -- Signature from identity key (base64)
  signed_prekey_id INT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_keys_user
  ON user_identity_keys(user_id) WHERE is_active = true;

-- 2b. One-time pre-keys (consumed during X3DH key exchange)
CREATE TABLE IF NOT EXISTS one_time_prekeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  prekey_id INT NOT NULL,
  public_key TEXT NOT NULL,                -- X25519 public key (base64)
  is_consumed BOOLEAN DEFAULT false,
  consumed_by TEXT,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, device_id, prekey_id)
);

CREATE INDEX IF NOT EXISTS idx_otp_keys_available
  ON one_time_prekeys(user_id, device_id) WHERE is_consumed = false;

-- 2c. Encrypted key backups (PIN-based recovery)
CREATE TABLE IF NOT EXISTS encrypted_key_backups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL UNIQUE,
  encrypted_bundle TEXT NOT NULL,          -- AES-256-GCM(PBKDF2(pin), all_private_keys)
  salt TEXT NOT NULL,                      -- PBKDF2 salt (base64)
  nonce TEXT NOT NULL,                     -- AES-GCM nonce (base64)
  key_version INT DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2d. E2EE chat sessions (track established sessions between device pairs)
CREATE TABLE IF NOT EXISTS chat_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  initiator_user_id TEXT NOT NULL,
  responder_user_id TEXT NOT NULL,
  initiator_device_id TEXT NOT NULL,
  responder_device_id TEXT NOT NULL,
  session_version INT DEFAULT 1,
  established_at TIMESTAMPTZ DEFAULT now(),
  last_message_at TIMESTAMPTZ,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
  UNIQUE(initiator_user_id, responder_user_id, initiator_device_id, responder_device_id)
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_users
  ON chat_sessions(initiator_user_id, responder_user_id) WHERE status = 'active';


-- ============================================================
-- 3. SLASH COMMAND TRACKING
-- ============================================================

CREATE TABLE IF NOT EXISTS slash_command_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  user_id TEXT NOT NULL,
  command TEXT NOT NULL CHECK (command IN ('invoice', 'send', 'request', 'product', 'transaction', 'create')),
  args JSONB DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'executing', 'completed', 'failed', 'cancelled')),
  result JSONB,
  requires_pin BOOLEAN DEFAULT false,
  pin_verified_at TIMESTAMPTZ,
  external_transaction_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_slash_commands_conversation
  ON slash_command_executions(conversation_id);
CREATE INDEX IF NOT EXISTS idx_slash_commands_user
  ON slash_command_executions(user_id);
CREATE INDEX IF NOT EXISTS idx_slash_commands_status
  ON slash_command_executions(status) WHERE status IN ('pending', 'executing');


-- ============================================================
-- 4. E-COMMERCE MESSAGING
-- ============================================================

CREATE TABLE IF NOT EXISTS ecommerce_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  order_id TEXT NOT NULL,
  store_id TEXT NOT NULL,
  buyer_user_id TEXT NOT NULL,
  seller_user_id TEXT NOT NULL,
  message_category TEXT NOT NULL CHECK (message_category IN (
    'order_created', 'invoice', 'shipping_update', 'delivery_confirmed', 'product_card'
  )),
  tracking_number TEXT,
  order_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ecommerce_order
  ON ecommerce_messages(order_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_buyer
  ON ecommerce_messages(buyer_user_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_seller
  ON ecommerce_messages(seller_user_id);
CREATE INDEX IF NOT EXISTS idx_ecommerce_tracking
  ON ecommerce_messages(tracking_number) WHERE tracking_number IS NOT NULL;


-- ============================================================
-- 5. SYSTEM BROADCASTS
-- ============================================================

CREATE TABLE IF NOT EXISTS system_broadcasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  target_segment TEXT DEFAULT 'all' CHECK (target_segment IN (
    'all', 'merchants', 'schools', 'parents', 'students', 'custom'
  )),
  target_filter JSONB,
  delivery_count INT DEFAULT 0,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'sending', 'sent', 'cancelled')),
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_broadcasts_status
  ON system_broadcasts(status) WHERE status IN ('draft', 'sending');
CREATE INDEX IF NOT EXISTS idx_broadcasts_admin
  ON system_broadcasts(admin_user_id);


-- ============================================================
-- 6. ENABLE REALTIME ON NEW TABLES
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE slash_command_executions;
ALTER PUBLICATION supabase_realtime ADD TABLE ecommerce_messages;


-- ============================================================
-- 7. RLS POLICIES FOR NEW TABLES
-- ============================================================

-- Enable RLS on all new tables
ALTER TABLE user_identity_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE one_time_prekeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_key_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE slash_command_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecommerce_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_broadcasts ENABLE ROW LEVEL SECURITY;

-- Service role has full access (all API calls go through service role)
CREATE POLICY "Service role full access" ON user_identity_keys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON one_time_prekeys FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON encrypted_key_backups FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON chat_sessions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON slash_command_executions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON ecommerce_messages FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access" ON system_broadcasts FOR ALL USING (true) WITH CHECK (true);


-- ============================================================
-- 8. HELPER FUNCTIONS
-- ============================================================

-- Atomically consume one one-time pre-key for a user
CREATE OR REPLACE FUNCTION consume_one_time_prekey(
  p_user_id TEXT,
  p_consumed_by TEXT
) RETURNS TABLE(prekey_id INT, public_key TEXT) AS $$
DECLARE
  v_row one_time_prekeys%ROWTYPE;
BEGIN
  -- Select and lock one available pre-key
  SELECT * INTO v_row
  FROM one_time_prekeys
  WHERE one_time_prekeys.user_id = p_user_id
    AND is_consumed = false
  ORDER BY created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_row.id IS NULL THEN
    RETURN;
  END IF;

  -- Mark as consumed
  UPDATE one_time_prekeys
  SET is_consumed = true,
      consumed_by = p_consumed_by,
      consumed_at = now()
  WHERE id = v_row.id;

  prekey_id := v_row.prekey_id;
  public_key := v_row.public_key;
  RETURN NEXT;
END;
$$ LANGUAGE plpgsql;

-- Count available one-time pre-keys for a user (for replenishment checks)
CREATE OR REPLACE FUNCTION count_available_prekeys(p_user_id TEXT)
RETURNS INT AS $$
  SELECT COUNT(*)::INT
  FROM one_time_prekeys
  WHERE user_id = p_user_id AND is_consumed = false;
$$ LANGUAGE sql STABLE;

-- Get or create direct conversation between two users (for e-commerce auto-creation)
-- Extends existing get_or_create_direct_conversation if it exists
CREATE OR REPLACE FUNCTION get_or_create_ecommerce_conversation(
  p_buyer_id UUID,
  p_seller_id UUID
) RETURNS UUID AS $$
DECLARE
  v_conv_id UUID;
BEGIN
  -- Check for existing direct conversation
  SELECT c.id INTO v_conv_id
  FROM conversations c
  JOIN conversation_members cm1 ON cm1.conversation_id = c.id AND cm1.user_id = p_buyer_id
  JOIN conversation_members cm2 ON cm2.conversation_id = c.id AND cm2.user_id = p_seller_id
  WHERE c.type = 'direct' AND c.status = 'active'
  LIMIT 1;

  IF v_conv_id IS NOT NULL THEN
    RETURN v_conv_id;
  END IF;

  -- Create new conversation
  INSERT INTO conversations (type, created_by, source, status)
  VALUES ('direct', p_seller_id, 'ecommerce', 'active')
  RETURNING id INTO v_conv_id;

  -- Add both members
  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES
    (v_conv_id, p_buyer_id, 'member'),
    (v_conv_id, p_seller_id, 'member');

  RETURN v_conv_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 9. AUTO-UPDATE TRIGGERS FOR NEW TABLES
-- ============================================================

-- Reuse the existing update_updated_at function if it exists, or create it
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_identity_keys_updated_at
  BEFORE UPDATE ON user_identity_keys
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER update_encrypted_key_backups_updated_at
  BEFORE UPDATE ON encrypted_key_backups
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
