-- QR Login Sessions for WhatsApp Web-style scan-to-login
-- Used by chat.peeap.com to authenticate users via mobile app QR scan

CREATE TABLE IF NOT EXISTS qr_login_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  secret TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'expired')),
  user_id UUID,
  session_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,
  confirmed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for polling (web client checks status)
CREATE INDEX IF NOT EXISTS idx_qr_sessions_status ON qr_login_sessions(id, secret, status);

-- Auto-cleanup expired sessions (older than 10 minutes)
CREATE OR REPLACE FUNCTION cleanup_expired_qr_sessions()
RETURNS void AS $$
BEGIN
  DELETE FROM qr_login_sessions
  WHERE expires_at < now() - INTERVAL '10 minutes';
END;
$$ LANGUAGE plpgsql;

-- RLS: Service role only (API handles all access)
ALTER TABLE qr_login_sessions ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on qr_login_sessions"
  ON qr_login_sessions
  FOR ALL
  USING (true)
  WITH CHECK (true);
