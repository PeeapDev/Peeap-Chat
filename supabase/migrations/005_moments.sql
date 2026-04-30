-- ============================================================
-- 005: Moments / Status Feed
-- WeChat Moments-style social feed. Friends post text, photos,
-- and products. Others can like and comment. Product data is
-- embedded as JSONB snapshot (no cross-DB joins).
-- ============================================================

-- Status posts
CREATE TABLE IF NOT EXISTS status_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  post_type TEXT NOT NULL DEFAULT 'text' CHECK (post_type IN ('text', 'image', 'product')),
  media_urls TEXT[] DEFAULT '{}',        -- R2 CDN URLs for images
  product_data JSONB,                     -- embedded product snapshot { id, name, price, image_url, store_id, store_name, store_url }
  visibility TEXT NOT NULL DEFAULT 'friends' CHECK (visibility IN ('friends', 'public')),
  like_count INT NOT NULL DEFAULT 0,
  comment_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ                  -- optional 24h story mode
);

-- Comments on posts
CREATE TABLE IF NOT EXISTS status_comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id UUID NOT NULL REFERENCES status_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Likes on posts (one per user per post)
CREATE TABLE IF NOT EXISTS status_likes (
  post_id UUID NOT NULL REFERENCES status_posts(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);

-- ── Indexes ──

-- Feed query: my friends' posts, newest first
CREATE INDEX IF NOT EXISTS idx_status_posts_user_created
  ON status_posts (user_id, created_at DESC);

-- Feed query: visibility filter
CREATE INDEX IF NOT EXISTS idx_status_posts_visibility_created
  ON status_posts (visibility, created_at DESC);

-- Comments by post
CREATE INDEX IF NOT EXISTS idx_status_comments_post
  ON status_comments (post_id, created_at ASC);

-- Likes by post
CREATE INDEX IF NOT EXISTS idx_status_likes_post
  ON status_likes (post_id);

-- Check if user liked a post
CREATE INDEX IF NOT EXISTS idx_status_likes_user
  ON status_likes (user_id, post_id);

-- ── Auto-update counters via triggers ──

-- Like counter
CREATE OR REPLACE FUNCTION update_post_like_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE status_posts SET like_count = like_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE status_posts SET like_count = GREATEST(like_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_status_likes_count ON status_likes;
CREATE TRIGGER trg_status_likes_count
  AFTER INSERT OR DELETE ON status_likes
  FOR EACH ROW EXECUTE FUNCTION update_post_like_count();

-- Comment counter
CREATE OR REPLACE FUNCTION update_post_comment_count()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE status_posts SET comment_count = comment_count + 1 WHERE id = NEW.post_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE status_posts SET comment_count = GREATEST(comment_count - 1, 0) WHERE id = OLD.post_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_status_comments_count ON status_comments;
CREATE TRIGGER trg_status_comments_count
  AFTER INSERT OR DELETE ON status_comments
  FOR EACH ROW EXECUTE FUNCTION update_post_comment_count();
