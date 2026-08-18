# PantryMind — Implementation Plan

> ⚠️ **Superseded as a record of what shipped — see [README.md](README.md).**
> This is the original architecture doc. Its claimed AWS/CockroachDB tool list
> is aspirational, not what was delivered. README.md is the accurate account.

> **Audience:** This document is written for an AI coding agent (Claude Code / Copilot Agent in VS Code) executing this project inside the repository. Read this file in full before writing any code. Execute phases in order. Do not skip acceptance criteria.

---

## 0. Core objective

Build **PantryMind**, an agentic pantry assistant that reduces household grocery waste.

The agent tracks what food a user has, suggests recipes that prioritise near-expiry items, generates shopping lists — and critically, **remembers across sessions** what the user cooked, liked, rejected, and wasted, then uses that memory to make better suggestions over time.

**The thing being judged is the memory layer, not the grocery features.** Every design decision resolves in favour of making memory persistence, retrieval, and influence-on-output more visible and more robust. Grocery CRUD is the vehicle; agentic memory is the payload.

### Success definition

A user can:
1. Add pantry items via natural language chat.
2. Ask what to cook and receive suggestions weighted by expiry urgency.
3. Give feedback ("that was too spicy", "I never finish cilantro").
4. **Return in a completely new session** and have the agent recall that feedback without being reminded, and visibly change its recommendation because of it.

Step 4 is the demo moment. Everything else exists to enable it.

---

## 1. Hard constraints

| Constraint | Value |
| --- | --- |
| Deadline | Aug 18, 2026 @ 2:00pm MST |
| Team | 2 developers |
| Required: CockroachDB tools | Minimum 2 of: Managed MCP Server, Distributed Vector Indexing, ccloud CLI, Agent Skills Repo |
| Required: AWS services | Minimum 1 of: Bedrock, Lambda, ECS/EKS, S3, SageMaker, Bedrock Agents |
| Required: repo | Public, open source, MIT or Apache 2.0 license detectable in the About section |
| Required: demo | Publicly reachable functional URL |
| Required: video | Under 3 minutes, public on YouTube or Vimeo, must show the memory layer working |

**Our chosen coverage:** CockroachDB Managed MCP Server + Distributed Vector Indexing + ccloud CLI (three, exceeding the minimum of two). AWS Bedrock Agents + Lambda + S3.

### Agent execution rules

1. **Do not add features not described in this document.** Scope creep is the primary failure mode under a 46-hour deadline.
2. **Do not refactor working code for elegance.** Ship-quality is the bar, not production-quality.
3. **After each phase, stop and report status against the acceptance criteria** before proceeding.
4. **Never commit secrets.** All credentials go in `.env`, which is gitignored. Maintain `.env.example` with placeholder keys.
5. **Prefer boring, well-documented libraries** over clever ones. No experimental dependencies.
6. If a step fails twice with the same error, **stop and surface the blocker** rather than attempting a third workaround.

---

## 2. Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Next.js chat client (Vercel)                           │
│  - chat pane                                            │
│  - pantry list                                          │
│  - memory inspector panel                               │
└───────────────────────┬─────────────────────────────────┘
                        │ HTTPS
┌───────────────────────▼─────────────────────────────────┐
│  Amazon Bedrock Agent (orchestrator)                    │
│  - Claude model for reasoning                           │
│  - decides: recall memory? call a tool? answer?         │
└───────┬───────────────────────────────┬─────────────────┘
        │ action group invoke           │ MCP tool call
┌───────▼──────────────┐   ┌────────────▼─────────────────┐
│  AWS Lambda          │   │  CockroachDB Managed MCP     │
│  - pantry CRUD       │   │  - structured memory reads   │
│  - expiry scoring    │   │  - vector similarity search  │
│  - recipe matching   │   └────────────┬─────────────────┘
│  - shopping list     │                │
└───────┬──────────────┘                │
        │ pg driver                     │
┌───────▼────────────────────────────────▼────────────────┐
│  CockroachDB Cloud (AWS)                                │
│  pantry_items · recipes · interactions · memory_vectors │
│  + distributed vector index on memory_vectors.embedding │
└─────────────────────────────────────────────────────────┘
        ▲
        │  Titan Embeddings (Bedrock) — every turn embedded and stored
        │
┌───────┴──────────────┐        ┌──────────────────────────┐
│  Amazon S3           │        │  External APIs           │
│  receipts, assets    │        │  Spoonacular / OFF       │
└──────────────────────┘        └──────────────────────────┘
```

### Why this shape

- **Bedrock Agents is the orchestrator, not a custom server.** Writing our own agent loop costs 6+ hours we do not have. Action groups and MCP tools are configured declaratively.
- **Two paths out of the agent.** Deterministic business logic goes to Lambda; memory reads go straight to CockroachDB via MCP. This keeps the memory path short and demonstrable.
- **Every turn is embedded and persisted.** Memory is written on the way out, not batched. This is what makes cross-session recall work.

---

## 3. Repository structure

```
pantrymind/
├── README.md                 # submission-facing; written in Phase 5
├── LICENSE                   # MIT, added Phase 0
├── IMPLEMENTATION_PLAN.md    # this file
├── .env.example
├── .gitignore
├── scripts/
│   ├── provision.sh          # ccloud CLI cluster provisioning
│   ├── schema.sql            # DDL, single source of truth
│   └── seed.sql              # demo data including prior interactions
├── agent/
│   ├── config/
│   │   ├── agent-config.json     # Bedrock agent definition
│   │   ├── system-prompt.md      # agent instructions
│   │   └── action-groups.json    # OpenAPI schemas for Lambda tools
│   ├── memory/
│   │   ├── embed.ts              # Titan embedding calls
│   │   ├── write.ts              # persist interaction + vector
│   │   └── recall.ts             # similarity query + context assembly
│   └── mcp/
│       └── cockroach-mcp.json    # MCP server config
├── lambda/
│   ├── shared/
│   │   ├── db.ts                 # pg connection pool
│   │   └── types.ts
│   ├── pantry/index.ts           # CRUD + expiry scoring
│   ├── recipes/index.ts          # recipe matching
│   └── shopping-list/index.ts    # list generation
└── web/
    ├── app/
    │   ├── page.tsx              # chat interface
    │   └── api/chat/route.ts     # proxy to Bedrock agent
    └── components/
        ├── ChatPane.tsx
        ├── PantryList.tsx
        └── MemoryInspector.tsx   # shows retrieved memories per turn
```

---

## 4. Data model

This schema is the **interface contract** between the two developers. Once applied in Phase 1, changes require explicit agreement.

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
  summary       STRING,                   -- condensed form used for embedding
  kind          STRING,                   -- preference | feedback | action | chatter
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  INDEX idx_interactions_user_time (user_id, created_at DESC)
);

CREATE TABLE memory_vectors (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES users(id),
  interaction_id UUID REFERENCES interactions(id),
  content        STRING NOT NULL,
  embedding      VECTOR(1024) NOT NULL,   -- must match Titan output dimension
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_memory_vec ON memory_vectors USING cspann (embedding vector_cosine_ops);
```

**Verify the vector dimension against the actual Titan Embeddings model output before applying.** A mismatch here surfaces as a runtime insert failure much later and is expensive to debug under time pressure. Confirm the current vector index syntax against CockroachDB documentation for the deployed cluster version — if `cspann` is unavailable, fall back to exact search with `ORDER BY embedding <=> $1` and note the fallback in the README.

---

## 5. Phase 0 — Alignment and accounts

**Duration:** ~2 hours · **Owner:** Both · **Blocking: nothing proceeds until complete**

### Steps

1. **Request Bedrock model access first.** In the AWS console, request access to a Claude model and to Titan Text Embeddings. Approval is not instantaneous and gates all of Phase 2.
2. Create the public GitHub repo. Add `LICENSE` (MIT) as the first commit so it registers in the About section. Add both developers as collaborators.
3. Create a CockroachDB Cloud account and install the `ccloud` CLI locally.
4. Review and agree the schema in section 4. Commit `scripts/schema.sql`.
5. Write `docs/demo-script.md`: the exact 3-minute narrative for the video, turn by turn. Build only what appears in it.
6. Commit `.gitignore` and `.env.example`.

### Acceptance criteria

- [ ] Bedrock access requested (status pending or granted)
- [ ] Public repo exists, MIT license visible in About
- [ ] `scripts/schema.sql` committed and agreed by both developers
- [ ] `docs/demo-script.md` committed

---

## 6. Phase 1 — Foundation

**Duration:** ~4 hours · **Runs in parallel across both developers**

### Track A — Memory infrastructure

1. Provision the cluster **via `ccloud` CLI**, not the web console. Capture every command in `scripts/provision.sh`. This script is the submission evidence for the ccloud CLI requirement.
   ```bash
   ccloud auth login
   ccloud cluster create pantrymind --plan basic --cloud aws --region us-east-1
   ccloud cluster sql pantrymind --output json
   ```
2. Apply `scripts/schema.sql` against the cluster.
3. Apply `scripts/seed.sql`. Seed must include:
   - A demo user
   - 12–15 pantry items with a realistic spread of expiry dates, several within 3 days
   - **At least 8 prior interactions from a previous session**, including 2–3 clear preferences (e.g. a disliked ingredient, a dietary constraint, a recurring waste pattern)
   
   The seeded history is not optional. Cross-session recall cannot be demonstrated against an empty memory store.
4. Create the vector index. Verify with a hand-written similarity query that returns rows before considering this step done.

### Track B — Application infrastructure

1. Scaffold the repo structure from section 3.
2. Set up Lambda deployment (SAM, Serverless Framework, or plain zip upload — whichever the developer already knows). Deploy one hello-world function end to end tonight; IAM misconfiguration is the classic overnight time sink and must be discovered now.
3. Create the S3 bucket for receipts and demo assets.
4. Scaffold the Next.js app and confirm it deploys to Vercel.

### Acceptance criteria

- [ ] `ccloud cluster sql` connects successfully
- [ ] All five tables exist; `SELECT count(*) FROM pantry_items` returns seeded rows
- [ ] A vector similarity query executes and returns ordered results
- [ ] A hello-world Lambda is invocable from the AWS CLI
- [ ] A placeholder Next.js page is live on a public Vercel URL

---

## 7. Phase 2 — Core loop

**Duration:** ~5 hours · **Runs in parallel**

### Track A — Agent and MCP

1. **Configure the CockroachDB Managed MCP Server.** Endpoint: `https://cockroachlabs.cloud/mcp`. Generate the config snippet from the Cloud Console. Test it from VS Code or Claude Code first — confirm you can list tables and run a read query through MCP before wiring it into the agent. Commit the config (with secrets externalised) to `agent/mcp/cockroach-mcp.json`.

2. **Create the Bedrock Agent.** Write `agent/config/system-prompt.md`. The system prompt must instruct the agent, in explicit terms, to:
   - Query memory **before** answering any question about preferences, past meals, or recommendations
   - Prioritise pantry items by expiry urgency when suggesting recipes
   - Record any stated preference or feedback as a durable memory
   - Cite which remembered facts influenced a recommendation, in plain language
   
   This behaviour must be deliberate and prompted, not incidental. An agent that happens to have memory available but does not consult it will not demo well.

3. Register action groups pointing at the Lambda functions, with OpenAPI schemas in `agent/config/action-groups.json`.

### Track B — Business logic

1. `lambda/shared/db.ts` — connection pool using a standard Postgres driver (`pg`). CockroachDB is wire-compatible; no special client is needed. Configure for serverless: small pool, short idle timeout.

2. `lambda/pantry/index.ts` — handlers for:
   - `addItem(name, quantity, unit, expires_at)`
   - `listItems(user_id)`
   - `markConsumed(item_id)` / `markWasted(item_id)`
   - `getExpiringItems(user_id, within_days)` — returns items sorted by urgency

   Expiry scoring is date arithmetic. Resist building a rules engine.

3. `lambda/recipes/index.ts` — accepts a list of ingredients, calls Spoonacular (or Open Food Facts), returns matches ranked by how many near-expiry items they consume. **Cache every response into the `recipes` table** so repeat lookups during the demo are instant and resilient to API rate limits.

4. `lambda/shopping-list/index.ts` — given selected recipes, diff required ingredients against current pantry contents, return the gap.

### Acceptance criteria

- [ ] MCP server reachable; a read query through it returns rows
- [ ] Bedrock agent responds to a plain chat message
- [ ] Agent successfully invokes at least one Lambda action group
- [ ] `getExpiringItems` returns correctly ordered results
- [ ] Recipe lookup returns matches and writes them to the cache table

---

## 8. Phase 3 — Memory intelligence

**Duration:** ~5 hours · **This phase is the project. Protect its time.**

### Track A — The memory loop

1. **`agent/memory/embed.ts`** — wrap the Bedrock Titan Embeddings call. Input: a string. Output: a float array. Handle failures by logging and returning null rather than throwing; a failed embedding must not break the chat turn.

2. **`agent/memory/write.ts`** — after every completed turn:
   - Insert the raw exchange into `interactions`
   - Classify it: is this a durable `preference`, transient `feedback`, an `action`, or `chatter`?
   - For anything not classified as `chatter`, generate a one-sentence `summary`, embed the summary, and insert into `memory_vectors`
   
   Embedding the summary rather than the raw text materially improves retrieval quality — raw conversational text is noisy and retrieves poorly.

3. **`agent/memory/recall.ts`** — before the agent answers:
   - Embed the incoming user message
   - Query `memory_vectors` for the top-k (start with k=5) most similar entries for that user
   - Assemble them into a compact context block injected into the agent's prompt
   
   ```sql
   SELECT content, created_at,
          embedding <=> $1 AS distance
   FROM memory_vectors
   WHERE user_id = $2
   ORDER BY distance
   LIMIT 5;
   ```
   
   Return the retrieved rows to the caller alongside the answer, so the UI can display them.

### Track B — Interface

1. **Chat frontend** (`web/app/page.tsx` + `ChatPane.tsx`). Message list, input box, streaming response if straightforward — otherwise plain request/response. Keep styling minimal; a working public URL is a submission requirement, visual polish is not.

2. **Pantry list** (`PantryList.tsx`) — current items with expiry highlighting. Near-expiry items visually distinct.

3. **Memory inspector** (`MemoryInspector.tsx`) — for each assistant turn, display which memories were retrieved and their similarity scores. 

   This component costs roughly 90 minutes and is the highest-leverage build in the project. Memory is invisible by nature; on camera, a panel showing *"recalled: user dislikes cilantro (0.89 similarity, 6 days ago)"* next to a recipe suggestion that omits cilantro converts an abstract claim into observable evidence.

### Acceptance criteria

- [ ] Every chat turn writes a row to `interactions`
- [ ] Non-chatter turns write a row to `memory_vectors` with a valid embedding
- [ ] A similarity query returns semantically relevant prior interactions
- [ ] **The agent answers a question using a fact from a prior session that was never mentioned in the current one**
- [ ] The memory inspector displays retrieved memories with scores
- [ ] Frontend is deployed and publicly reachable

---

## 9. Phase 4 — Integration and hardening

**Duration:** ~4 hours · **Joint · Hard checkpoint**

### Steps

1. **Integration checkpoint.** Run the full demo script end to end, both developers present. Every step must work in sequence, in a fresh browser session.

2. Fix what breaks. Common failure points to check first:
   - Lambda cold-start timeouts against the Bedrock agent's tool-call timeout
   - Connection pool exhaustion (serverless Lambda + Postgres pooling)
   - Embedding dimension mismatch on insert
   - CORS between Vercel and the agent proxy

3. **Record the demo video tonight.** Not tomorrow morning. Under 3 minutes. The narrative arc:
   - 0:00–0:20 — the problem, in one sentence
   - 0:20–1:10 — add items, get expiry-aware recipe suggestions, give a preference
   - 1:10–2:10 — **open a fresh session; agent recalls the preference and adapts.** Show the memory inspector. This is the centrepiece; give it the most time.
   - 2:10–2:45 — architecture, name the CockroachDB tools and AWS services used
   
   Upload to YouTube, set to public, verify the link works in an incognito window.

4. **Feature freeze.** After this point: bug fixes only. Anything still broken is cut from the demo script rather than debugged.

### Acceptance criteria

- [ ] Full demo script runs clean, twice in a row, from a fresh session
- [ ] Video recorded, under 3:00, publicly accessible
- [ ] No new feature work begins after this phase closes

---

## 10. Phase 5 — Submission

**Duration:** ~4 hours · **Joint · Submit by 12:00pm MST, two hours before deadline**

### Steps

1. **Write `README.md`.** Required sections:
   - What PantryMind is and the problem it solves
   - Architecture diagram
   - **Which CockroachDB tools were used and what the agent actually did with each** — this is an explicit judging requirement, not boilerplate. Name MCP Server, Distributed Vector Indexing, ccloud CLI, and describe the concrete role of each.
   - **Which AWS services were used and how** — Bedrock Agents, Lambda, S3.
   - Setup instructions: prerequisites, env vars, provisioning, schema, seed, deploy. A judge must be able to run this from a clean machine.
   - Demo URL and video link
2. Export the architecture diagram to `docs/architecture.png` and embed it in the README.
3. Verify `.env.example` covers every required variable and that no real secrets are committed.
4. **Pre-submission checklist:**
   - [ ] Repo is public
   - [ ] License file present and visible in the GitHub About section
   - [ ] README contains setup and run instructions
   - [ ] Demo URL loads in an incognito window
   - [ ] Video is public, under 3 minutes
   - [ ] CockroachDB tools named with specific usage described
   - [ ] AWS services named with specific usage described
5. Submit on Devpost. Optionally include feedback on the CockroachDB AI tooling — the rules invite it and it costs five minutes.

### Acceptance criteria

- [ ] Every checklist item above is verified
- [ ] Submission completed before 12:00pm MST

---

## 11. Fallback plan

If a component fails and time is short, degrade in this order — each step preserves the core judged behaviour:

| If this breaks | Fall back to |
| --- | --- |
| Distributed vector index unavailable | Exact vector search without the index; note it in the README |
| Vector search entirely | Keyword/recency memory retrieval over `interactions`; preserves cross-session recall, loses semantic matching |
| Bedrock model access not granted | Direct Anthropic API for reasoning; keep Lambda and S3 for the AWS requirement |
| Bedrock Agents orchestration too slow to configure | Hand-rolled tool loop in a single Lambda; more code but fully under your control |
| External recipe API rate-limited | Serve entirely from the seeded `recipes` cache table |
| Frontend incomplete | A minimal single-page chat UI; a working public URL is required, a polished one is not |

**What is never cut:** writing memory on every turn, recalling it across sessions, and showing that recall in the UI. If only one thing works at the deadline, it is that loop.
