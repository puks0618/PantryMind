CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  handle        STRING NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE pantry_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  name          STRING NOT NULL,
  category      STRING,
  quantity      DECIMAL,
  unit          STRING,
  added_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    DATE,
  status        STRING NOT NULL DEFAULT 'active',  -- active | consumed | wasted
  INDEX idx_pantry_user_expiry (user_id, expires_at)
);

CREATE TABLE recipes (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   STRING,
  title         STRING NOT NULL,
  ingredients   JSONB NOT NULL,
  instructions  STRING,
  source_url    STRING,
  cached_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE interactions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id),
  session_id    UUID NOT NULL,
  role          STRING NOT NULL,          -- user | assistant
  content       STRING NOT NULL,
  summary       STRING,
  kind          STRING,                   -- preference | feedback | action | chatter
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX idx_interactions_user_time (user_id, created_at DESC)
);

CREATE TABLE memory_vectors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  interaction_id UUID REFERENCES interactions(id),
  content        STRING NOT NULL,
  embedding      VECTOR(1024) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- If cspann is unavailable on the deployed cluster version, drop this index and
-- fall back to exact search: ORDER BY embedding <=> $1 with no index.
-- Note the fallback in the README if used.
CREATE INDEX idx_memory_vec ON memory_vectors USING cspann (embedding vector_cosine_ops);

-- Recall is always scoped to one user (packages/memory/src/recall.ts), and a
-- vector index can only serve a filtered ANN search if the filter column is a
-- prefix of the index. Without this, EXPLAIN on the real recall query falls back
-- to a FULL SCAN and idx_memory_vec above is never used.
CREATE INDEX idx_memory_vec_user ON memory_vectors
  USING cspann (user_id, embedding vector_cosine_ops);
