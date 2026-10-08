-- Prevent concurrent shipping/receipt retries from inserting duplicate messages.
-- Existing duplicate keys must be reviewed before this index can be applied.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.messages
    WHERE metadata->>'idempotency_key' IS NOT NULL
    GROUP BY metadata->>'idempotency_key' HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate_message_idempotency_keys_review_required';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS messages_idempotency_key_unique
  ON public.messages ((metadata->>'idempotency_key'))
  WHERE metadata->>'idempotency_key' IS NOT NULL;
