-- ============================================================
-- Peeap Chat Service - Complete Database Schema
-- Target: https://vksavlswhatwqglsbnfi.supabase.co
-- Run this entire file in Supabase SQL Editor
-- ============================================================


-- ============================================================
-- 1. TABLES
-- ============================================================

-- 1a. chat_users (synced from auth.peeap.com + anonymous/platform users)
CREATE TABLE chat_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id UUID UNIQUE,
  platform_id UUID,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  email TEXT,
  phone TEXT,
  account_type TEXT DEFAULT 'personal',
  roles TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended', 'deleted')),
  last_seen_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1b. platforms (third-party platform registrations)
CREATE TABLE platforms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  name TEXT NOT NULL,
  domain TEXT,
  api_key TEXT NOT NULL UNIQUE,
  api_secret_hash TEXT NOT NULL,
  allowed_origins TEXT[] DEFAULT '{}',
  webhook_url TEXT,
  target_user_id UUID,
  config JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1c. conversations (all types unified)
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL CHECK (type IN ('direct', 'group', 'support', 'school_direct', 'school_class', 'business_channel', 'widget', 'b2b')),
  name TEXT,
  metadata JSONB DEFAULT '{}',
  created_by UUID NOT NULL,
  source TEXT DEFAULT 'peeap',
  platform_id UUID REFERENCES platforms(id),
  school_id TEXT,
  school_name TEXT,
  business_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  last_message_content TEXT,
  last_message_sender_id UUID,
  last_message_at TIMESTAMPTZ,
  last_message_type TEXT,
  member_count INT DEFAULT 0,
  is_announcement_only BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1d. conversation_members (role-based membership)
CREATE TABLE conversation_members (
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member', 'observer')),
  permissions JSONB DEFAULT '{}',
  unread_count INT DEFAULT 0,
  is_muted BOOLEAN DEFAULT false,
  notification_preference TEXT DEFAULT 'all' CHECK (notification_preference IN ('all', 'mentions', 'none')),
  pinned BOOLEAN DEFAULT false,
  joined_at TIMESTAMPTZ DEFAULT now(),
  last_read_at TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);

-- 1e. messages (18+ types)
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  content TEXT,
  message_type TEXT DEFAULT 'text' CHECK (message_type IN (
    'text', 'image', 'file', 'audio', 'video',
    'invoice', 'receipt', 'payment_request', 'payment_confirmation',
    'fee_notice', 'salary_slip', 'announcement', 'system',
    'location', 'contact', 'sticker', 'poll', 'link_preview'
  )),
  rich_content JSONB,
  attachments JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  reply_to UUID REFERENCES messages(id),
  status TEXT DEFAULT 'sent' CHECK (status IN ('sending', 'sent', 'delivered', 'read', 'failed')),
  ai_flagged BOOLEAN DEFAULT false,
  is_edited BOOLEAN DEFAULT false,
  edited_at TIMESTAMPTZ,
  is_deleted BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1f. message_read_receipts
CREATE TABLE message_read_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  read_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id)
);

-- 1g. message_reactions
CREATE TABLE message_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(message_id, user_id, emoji)
);

-- 1h. payment_requests (in-chat payments)
CREATE TABLE payment_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL,
  recipient_id UUID,
  type TEXT NOT NULL CHECK (type IN ('send_money', 'request_money', 'pay_invoice', 'split_bill')),
  amount DECIMAL(15, 2) NOT NULL,
  currency TEXT DEFAULT 'SLE',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'declined', 'expired', 'cancelled')),
  invoice_data JSONB,
  external_transaction_id TEXT,
  notes TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1i. media_files
CREATE TABLE media_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  uploader_id UUID NOT NULL,
  file_name TEXT NOT NULL,
  file_type TEXT NOT NULL,
  file_size BIGINT NOT NULL,
  mime_type TEXT,
  storage_path TEXT NOT NULL,
  thumbnail_path TEXT,
  width INT,
  height INT,
  duration_seconds DECIMAL(10, 2),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1j. contacts (user contact list with block/favorite)
CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  contact_user_id UUID NOT NULL,
  nickname TEXT,
  is_blocked BOOLEAN DEFAULT false,
  is_favorite BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, contact_user_id)
);

-- 1k. business_channels (WeChat Official Accounts style)
CREATE TABLE business_channels (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL,
  conversation_id UUID UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
  handle TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  avatar_url TEXT,
  category TEXT,
  features TEXT[] DEFAULT '{}',
  welcome_message TEXT,
  menu JSONB DEFAULT '[]',
  follower_count INT DEFAULT 0,
  is_verified BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 1l. channel_followers
CREATE TABLE channel_followers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id UUID NOT NULL REFERENCES business_channels(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  followed_at TIMESTAMPTZ DEFAULT now(),
  is_muted BOOLEAN DEFAULT false,
  UNIQUE(channel_id, user_id)
);

-- 1m. notification_deliveries
CREATE TABLE notification_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  source_service TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  delivered_at TIMESTAMPTZ DEFAULT now()
);

-- 1n. typing_indicators (ephemeral)
CREATE TABLE typing_indicators (
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  started_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (conversation_id, user_id)
);

-- 1o. ai_flag_keywords (moderation)
CREATE TABLE ai_flag_keywords (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword TEXT NOT NULL,
  category TEXT DEFAULT 'general',
  severity TEXT DEFAULT 'low' CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 1p. webhook_events (outbound webhook log)
CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'retrying')),
  attempts INT DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  response_status INT,
  response_body TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ============================================================
-- 2. INDEXES
-- ============================================================

-- chat_users
CREATE INDEX idx_chat_users_auth_user_id ON chat_users(auth_user_id);
CREATE INDEX idx_chat_users_platform_id ON chat_users(platform_id);
CREATE INDEX idx_chat_users_email ON chat_users(email);
CREATE INDEX idx_chat_users_phone ON chat_users(phone);
CREATE INDEX idx_chat_users_display_name ON chat_users USING gin(to_tsvector('english', display_name));

-- platforms
CREATE INDEX idx_platforms_api_key ON platforms(api_key);
CREATE INDEX idx_platforms_owner ON platforms(owner_user_id);

-- conversations
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
CREATE INDEX idx_conversations_type ON conversations(type);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_platform ON conversations(platform_id);
CREATE INDEX idx_conversations_school ON conversations(school_id);
CREATE INDEX idx_conversations_business ON conversations(business_id);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC NULLS LAST);

-- conversation_members
CREATE INDEX idx_members_user ON conversation_members(user_id);
CREATE INDEX idx_members_conversation_role ON conversation_members(conversation_id, role);
CREATE INDEX idx_members_unread ON conversation_members(user_id) WHERE unread_count > 0;
CREATE INDEX idx_members_pinned ON conversation_members(user_id) WHERE pinned = true;

-- messages
CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at DESC);
CREATE INDEX idx_messages_sender ON messages(sender_id);
CREATE INDEX idx_messages_not_deleted ON messages(conversation_id, created_at DESC) WHERE is_deleted = false;
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_type ON messages(conversation_id, message_type);
CREATE INDEX idx_messages_reply ON messages(reply_to) WHERE reply_to IS NOT NULL;
CREATE INDEX idx_messages_ai_flagged ON messages(conversation_id) WHERE ai_flagged = true;
CREATE INDEX idx_messages_edited ON messages(conversation_id) WHERE is_edited = true;

-- message_read_receipts
CREATE INDEX idx_read_receipts_message ON message_read_receipts(message_id);
CREATE INDEX idx_read_receipts_user ON message_read_receipts(user_id);

-- message_reactions
CREATE INDEX idx_reactions_message ON message_reactions(message_id);

-- payment_requests
CREATE INDEX idx_payment_requests_conversation ON payment_requests(conversation_id);
CREATE INDEX idx_payment_requests_sender ON payment_requests(sender_id);
CREATE INDEX idx_payment_requests_status ON payment_requests(status);
CREATE INDEX idx_payment_requests_recipient ON payment_requests(recipient_id);
CREATE INDEX idx_payment_requests_external ON payment_requests(external_transaction_id) WHERE external_transaction_id IS NOT NULL;

-- media_files
CREATE INDEX idx_media_files_message ON media_files(message_id);
CREATE INDEX idx_media_files_uploader ON media_files(uploader_id);

-- contacts
CREATE INDEX idx_contacts_user ON contacts(user_id);
CREATE INDEX idx_contacts_blocked ON contacts(user_id) WHERE is_blocked = true;

-- business_channels
CREATE INDEX idx_business_channels_owner ON business_channels(owner_user_id);
CREATE INDEX idx_business_channels_handle ON business_channels(handle);

-- channel_followers
CREATE INDEX idx_channel_followers_channel ON channel_followers(channel_id);
CREATE INDEX idx_channel_followers_user ON channel_followers(user_id);

-- notification_deliveries
CREATE INDEX idx_notification_deliveries_conversation ON notification_deliveries(conversation_id);
CREATE INDEX idx_notification_deliveries_event ON notification_deliveries(event_type);

-- ai_flag_keywords
CREATE INDEX idx_ai_keywords_active ON ai_flag_keywords(keyword) WHERE is_active = true;

-- webhook_events
CREATE INDEX idx_webhook_events_platform ON webhook_events(platform_id);
CREATE INDEX idx_webhook_events_status ON webhook_events(status) WHERE status != 'sent';


-- ============================================================
-- 3. FUNCTIONS & TRIGGERS
-- ============================================================

-- 3a. Auto-update updated_at on any row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER conversations_updated_at
  BEFORE UPDATE ON conversations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER messages_updated_at
  BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER chat_users_updated_at
  BEFORE UPDATE ON chat_users FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER platforms_updated_at
  BEFORE UPDATE ON platforms FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER payment_requests_updated_at
  BEFORE UPDATE ON payment_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER business_channels_updated_at
  BEFORE UPDATE ON business_channels FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3b. Denormalize last message info onto conversations
CREATE OR REPLACE FUNCTION update_conversation_last_message()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversations SET
    last_message_content = CASE
      WHEN NEW.message_type = 'text' THEN LEFT(NEW.content, 200)
      ELSE '[' || NEW.message_type || ']'
    END,
    last_message_sender_id = NEW.sender_id,
    last_message_at = NEW.created_at,
    last_message_type = NEW.message_type,
    updated_at = now()
  WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_last_message
  AFTER INSERT ON messages FOR EACH ROW
  WHEN (NEW.is_deleted = false)
  EXECUTE FUNCTION update_conversation_last_message();

-- 3c. Keep member_count in sync
CREATE OR REPLACE FUNCTION update_member_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE conversations SET member_count = member_count + 1 WHERE id = NEW.conversation_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE conversations SET member_count = member_count - 1 WHERE id = OLD.conversation_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_member_count
  AFTER INSERT OR DELETE ON conversation_members FOR EACH ROW
  EXECUTE FUNCTION update_member_count();

-- 3d. Increment unread_count for all members except sender
CREATE OR REPLACE FUNCTION increment_unread_count()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE conversation_members
  SET unread_count = unread_count + 1
  WHERE conversation_id = NEW.conversation_id
    AND user_id != NEW.sender_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_unread
  AFTER INSERT ON messages FOR EACH ROW
  WHEN (NEW.is_deleted = false)
  EXECUTE FUNCTION increment_unread_count();

-- 3e. Keep follower_count in sync on business_channels
CREATE OR REPLACE FUNCTION update_follower_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE business_channels SET follower_count = follower_count + 1 WHERE id = NEW.channel_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE business_channels SET follower_count = follower_count - 1 WHERE id = OLD.channel_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_follower_count
  AFTER INSERT OR DELETE ON channel_followers FOR EACH ROW
  EXECUTE FUNCTION update_follower_count();

-- 3f. Get or create direct conversation between two users
CREATE OR REPLACE FUNCTION get_or_create_direct_conversation(
  user_a UUID,
  user_b UUID
) RETURNS UUID AS $$
DECLARE
  conv_id UUID;
BEGIN
  SELECT cm1.conversation_id INTO conv_id
  FROM conversation_members cm1
  JOIN conversation_members cm2 ON cm1.conversation_id = cm2.conversation_id
  JOIN conversations c ON c.id = cm1.conversation_id
  WHERE cm1.user_id = user_a
    AND cm2.user_id = user_b
    AND c.type = 'direct'
    AND c.status = 'active'
  LIMIT 1;

  IF conv_id IS NOT NULL THEN
    RETURN conv_id;
  END IF;

  INSERT INTO conversations (type, created_by, status, member_count)
  VALUES ('direct', user_a, 'active', 2)
  RETURNING id INTO conv_id;

  INSERT INTO conversation_members (conversation_id, user_id, role)
  VALUES
    (conv_id, user_a, 'member'),
    (conv_id, user_b, 'member');

  RETURN conv_id;
END;
$$ LANGUAGE plpgsql;


-- ============================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE chat_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE platforms ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversation_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE media_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_followers ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE typing_indicators ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_flag_keywords ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;

-- Service role full access (all 16 tables)
CREATE POLICY "Service role full access" ON chat_users FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON platforms FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON conversations FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON conversation_members FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON messages FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON message_read_receipts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON message_reactions FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON payment_requests FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON media_files FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON contacts FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON business_channels FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON channel_followers FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON notification_deliveries FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON typing_indicators FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON ai_flag_keywords FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "Service role full access" ON webhook_events FOR ALL USING (auth.role() = 'service_role');

-- User-facing RLS policies
CREATE POLICY "Members can read conversations" ON conversations
  FOR SELECT USING (id IN (SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()));

CREATE POLICY "Members can read messages" ON messages
  FOR SELECT USING (conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid()));

CREATE POLICY "Users can read own profile" ON chat_users
  FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "Users can read own contacts" ON contacts
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY "Members can read receipts" ON message_read_receipts
  FOR SELECT USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Members can read reactions" ON message_reactions
  FOR SELECT USING (
    message_id IN (
      SELECT m.id FROM messages m
      JOIN conversation_members cm ON cm.conversation_id = m.conversation_id
      WHERE cm.user_id = auth.uid()
    )
  );

CREATE POLICY "Anyone can read active channels" ON business_channels
  FOR SELECT USING (is_active = true);

CREATE POLICY "Members can see typing" ON typing_indicators
  FOR SELECT USING (
    conversation_id IN (SELECT conversation_id FROM conversation_members WHERE user_id = auth.uid())
  );


-- ============================================================
-- 5. REALTIME
-- ============================================================

ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE typing_indicators;
ALTER PUBLICATION supabase_realtime ADD TABLE conversation_members;
