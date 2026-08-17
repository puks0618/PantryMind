# PantryMind — Two-Developer Work Plan

> **If you are Claude Code reading this for the first time: read this entire file before writing any code.**
> It is the coordination contract between two developers working in parallel on the same repository.
> Your human partner is one of two people. Find your track in §6 or §7 and stay inside it.
> Full architectural background lives in [`IMPLEMENTATION_PLAN_Hackathon.md`](./IMPLEMENTATION_PLAN_Hackathon.md).

---

## 1. Orientation

**PantryMind** is an agentic pantry assistant that reduces household food waste. It tracks what food a user has, suggests recipes that prioritise near-expiry items, and generates shopping lists.

**The thing being judged is the memory layer, not the grocery features.** The agent must remember across sessions what the user cooked, liked, rejected, and wasted, then visibly change its suggestions because of it. Grocery CRUD is the vehicle; agentic memory is the payload. Every design decision resolves in favour of making memory persistence, retrieval, and influence-on-output more visible.

**The demo moment:** a user states a preference in one session, returns in a completely new session, and the agent recalls that preference without being reminded and changes its recommendation because of it — with a UI panel showing which memory was retrieved and at what similarity score.

### Team

| | |
| --- | --- |
| **Pukhraj** | Track A — memory layer, database, Bedrock agent |
| **Prajwal** | Track B — Lambda functions, SAM deployment, Next.js frontend |

Prajwal owns the AWS account. Pukhraj works in it via an IAM user. The CockroachDB cluster is shared and already exists.

### Deadlines (all MST)

| Event | Time |
| --- | --- |
| Plan written | 2026-08-17 00:20 |
| Submit on Devpost | **2026-08-18 12:00** |
| Hard deadline | 2026-08-18 14:00 |

### Current repo state

`main` @ `b6c9d59` — public, MIT licensed. Contains the directory scaffold (21 directories, 12 `.gitkeep` files), `LICENSE`, `.gitignore`, `.env.example`, and the implementation plan. **Zero application code.**

### Hackathon requirements being satisfied

- **CockroachDB (need 2, we claim 3):** Managed MCP Server · Distributed Vector Indexing · `ccloud` CLI
- **AWS (need 1, we claim 3):** Bedrock Agents · Lambda · S3
- Public repo with detectable MIT license ✅ *(already done)*
- Publicly reachable demo URL
- Public video under 3 minutes showing the memory layer working

---

## 2. Locked decisions — do not deviate

These were decided deliberately. If your instinct is to improve one, don't — the other developer's code assumes it.

| Decision | Rationale |
| --- | --- |
| **The memory loop lives in the Next.js API route**, not inside the Bedrock agent | `apps/web/app/api/chat/route.ts` runs recall → `InvokeAgent` → write on *every* turn. Making it deterministic means the model cannot "decide" not to remember. It also makes returning similarity scores to the UI trivial. |
| **AWS SAM** for Lambda deployment | `template.yaml` at repo root. Not CDK, not Serverless Framework, not manual zips. |
| **npm workspaces monorepo** | One shared type definition imported by both tracks. Prevents schema drift between two people working in parallel. |
| **Titan Text Embeddings V2, 1024 dimensions** | `amazon.titan-embed-text-v2:0`. Must match `VECTOR(1024)` in the schema exactly. A mismatch surfaces as a runtime insert failure hours later. |
| **Single hardcoded demo user** | No authentication. `DEMO_USER_HANDLE=demo`. Auth is not judged and costs hours. |
| **Embed the summary, not the raw text** | Raw conversational text is noisy and retrieves poorly. Every memory row stores a one-sentence summary. |
| **Node 22 Lambda runtime** (`nodejs22.x`) | Local Node is 24; pin the runtime explicitly in `template.yaml`. |

### Rules for both agents

1. **Do not add features not described in this document or the implementation plan.** Scope creep is the primary failure mode.
2. **Do not refactor working code for elegance.** Ship-quality is the bar.
3. **Never commit secrets.** All credentials go in `.env` (gitignored). `.env.example` holds placeholders only.
4. **If a step fails twice with the same error, stop and surface the blocker** rather than attempting a third workaround.
5. **Stay in your lane.** See §3. Editing a file the other developer owns will cause a merge conflict at the worst possible moment.

---

## 3. File ownership — who edits what

Both developers work directly on `main`. **Always `git pull --rebase` before you push.** Conflicts are avoided by ownership discipline, not by branching.

### Pukhraj owns (Track A)

```
package.json                        ← root workspaces config
packages/shared/src/                ← types.ts, db.ts, embed.ts
packages/memory/src/                ← recall.ts, write.ts, classify.ts, index.ts
apps/web/app/api/chat/route.ts      ← the memory loop (lives in web, owned by A)
agent/config/                       ← system-prompt.md, action-groups.json
agent/mcp/                          ← cockroach-mcp.json
scripts/                            ← schema.sql, seed.sql, provision.sh, backfill-embeddings.ts
docs/demo-script.md
.env.example
```

### Prajwal owns (Track B)

```
template.yaml                       ← SAM, repo root
samconfig.toml
lambda/pantry/                      ← index.ts, package.json
lambda/recipes/
lambda/shopping-list/
apps/web/package.json               ← Next.js deps
apps/web/next.config.js
apps/web/tsconfig.json
apps/web/app/page.tsx
apps/web/app/layout.tsx
apps/web/app/globals.css
apps/web/components/                ← ChatPane.tsx, PantryList.tsx, MemoryInspector.tsx
```

### Written jointly, then frozen

`packages/shared/src/types.ts` and `scripts/schema.sql`. Pukhraj writes both in the first 30 minutes. **After that, changes require both developers to agree** — this pair is the interface contract between the tracks.

### Written at the end, jointly

`README.md` — Phase 5, both present.

---

## 4. The interface contract

Reproduced inline so neither agent has to guess. **This is the source of truth.**

### 4.1 Database schema (`scripts/schema.sql`)

```sql
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

CREATE INDEX idx_memory_vec ON memory_vectors USING cspann (embedding vector_cosine_ops);
```

> If `cspann` is unavailable on the cluster version, fall back to exact search (`ORDER BY embedding <=> $1` with no index) and **note the fallback in the README**.

### 4.2 Shared types (`packages/shared/src/types.ts`)

Both tracks import these. Do not redefine them locally.

```ts
export type ItemStatus = 'active' | 'consumed' | 'wasted';
export type MemoryKind = 'preference' | 'feedback' | 'action' | 'chatter';

export interface PantryItem {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  added_at: string;
  expires_at: string | null;   // YYYY-MM-DD
  status: ItemStatus;
}

export interface Recipe {
  id: string;
  external_id: string | null;
  title: string;
  ingredients: { name: string; amount?: string }[];
  instructions: string | null;
  source_url: string | null;
}

export interface Interaction {
  id: string;
  user_id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  summary: string | null;
  kind: MemoryKind | null;
  created_at: string;
}

/** A memory retrieved by similarity search, as returned to the UI. */
export interface RecalledMemory {
  content: string;
  created_at: string;
  distance: number;    // cosine distance from `<=>`: 0 = identical
  similarity: number;  // 1 - distance, for display
}

/** The response shape of POST /api/chat — Track B's ChatPane consumes this. */
export interface ChatResponse {
  answer: string;
  memories: RecalledMemory[];
  sessionId: string;
}
```

### 4.3 Environment variables

Already committed in [`.env.example`](./.env.example). Copy to `.env` and fill in. Key ones:

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=            # Pukhraj: IAM user from Prajwal
AWS_SECRET_ACCESS_KEY=
BEDROCK_AGENT_ID=             # from Bedrock console, Phase 2
BEDROCK_AGENT_ALIAS_ID=
BEDROCK_EMBED_MODEL_ID=amazon.titan-embed-text-v2:0
DATABASE_URL=                 # shared CockroachDB cluster
COCKROACH_MCP_URL=https://cockroachlabs.cloud/mcp
COCKROACH_MCP_API_KEY=
S3_BUCKET=
SPOONACULAR_API_KEY=
DEMO_USER_HANDLE=demo
```

---

## 5. T+0 handover — do this before anything else

**The two developers are mutually blocked right now.** This exchange unblocks both. Nothing else starts until it completes.

### Prajwal — first 10 minutes (blocks Pukhraj entirely)

- [ ] **1. Request Bedrock model access.** AWS Console → Bedrock → Model access → request **Claude** and **Titan Text Embeddings V2**. Approval is not instant and gates every memory feature in the project. **This is the single most urgent action in the entire hackathon.** Do it before reading the rest of this file.
- [ ] **2. Create an IAM user for Pukhraj** with programmatic access. Attach: `AmazonBedrockFullAccess`, `AWSLambda_FullAccess`, `AmazonS3FullAccess`, `CloudWatchLogsFullAccess`. Send him the access key ID and secret **over a private channel, never in the repo**.
- [ ] **3. Send Pukhraj the `DATABASE_URL`** for the shared CockroachDB cluster, and confirm which cluster name it is so `ccloud` can address it.
- [ ] **4. Create the S3 bucket** for demo assets. Any name; put it in `S3_BUCKET`.

### Pukhraj — first 30 minutes (blocks Prajwal's Lambda work)

Requires no AWS access, so do it while waiting on the items above.

- [ ] **1. Root `package.json`** with npm workspaces covering `packages/*`, `apps/*`, `lambda/*`.
- [ ] **2. `packages/shared/src/types.ts`** — exactly §4.2.
- [ ] **3. `packages/shared/src/db.ts`** — `pg` Pool. Small pool (`max: 2`), short idle timeout, `ssl: { rejectUnauthorized: true }`. Serverless-safe: reuse the pool across warm invocations.
- [ ] **4. `scripts/schema.sql`** — exactly §4.1.
- [ ] **5. Commit and push.** Tell Prajwal to pull.

**Gate:** neither track proceeds past its step 2 until both lists above are done.

---

## 6. Track A — Pukhraj (memory layer)

Acceptance criterion in *italics* under each step. Do not move on until it passes.

### Setup

**A1. Install tooling.** Homebrew is not installed on this machine, and neither are `aws`, `sam`, `ccloud`, or `psql`. Install Homebrew first, then `brew install awscli libpq cockroachdb/tap/ccloud`. Then `aws configure` with the IAM credentials from Prajwal.
*→ `aws sts get-caller-identity` returns Prajwal's account ID.*

**A2. `ccloud` CLI + `scripts/provision.sh`.** Run `ccloud auth login`, `ccloud cluster list`, `ccloud cluster sql <name>`. Capture every command in `scripts/provision.sh`. **The cluster already exists — say so in a comment in the script.** Do not write commands that imply you provisioned it. This script is the submission evidence for the `ccloud` CLI requirement and it must be accurate.
*→ `ccloud cluster sql` opens a working SQL shell.*

### Database

**A3. Apply the schema.** `psql "$DATABASE_URL" -f scripts/schema.sql`.
*→ All five tables exist.*

**A4. Write and apply `scripts/seed.sql`.** Must contain:
- One demo user with handle `demo`
- 12–15 pantry items, **with expiry dates written as `now() + INTERVAL 'N days'`, never hardcoded** — several within 3 days so the expiry demo works whenever it runs
- **At least 8 prior interactions from a previous session** (use a different `session_id` and backdate `created_at`), including 2–3 clear durable preferences. Suggested: a disliked ingredient (e.g. cilantro), a dietary constraint, a recurring waste pattern.

*→ `SELECT count(*) FROM pantry_items` returns 12–15; `SELECT count(*) FROM interactions` returns ≥8.*

**A5. ⚠️ Backfill embeddings for the seeded memories — `scripts/backfill-embeddings.ts`.**

**Do not skip this step.** `seed.sql` writes rows into `interactions`, but recall queries `memory_vectors` — a table SQL alone cannot populate, because every row needs a 1024-float embedding from Titan. If you skip this, the cross-session demo returns zero memories and the failure will look like a broken vector index. You will lose hours debugging the wrong thing.

Write a script that reads each seeded non-chatter interaction, generates a one-sentence summary, embeds it via Titan, and inserts into `memory_vectors`.

*→ `SELECT count(*) FROM memory_vectors` returns ≥6, and every row has a non-null embedding.*

**A6. Verify vector search by hand.**
```sql
SELECT content, embedding <=> $1 AS distance
FROM memory_vectors WHERE user_id = $2 ORDER BY distance LIMIT 5;
```
*→ Returns rows in sensible semantic order. If `cspann` failed, exact search still works — note it for the README.*

### The memory loop

**A7. `packages/shared/src/embed.ts`.** Wrap Bedrock `InvokeModel` with `amazon.titan-embed-text-v2:0`. Input string → `number[]` of length 1024. **On failure, log and return `null` — never throw.** A failed embedding must not break the chat turn. *(Blocked on Bedrock access from §5.)*
*→ Returns a 1024-length array for a test string.*

**A8. `packages/memory/src/recall.ts`.** Embed the incoming message, query top-5 for that user, return `RecalledMemory[]`.

**Note:** `<=>` returns cosine **distance** (0 = identical, higher = less similar). The UI displays **similarity**. Populate both fields — `similarity: 1 - distance` — or the inspector will show scores backwards.
*→ Given a cilantro-related query, the seeded cilantro preference comes back ranked first.*

**A9. `packages/memory/src/classify.ts`.** Given a user message and the assistant's answer, return `{ kind, summary }`. Use one cheap Bedrock call returning strict JSON. On any failure, default to `kind: 'chatter'` so a bad classification degrades quietly.
*→ "I hate mushrooms" classifies as `preference`; "what's for dinner" classifies as `chatter`.*

**A10. `packages/memory/src/write.ts`.** Insert the exchange into `interactions`. If `kind !== 'chatter'`, embed the summary and insert into `memory_vectors`. **Runs after the response is sent — it must never add latency to what the user is waiting on.**
*→ A preference turn creates one `interactions` row and one `memory_vectors` row; a chatter turn creates only the former.*

**A11. `packages/memory/src/index.ts` — export `handleTurn()`.** One function: embed → recall → `InvokeAgent` → write → return `ChatResponse`. This keeps `route.ts` thin, which is what stops the two tracks fighting over that file.
*→ Callable from a Node script and returns a well-formed `ChatResponse`.*

**A12. `apps/web/app/api/chat/route.ts`.** A thin POST handler that calls `handleTurn()`. Ten lines, no logic.
*→ `curl -X POST localhost:3000/api/chat -d '{"message":"hi"}'` returns `{ answer, memories, sessionId }`.*

### Agent

**A13. `agent/config/system-prompt.md`.** Must instruct the agent explicitly to:
- Consult provided memory context **before** answering anything about preferences, past meals, or recommendations
- Prioritise pantry items by expiry urgency when suggesting recipes
- **Cite which remembered facts influenced a recommendation, in plain language** (e.g. "I left out cilantro since I remember you don't like it")

This behaviour must be prompted, not hoped for. An agent that has memory available but doesn't mention using it will not demo well.

**A14. Create the Bedrock Agent** in Prajwal's account. Register action groups pointing at his deployed Lambdas, with OpenAPI schemas in `agent/config/action-groups.json`. Put the agent ID and alias ID in `.env`. *(Needs Prajwal's Lambdas from B7.)*
*→ Agent responds to a plain message and successfully invokes at least one Lambda.*

**A15. CockroachDB MCP server — `agent/mcp/cockroach-mcp.json`.** Endpoint `https://cockroachlabs.cloud/mcp`; generate config from the Cloud Console. **Test it from Claude Code first** — confirm you can list tables and run a read query before wiring it to the agent. Commit the config with secrets externalised.
*→ A read query through MCP returns rows.*

**A16. `docs/demo-script.md`** — the exact 3-minute narrative, turn by turn. Write this early; it tells both of you what actually needs to work.

---

## 7. Track B — Prajwal (application)

Do §5 first. Then:

**B1. Install tooling.** `aws` and `sam` CLIs. `aws configure` with your own credentials.
*→ `sam --version` works; `aws sts get-caller-identity` returns your account.*

**B2. Pull Pukhraj's shared package.** `git pull --rebase`. Import types from `packages/shared` — **do not redefine `PantryItem` or any other contract type locally.**
*→ `packages/shared/src/types.ts` exists locally and imports resolve.*

**B3. `template.yaml` + hello-world Lambda.** Set up SAM and deploy one trivial function end to end **before writing any real handler**. IAM and permissions misconfiguration is the classic overnight time sink and must be discovered now, not at hour 30.
*→ `aws lambda invoke --function-name <name> out.json` succeeds.*

**B4. `lambda/pantry/index.ts`.** Handlers: `addItem(name, quantity, unit, expires_at)`, `listItems(user_id)`, `markConsumed(item_id)`, `markWasted(item_id)`, `getExpiringItems(user_id, within_days)` sorted by urgency. Use `packages/shared/src/db.ts` for the connection.

Expiry scoring is date arithmetic. **Resist building a rules engine.**
*→ `getExpiringItems` returns correctly ordered results against the seeded data.*

**B5. `lambda/recipes/index.ts`.** Accept an ingredient list, call Spoonacular, rank matches by how many near-expiry items they consume. **Cache every response into the `recipes` table** so repeat lookups during the demo are instant and immune to rate limits.

Also accept an `exclude: string[]` parameter — the agent passes disliked ingredients from recalled memory into it. **This parameter is how memory visibly changes output; it is the most important line in this function.**

No Spoonacular key yet. If one never materialises, seed ~10 recipes into the `recipes` table and serve entirely from cache — the demo does not care.
*→ A lookup returns matches and writes rows to `recipes`.*

**B6. `lambda/shopping-list/index.ts`.** Given selected recipes, diff required ingredients against current pantry contents, return the gap.
*→ Returns only missing ingredients for a known recipe + pantry state.*

**B7. Deploy all three Lambdas.** Tell Pukhraj the function ARNs — he needs them for A14.
*→ All three invocable via `aws lambda invoke`. **This unblocks Track A.***

### Frontend

**B8. Scaffold Next.js in `apps/web` and deploy a placeholder to Vercel.** Get a public URL live tonight — a working public URL is a hard submission requirement and Vercel setup surprises are better found now.
*→ Placeholder page loads at a public URL.*

**B9. `apps/web/components/ChatPane.tsx`.** Message list + input. POST to `/api/chat`, consume `ChatResponse` from §4.2. Plain request/response is fine; skip streaming unless it's free.
*→ Sending a message renders the reply.*

**B10. `apps/web/components/PantryList.tsx`.** Current items with near-expiry ones visually distinct.
*→ Items within 3 days render highlighted.*

**B11. `apps/web/components/MemoryInspector.tsx` — the highest-leverage build in the project.**

For each assistant turn, display the memories that were retrieved and their similarity scores. Render `similarity` (already computed as `1 - distance`), formatted like:

> *recalled: "user dislikes cilantro" — 0.89 similarity, 6 days ago*

Memory is invisible by nature. On camera, this panel next to a recipe suggestion that omits cilantro is what converts an abstract claim into observable evidence. It costs roughly 90 minutes and it is what the judges are looking at. **Do not cut it. If time gets short, cut styling everywhere else first.**
*→ Retrieved memories appear with scores and relative timestamps next to each answer.*

**B12. Production deploy.** Set all `.env` variables in Vercel's project settings. Redeploy.
*→ The public URL works end to end in an incognito window.*

---

## 8. Sync points and hard gates

| # | Checkpoint | Deadline (MST) |
| --- | --- | --- |
| S1 | §5 handover complete — creds, `DATABASE_URL`, Bedrock requested, shared types pushed | 08-17 as early as possible |
| S2 | Lambdas deployed (B7) → Pukhraj registers action groups (A14) | — |
| S3 | **First end-to-end chat turn: browser → route → agent → Lambda → answer** | — |
| S4 | **Cross-session recall works** — fresh session, agent uses a seeded preference | **08-17 18:00** |
| S5 | Full demo script runs clean twice from a fresh session | 08-18 00:00 |
| S6 | **Feature freeze — bug fixes only.** Anything broken is cut from the demo, not debugged | **08-18 02:00** |
| S7 | **Video recorded, under 3:00, uploaded public, verified in incognito** | **08-18 06:00** |
| S8 | README written, checklist verified, **submitted on Devpost** | **08-18 12:00** |

**S4 is the real deadline.** If cross-session recall is not working by 18:00 on the 17th, stop building features and drop down the fallback ladder in §9 immediately. Everything after S4 is packaging.

**Record the video the night of the 17th, not the morning of the 18th.** Every team that plans to record in the morning runs out of time.

### Video narrative (under 3 minutes)

```
0:00–0:20  the problem, one sentence
0:20–1:10  add items, get expiry-aware suggestions, state a preference
1:10–2:10  ★ fresh session — agent recalls the preference and adapts.
           Show the memory inspector. This is the centrepiece. Give it the most time.
2:10–2:45  architecture; name the CockroachDB tools and AWS services out loud
```

### README must include (explicit judging requirement)

- Which **CockroachDB tools** were used and **what the agent actually did with each** — MCP Server, Distributed Vector Indexing, `ccloud` CLI, named individually with concrete roles
- Which **AWS services** were used and how — Bedrock Agents, Lambda, S3
- Setup instructions runnable from a clean machine
- Demo URL and video link
- Architecture diagram at `docs/architecture.png`

---

## 9. Fallback ladder

If something breaks and time is short, degrade in this order. Each step preserves the judged behaviour.

| If this breaks | Fall back to |
| --- | --- |
| `cspann` vector index unavailable | Exact vector search, no index. Note it in the README. |
| Vector search entirely | Keyword/recency retrieval over `interactions`. Keeps cross-session recall, loses semantic matching. |
| Bedrock model access not granted in time | Direct Anthropic API for reasoning. Keep Lambda + S3 for the AWS requirement. |
| Bedrock Agents too slow to configure | Hand-rolled tool loop inside `handleTurn()`. More code, fully under your control. |
| Spoonacular unavailable | Serve entirely from the seeded `recipes` cache table. |
| Frontend incomplete | Minimal single-page chat UI. A working public URL is required; a polished one is not. |
| Running out of time generally | Cut shopping-list, cut pantry CRUD polish, cut styling. **Never cut the memory loop.** |

**What is never cut:** writing memory on every turn, recalling it across sessions, and showing that recall in the UI. If only one thing works at the deadline, it is that loop.

---

## 10. Git workflow

```bash
git pull --rebase        # ALWAYS before you push
git add -A
git commit -m "..."
git push
```

Both developers on `main`. No feature branches — merge overhead is not affordable. Conflicts are prevented by the ownership table in §3, so if you find yourself editing a file in the other person's list, stop and message them instead.

Commit frequently. A commit every 30–45 minutes means a bad hour costs an hour, not the project.
