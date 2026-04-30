-- ============================================================
-- 004: Friend Requests
-- WeChat-style friend system. friend_requests tracks pending/
-- accepted/rejected requests. The existing contacts table
-- stores accepted friendships (bidirectional rows).
-- ============================================================

-- Friend request table
CREATE TABLE IF NOT EXISTS friend_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID NOT NULL,
  receiver_id UUID NOT NULL,
  message TEXT DEFAULT '',              -- "Hi! Met you at the market"
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected', 'cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  UNIQUE(sender_id, receiver_id)
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_friend_requests_receiver_pending
  ON friend_requests (receiver_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_friend_requests_sender
  ON friend_requests (sender_id);

-- Index on contacts for fast friend lookups
CREATE INDEX IF NOT EXISTS idx_contacts_user_id ON contacts (user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_user_id ON contacts (contact_user_id);

-- RPC: Accept a friend request — inserts bidirectional contacts rows + updates request status.
-- Runs in a single transaction to prevent partial state.
CREATE OR REPLACE FUNCTION accept_friend_request(request_id UUID, current_user_id UUID)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  req RECORD;
BEGIN
  -- Lock the request row
  SELECT * INTO req FROM friend_requests WHERE id = request_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Friend request not found';
  END IF;

  IF req.receiver_id != current_user_id THEN
    RAISE EXCEPTION 'Not authorized to accept this request';
  END IF;

  IF req.status != 'pending' THEN
    RAISE EXCEPTION 'Request is no longer pending (status: %)', req.status;
  END IF;

  -- Update request status
  UPDATE friend_requests
  SET status = 'accepted', responded_at = now()
  WHERE id = request_id;

  -- Insert bidirectional contact rows (skip if already exists)
  INSERT INTO contacts (user_id, contact_user_id)
  VALUES (req.sender_id, req.receiver_id)
  ON CONFLICT (user_id, contact_user_id) DO NOTHING;

  INSERT INTO contacts (user_id, contact_user_id)
  VALUES (req.receiver_id, req.sender_id)
  ON CONFLICT (user_id, contact_user_id) DO NOTHING;
END;
$$;
