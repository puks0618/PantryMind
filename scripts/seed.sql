-- PantryMind demo seed data.
-- Idempotent: safe to re-run before every recording take (see docs/demo-script.md
-- recording checklist). Deletes and recreates everything scoped to the fixed demo
-- user id below.
--
-- Deliberately does NOT seed eggs, spinach, or a cilantro preference — those are
-- added live during the recorded demo (0:20-1:10 in docs/demo-script.md) to
-- demonstrate the write path. This file demonstrates the read path: facts from
-- a session that predates the recording entirely.
--
-- memory_vectors is intentionally left empty here. Populating it requires a real
-- embedding per row, which is scripts/backfill-embeddings.ts (#13) — run that
-- immediately after this script, every time.

DELETE FROM memory_vectors WHERE user_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM interactions   WHERE user_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM pantry_items   WHERE user_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM users          WHERE id      = '00000000-0000-0000-0000-000000000001';

INSERT INTO users (id, handle) VALUES
  ('00000000-0000-0000-0000-000000000001', 'demo');

-- ---- Pantry: 15 items, expiry relative to now() so the "expiring soon" demo
-- ---- beat works whenever this is run. milk/tomatoes/chicken are within 3 days.
INSERT INTO pantry_items (user_id, name, category, quantity, unit, expires_at, status) VALUES
  ('00000000-0000-0000-0000-000000000001', 'milk',               'dairy',   1,   'gallon',      now() + INTERVAL '2 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'chicken thighs',     'meat',    1.5, 'lb',          now() + INTERVAL '3 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'tomatoes',           'produce', 4,   'count',       now() + INTERVAL '2 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'bell peppers',       'produce', 3,   'count',       now() + INTERVAL '5 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'greek yogurt',       'dairy',   1,   'tub',         now() + INTERVAL '6 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'bananas',            'produce', 5,   'count',       now() + INTERVAL '4 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'carrots',            'produce', 1,   'bag',         now() + INTERVAL '14 days',  'active'),
  ('00000000-0000-0000-0000-000000000001', 'onions',             'produce', 3,   'count',       now() + INTERVAL '21 days',  'active'),
  ('00000000-0000-0000-0000-000000000001', 'garlic',             'produce', 1,   'bulb',        now() + INTERVAL '30 days',  'active'),
  ('00000000-0000-0000-0000-000000000001', 'canned black beans', 'pantry',  2,   'can',         now() + INTERVAL '365 days', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'bread',              'bakery',  1,   'loaf',        now() + INTERVAL '5 days',   'active'),
  ('00000000-0000-0000-0000-000000000001', 'butter',             'dairy',   1,   'stick pack',  now() + INTERVAL '45 days',  'active'),
  ('00000000-0000-0000-0000-000000000001', 'rice',               'pantry',  2,   'lb',          now() + INTERVAL '180 days', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'pasta',              'pantry',  1,   'box',         now() + INTERVAL '200 days', 'active'),
  ('00000000-0000-0000-0000-000000000001', 'cheddar cheese',     'dairy',   1,   'block',       now() + INTERVAL '21 days',  'active');

-- ---- Prior session (backdated 6-9 days, session_id the live demo never
-- ---- touches). 12 rows, 3 durable facts: a waste pattern (mentioned twice,
-- ---- reinforcing it as real), a spice-tolerance dislike, a dietary constraint.
INSERT INTO interactions (user_id, session_id, role, content, summary, kind, created_at) VALUES
  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'I bought a rotisserie chicken and some rice today.',
   'User added rotisserie chicken and rice to pantry.', 'action',
   now() - INTERVAL '9 days'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'Added chicken and rice to your pantry!', NULL, 'chatter',
   now() - INTERVAL '9 days' + INTERVAL '1 minute'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'Ugh, the kale I bought last week went bad again before I could use it. I keep doing this.',
   'User has let leafy greens (kale) spoil before using them.', 'feedback',
   now() - INTERVAL '9 days' + INTERVAL '5 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'Noted — I will flag leafy greens earlier next time so they do not go to waste.', NULL, 'chatter',
   now() - INTERVAL '9 days' + INTERVAL '6 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'Can you suggest something for dinner tonight?', NULL, 'chatter',
   now() - INTERVAL '9 days' + INTERVAL '20 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'How about a rice bowl with the chicken you have on hand?', NULL, 'chatter',
   now() - INTERVAL '9 days' + INTERVAL '21 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'That curry you suggested last time was way too spicy for me honestly.',
   'User finds very spicy dishes unpleasant; prefers mild-to-medium heat.', 'feedback',
   now() - INTERVAL '7 days'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'Sorry about that — I will keep future suggestions milder.', NULL, 'chatter',
   now() - INTERVAL '7 days' + INTERVAL '1 minute'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'Also I do not eat red meat, so please stick to chicken, fish, or vegetarian options.',
   'User avoids red meat; prefers chicken, fish, or vegetarian options.', 'preference',
   now() - INTERVAL '7 days' + INTERVAL '2 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'Got it — no red meat. I will keep that in mind for every recommendation.', NULL, 'chatter',
   now() - INTERVAL '7 days' + INTERVAL '3 minutes'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user',
   'That spinach I bought earlier also went bad before I could use it.',
   'User has let leafy greens (spinach) spoil before using them — second occurrence.', 'feedback',
   now() - INTERVAL '6 days'),

  ('00000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'assistant',
   'That is the second time with leafy greens — I will flag them earlier from now on.', NULL, 'chatter',
   now() - INTERVAL '6 days' + INTERVAL '1 minute');
