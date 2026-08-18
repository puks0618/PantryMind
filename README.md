# PantryMind

**A pantry assistant that remembers what you're actually like.**

You tell it about your groceries and your preferences. It stores the durable
facts — dietary constraints, dislikes, the things you buy and then throw away —
as vectors in CockroachDB. Weeks later, in a session that has never seen that
conversation, it recalls them unprompted and changes what it recommends. And it
says so, in plain language, with the similarity score visible in the UI.

Households throw away roughly **631 million tonnes of food a year** — about 60%
of all food waste, costing a US family of four around **$2,913 annually**. The
largest causes aren't spoilage; they're **date-label confusion and simply
forgetting**. An inventory list is a snapshot and starts over every week.
PantryMind is a memory layer instead.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
   Browser ────────▶│  Next.js 14 (App Router)                 │
                    │  ChatPane · PantryList · MemoryInspector │
                    └───────────────┬──────────────────────────┘
                                    │  route handlers
                  ┌─────────────────┴──────────────────┐
                  ▼                                    ▼
      ┌───────────────────────┐          ┌──────────────────────────┐
      │   Amazon Bedrock      │          │   CockroachDB Cloud      │
      │                       │          │   (v26.2.5, serverless)  │
      │  Titan Embeddings V2  │          │                          │
      │    → 1024-dim vector  │─────────▶│  users                   │
      │                       │  vector  │  pantry_items            │
      │  Claude Sonnet 4.5    │  search  │  recipes                 │
      │    → the reply        │◀─────────│  interactions            │
      │                       │          │  memory_vectors          │
      │  Claude Haiku 4.5     │          │    VECTOR(1024)          │
      │    → what to remember │          │    + cspann vector index │
      └───────────────────────┘          └──────────────────────────┘

   Deployed but NOT on the request path — see "AWS services" below:
      AWS Lambda ×7 (pantry / recipes / shopping-list + Bedrock adapters)
```

### The memory loop — three steps, every turn

1. **Recall.** Embed the incoming message with Titan, then nearest-neighbour
   search that user's memories by cosine distance, top 5.
   ([`recall.ts`](packages/memory/src/recall.ts))
2. **Respond.** Claude Sonnet answers with the question, the recalled memories,
   and live pantry contents (sorted soonest-expiry-first) all in context. It's
   instructed to name any memory that changed its answer.
   ([`responder.ts`](packages/memory/src/responder.ts))
3. **Remember.** Claude Haiku classifies the exchange — `preference`,
   `feedback`, `action`, or `chatter`. Only non-chatter is summarised, embedded
   and written to `memory_vectors`. Fire-and-forget, so it never delays the
   reply. ([`write.ts`](packages/memory/src/write.ts))

### Schema

| Table | Purpose |
|---|---|
| `users` | one row; no auth, single demo user |
| `pantry_items` | name, category, quantity, unit, `expires_at`, status (`active`/`consumed`/`wasted`) |
| `recipes` | title + `ingredients` JSONB carrying `{name, quantity, unit}` |
| `interactions` | full conversation log with a `kind` classification |
| `memory_vectors` | `embedding VECTOR(1024)` + cspann vector index — the memory layer |

Full DDL in [`scripts/schema.sql`](scripts/schema.sql).

---

## CockroachDB tools we used

### 1. Distributed Vector Indexing — live, on the request path

Every durable memory is a 1024-dimension vector living in the **same database
and schema as the pantry data**. No separate vector store, no second system to
keep in sync.

```
Table     memory_vectors
Column    embedding VECTOR(1024)          -- matches Titan Text Embeddings V2
Index     VECTOR INDEX idx_memory_vec_user (user_id, embedding vector_cosine_ops)
Distance  cosine, via <=>
```

**What the agent does with it:** on every chat turn, before answering, it embeds
the user's message and runs a nearest-neighbour search over that user's
memories, taking the top 5 by cosine distance. Those go into the model's
context, and each one's similarity score is surfaced in the UI.

**One detail we'd rather volunteer than have found.** Our first index was on
`embedding` alone. Because recall is always scoped to one user, the
`WHERE user_id = $1` filter meant an index without `user_id` as a prefix
couldn't serve the query — `EXPLAIN` showed the planner scanning straight past
it:

```
before:   • top-k → filter → scan
                     table: memory_vectors@memory_vectors_pkey
                     spans: FULL SCAN
```

Adding `user_id` as the index prefix fixed it. The production recall query now
plans as a real vector search:

```
after:    • top-k → lookup join
            └── • vector search
                  table: memory_vectors@idx_memory_vec_user
                  prefix spans: [/'00000000-…-0001' - /'00000000-…-0001']
```

That is the query the demo runs.

### 2. ccloud CLI — used for cluster access and connection management

Three commands, committed and runnable in
[`scripts/provision.sh`](scripts/provision.sh):

```bash
ccloud auth whoami                          # confirm authenticated identity
ccloud cluster info <cluster-id> -o json    # resolve the cluster
ccloud cluster sql <name> --connection-url  # emit DATABASE_URL non-interactively
```

**Scope, precisely:** the cluster itself was created in the CockroachDB Cloud
web console before that script existed — we did **not** provision it via CLI,
and the script says so in its own header. We used the CLI to authenticate,
locate the cluster, and pull the connection string into the app environment.

*A genuine gotcha, in case it's useful:* `ccloud cluster list` returned empty
for us despite valid access, because it scopes to the current organization and
our login resolved to a different default org. Direct lookup by cluster ID
worked immediately.

### Tools we did **not** use

**Managed MCP Server.** Configured — the server definition is committed at
[`.mcp.json`](.mcp.json) and [`agent/mcp/cockroach-mcp.json`](agent/mcp/cockroach-mcp.json),
pointed at our cluster. But the browser OAuth step was never completed (our
account was never added to the CockroachDB Cloud org that owns the cluster), so
**no query ever ran through it**. We are not claiming it. Tracked as open issue
#23.

**Agent Skills.** Not used, never in scope.

---

## AWS services we used

### Amazon Bedrock — live, on every request

| Model | ID | API | Role |
|---|---|---|---|
| Titan Text Embeddings V2 | `amazon.titan-embed-text-v2:0` | InvokeModel | 1024-dim vectors, called twice per turn (recall + write) |
| Claude Sonnet 4.5 | `us.anthropic.claude-sonnet-4-5-20250929-v1:0` | Converse | generates every reply |
| Claude Haiku 4.5 | `us.anthropic.claude-haiku-4-5-20251001-v1:0` | Converse | classifies what becomes a durable memory |

Using the smaller model for the high-frequency classification job is a
deliberate cost decision. Both Claude models are invoked through **cross-region
inference profiles** (the `us.` prefix) — on-demand throughput isn't offered for
them directly.

### AWS Lambda + SAM/CloudFormation — deployed and verified, not on the live path

Seven Node 22 functions deployed to `us-east-1` via AWS SAM (stack
`pantrymind`): three business-logic functions (pantry, recipes, shopping-list),
three Bedrock action-group adapters, and a hello-world. Verified by direct
invocation, with CloudWatch Logs as evidence.

They aren't serving traffic, and the reason is worth stating plainly. They were
built as **action groups for a Bedrock Agent** — OpenAPI schemas written,
adapters deployed. Partway through the build, `CreateAgent` began returning:

```
AccessDeniedException: Bedrock Agents is in Maintenance Mode.
New agent creation is not available for accounts without prior service usage.
```

AWS moved Bedrock Agents ("Classic") into Maintenance Mode on 2026-07-30 and
closed it to accounts with no prior Agents usage, with no exception process. Our
account had never created one, so it was locked out regardless of how correct
our IAM roles and adapters were — all independently verified before this
surfaced. The migration path (Bedrock AgentCore) is a full re-architecture, not
a swap-in.

So the reasoning moved to the **Bedrock Converse API**, and the shipped app
calls CockroachDB directly from its route handlers. What we lost was
Bedrock-mediated tool calling; we compensated by loading live pantry contents
straight into the model's context. [`agent/`](agent/) and the action-group
schemas remain in the repo as evidence and as a starting point for AgentCore.

CloudWatch Logs is used for Lambda logging. No custom metrics or alarms, so
we're not claiming observability beyond the default.

### Amazon S3 — we are not claiming it

A bucket was provisioned early for demo assets and never used; it is empty and
no application code touches S3. The one real involvement is indirect: AWS SAM
uploads bundled Lambda packages and CloudFormation templates to its managed
artifact bucket on each deploy. That's a build-artifact store, not a product
feature.

---

## Running it locally

```bash
npm install

cp .env.example .env      # then fill in DATABASE_URL and AWS credentials
                          # (AWS auth can also come from AWS_PROFILE)
```

Apply the schema, seed, and — **critically** — backfill the embeddings:

```bash
# 1. schema + seed data (idempotent, safe to re-run)
psql "$DATABASE_URL" -f scripts/schema.sql
psql "$DATABASE_URL" -f scripts/seed.sql

# 2. REQUIRED: seed.sql leaves memory_vectors empty by design, because each
#    row needs a real Titan embedding. Without this, recall returns nothing.
npx dotenv -e .env -- npx tsx scripts/backfill-embeddings.ts

# 3. run
cd apps/web && npm run dev        # http://localhost:3000
```

> Don't run `next build` while the dev server is running — they share
> `apps/web/.next` and the build overwrites the dev chunks, which serves a blank
> page. Recovery: stop dev, `rm -rf apps/web/.next`, restart.

### Verification scripts

No test framework; verification is executable scripts against the live cluster,
each using a throwaway user and cleaning up after itself.

```bash
npx dotenv -e .env -- npx tsx scripts/verify-pantry-crud.ts   # 40 assertions
npx dotenv -e .env -- npx tsx scripts/verify-cook.ts          # 53 assertions
```

`verify-cook.ts` covers unit conversion (including every case it correctly
*refuses* to convert), ingredient name matching, shortfall handling, and the
transactional apply with rollback.

---

## Features

- **Pantry CRUD** — add, edit, and remove items with quantity, unit, category
  and expiry. Rows are colour-coded by urgency; items can be retired as
  `consumed` or `wasted`, which preserves the waste-pattern signal the memory
  layer reads.
- **Cook a recipe** — pick a recipe and it computes what to deduct, converting
  units within a dimension (`oz`→`lb`, `cup`→`gallon`). Where there's no honest
  conversion — cups of flour out of a "bag" — it says so rather than guessing.
  Preview first; nothing is written until you confirm, and the apply runs in one
  transaction.
- **Cross-session memory** — the centrepiece, described above.

## Repo layout

```
apps/web/            Next.js frontend + API routes (the live app)
packages/shared/     types, pg pool, Titan embeddings, validation, cook engine
packages/memory/     the memory loop: recall → respond → write
lambda/              business-logic Lambdas (deployed, not on request path)
agent/               Bedrock action-group schemas + adapters (descoped)
scripts/             schema, seed, backfill, verification
```
