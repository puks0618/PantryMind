# Track A Execution Runbook — Pukhraj

> **Claude Code: read this file top to bottom before acting.**
> This is an execution runbook, not a reference. It tells you which phase you are allowed to start
> *right now* based on machine-checkable gates, and what to do instead when a gate fails.
>
> **Never start a phase whose gate fails.** Run the router in §3 to pick your phase.
>
> Companion documents: [`plan.md`](../plan.md) (two-developer contract, the frozen types and schema live there)
> and [`IMPLEMENTATION_PLAN_Hackathon.md`](../IMPLEMENTATION_PLAN_Hackathon.md) (architecture).

---

## 1. What you are building

Track A is the **memory layer** of PantryMind — the part being judged. Prajwal owns Track B (Lambda functions, SAM, the Next.js shell). You own the database, the embedding and recall pipeline, the Bedrock agent, and the chat API route.

**The one behaviour that must work:** a user states a preference in one session; in a completely new session the agent recalls it without being reminded and visibly changes its recommendation, with similarity scores shown in the UI.

| Milestone | Deadline (MST) |
| --- | --- |
| **Cross-session recall working (S4)** | **2026-08-17 18:00** |
| Feature freeze | 2026-08-18 02:00 |
| Video uploaded | 2026-08-18 06:00 |
| Devpost submitted | 2026-08-18 12:00 |

If S4 slips, stop building and drop down the fallback ladder in §8. Everything after S4 is packaging.

---

## 2. Environment prerequisites

```bash
export PATH="$HOME/.local/bin:$PATH"   # gh lives here, not on the default PATH
```

**One-time, must be done by the human — you cannot do this:**

```bash
gh auth refresh -s project             # browser flow, ~1 min
```

Without it every `gh project` command in this file fails. Issue closing, branching, and PRs all work regardless — only board sync is affected. If the scope is missing, **continue working and skip the board steps**, noting it in the PR body. Do not stall on it.

---

## 3. The router — which phase can I start?

Define the gates once per session, then run the router.

```bash
gate_aws_cli()  { command -v aws >/dev/null 2>&1; }
gate_creds()    { gate_aws_cli && aws sts get-caller-identity >/dev/null 2>&1; }
gate_db()       { [ -n "${DATABASE_URL:-}" ] && node -e "
                  const { Pool } = require('pg');
                  const p = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
                  p.query('SELECT 1').then(() => { p.end(); process.exit(0); }).catch(() => process.exit(1));
                  " 2>/dev/null; }   # run from repo root so node resolves 'pg' — see §5 Phase 1 note on psql
gate_bedrock()  { gate_creds && aws bedrock list-foundation-models \
                  --query "modelSummaries[?modelId=='amazon.titan-embed-text-v2:0']" \
                  --output text 2>/dev/null | grep -q titan; }
gate_lambdas()  { gate_creds && [ "$(aws lambda list-functions \
                  --query 'length(Functions)' --output text 2>/dev/null)" -ge 3 ] 2>/dev/null; }
gate_nextjs()   { test -f apps/web/package.json; }
```

**Decision procedure — take the first phase whose gate passes and whose issues are still open:**

| Order | Phase | Gate | If it fails |
| --- | --- | --- | --- |
| 1 | **Phase 0 — contract** | *none* | n/a — always startable |
| 2 | **Phase 1 — tooling + docs** | *none* | n/a |
| 3 | **Phase 2 — database** | `gate_db` | → Phase 1 leftovers, then §3.1 |
| 4 | **Phase 3 — embeddings** | `gate_bedrock` | → §3.1, check §8 deadline |
| 5 | **Phase 4 — memory loop** | phase 3 merged | → §3.1 |
| 6 | **Phase 5 — agent + MCP** | `gate_lambdas` | → #23 only (no gate), then §3.1 |
| 7 | **Phase 6 — route** | `gate_nextjs` | → §3.1 |
| 8 | **Phase 7 — submission** | phases 4–6 merged | → §3.1 |

### 3.1 What to do when blocked

Do all three, in order — never idle, and never half-build a gated phase:

1. **Comment on the blocking issue** so Prajwal sees it without being asked:
   ```bash
   gh issue comment <blocking#> --body "@PrajwalDambalkar Track A is blocked on this. \
   Waiting to start <phase>. Everything unblocked on my side is done."
   ```
2. **Fall back to unblocked work.** In priority order: #21 (system prompt), #24 (demo script), #23 (MCP config), README skeleton, unit tests for anything already merged.
3. **Re-run the router** before starting anything else. Gates change when Prajwal pushes.

---

## 4. Standard procedure — run this identically every phase

### 4.1 Start

```bash
git checkout main
git pull --rebase                                  # ALWAYS - picks up Prajwal's work
git checkout -b track-a/phase-N-<name>
```

Then mark each issue in the phase **In Progress** (see §4.4).

### 4.2 Implement

Work issue by issue. **Verify each issue's acceptance criterion before moving to the next** — they are in the issue body (`gh issue view <n>`). Commit after each issue rather than once at the end:

```bash
git add -A && git commit -m "feat(memory): <what> (#<n>)"
```

### 4.3 Finish

```bash
git push -u origin track-a/phase-N-<name>
gh pr create --title "Phase N — <name>" --body "$(cat <<'EOF'
## What
<one line per issue>

## Verification
<the actual command output proving each acceptance criterion>

Closes #a
Closes #b
EOF
)"
# only after every acceptance criterion in the PR body actually passes:
gh pr merge --squash --delete-branch
```

`Closes #n` lines auto-close the issues on merge — no separate `gh issue close` needed.

**Self-merge as soon as the criteria pass.** The PR is a conflict-detector and a record, not an approval gate. Do not wait for Prajwal.

### 4.4 Board sync

Requires the `project` scope from §2. **Phase 0 does this discovery once** and writes the IDs back into this file:

```bash
gh project field-list 3 --owner puks0618 --format json    # find Status field id + option ids
gh project item-list 3 --owner puks0618 --format json     # find item ids per issue
```

Then create `scripts/board.sh` so the other 20+ updates are one command each:

```bash
#!/bin/bash
# usage: ./scripts/board.sh <issue-number> "In Progress"|"Done"
# IDs discovered in Phase 0 - fill these in:
PROJECT_ID="";  STATUS_FIELD_ID="";  TODO_ID="";  INPROGRESS_ID="";  DONE_ID=""
```

If the scope is still missing, skip this section and say so in the PR body. It is not worth blocking on.

---

## 5. Phases

### Phase 0 — the contract · `track-a/phase-0-contract`

**Gate: none. Start immediately.**

This is the highest-priority work in the project right now, because **four of Prajwal's issues (#26, #28, #29, #30) cannot start until #6 lands.** Merge it fast, then tell him to pull.

| Issue | Task |
| --- | --- |
| **#5** | Root `package.json` with npm workspaces covering `packages/*`, `apps/*`, `lambda/*` |
| **#6** | `packages/shared/src/types.ts` — **copy verbatim from `plan.md` §4.2.** Frozen once pushed. |
| **#7** | `packages/shared/src/db.ts` — `pg` Pool, `max: 2`, short idle timeout, `ssl: { rejectUnauthorized: true }`, module-scoped so warm Lambdas reuse it |
| **#8** | `scripts/schema.sql` — **copy verbatim from `plan.md` §4.1** |

Also in this PR: `docs/EXECUTION_TRACK_A.md` (this file) and the `plan.md` §10 amendment.

**Acceptance:** `npm install` resolves all workspaces; `tsc --noEmit` passes on `packages/shared`.
`db.ts` cannot be connection-tested yet — its `SELECT 1` check is deferred to Phase 2. Write it, do not test it.

**On merge:** message Prajwal — *"#6 shared types are on main, pull before you write handlers."*

---

### Phase 1 — tooling + zero-dependency docs · `track-a/phase-1-tooling-docs`

**Gate: none for the install and doc work.**

Nothing here waits on Prajwal, which is the point: this phase exists to convert time spent waiting on his credentials into finished work.

| Issue | Task | Note |
| --- | --- | --- |
| **#9** | Install `aws`, `ccloud`, and `psql` | See below — Homebrew needs sudo, which was not available. Adapted. |
| **#24** | `docs/demo-script.md` — the exact 3-minute narrative, turn by turn | **Write this first.** It defines what has to work, so it constrains every later phase. Anything not in it is out of scope. |
| **#21** | `agent/config/system-prompt.md` | No dependencies despite being numbered late |

For **#21**, the prompt must explicitly instruct the agent to:
- consult the provided memory context **before** answering anything about preferences, past meals, or recommendations
- prioritise pantry items by expiry urgency
- **cite which remembered facts influenced a recommendation, in plain language** — "I left out cilantro since I remember you don't like it"

That last bullet is what makes the demo legible on camera. An agent that silently uses memory looks identical to one that has none.

#### ⚠ #9 — Homebrew needs sudo. It was not available on this machine. Here is the adaptation.

`NONINTERACTIVE=1` Homebrew install still stops at "Need sudo access" — it requires an administrator
password there is no way to supply non-interactively, and it should not be worked around by attempting
privilege escalation. Two tools were installed anyway, without Homebrew and without sudo:

- **`aws`** — downloaded the official `.pkg`, expanded it with `pkgutil --expand-full` (no sudo needed;
  this unpacks the payload without ever invoking the installer as root), then copied the `aws-cli`
  bundle into `~/.local/aws-cli` and symlinked `~/.local/bin/aws`.
- **`ccloud`** — CockroachDB publishes direct per-platform tarballs at
  `https://binaries.cockroachdb.com/ccloud/ccloud_darwin-<arch>_<version>.tar.gz` (verified with a HEAD
  request before downloading). Extracted directly into `~/.local/bin`.

**`psql` was not installed.** The only non-sudo path is Postgres.app, an 84–508MB download to obtain
one CLI binary. Not worth it: `pg` (node-postgres) is already a dependency of `packages/shared`, hoisted
to root `node_modules`, and does everything `psql` would be asked to do here. **`gate_db()` above and
`#11` below use a `node -e` one-liner against `pg` instead of `psql`.** If `psql` genuinely becomes
necessary later (e.g. interactive debugging), install Postgres.app then — don't block on it now.

Both `~/.local/aws-cli` and `~/.local/bin` are **outside the repo** — this is machine setup, not
something to commit. Ensure `~/.local/bin` is on `PATH` in any new shell: `export PATH="$HOME/.local/bin:$PATH"`.

**Acceptance:** `aws --version` and `ccloud version` work; `psql` is intentionally absent, substituted
by the `pg`-based check above; both markdown files committed.

---

### Phase 2 — database · `track-a/phase-2-database`

**Gate: `gate_db`** — if it fails, #3 has not landed. Go to §3.1.

| Issue | Task |
| --- | --- |
| **#10** | `ccloud auth login`, `ccloud cluster list`, `ccloud cluster sql <name>`. Capture in `scripts/provision.sh`. |
| **#11** | Apply `scripts/schema.sql` — via `node -e` + `pg`, not `psql -f` (see Phase 1 note) |
| **#12** | Write and apply `scripts/seed.sql` |

**#10 — be accurate.** The cluster already exists; Prajwal created it. Put a comment in `provision.sh` saying so. Do not write `ccloud cluster create` commands implying you provisioned it. This script is the submission evidence for the `ccloud` CLI requirement and a judge may read it.

**#11** — no `psql` binary on this machine (Phase 1). Apply the schema with:
```bash
node -e "
const fs = require('fs');
const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: true } });
c.connect().then(() => c.query(fs.readFileSync('scripts/schema.sql', 'utf8')))
  .then(() => { console.log('schema applied'); return c.end(); })
  .catch(e => { console.error(e); process.exit(1); });
"
```
If `cspann` is unavailable on this cluster version, fall back to exact search with no index and **record it for the README**.

**#12 — seed requirements:**
- one demo user, handle `demo`
- 12–15 pantry items, expiry written as `now() + INTERVAL 'N days'` — **never hardcoded dates**, or the demo goes stale between seeding and recording. Several within 3 days.
- **at least 8 prior interactions from a previous session** — different `session_id`, backdated `created_at`, including 2–3 durable preferences: a disliked ingredient (cilantro is the one the demo script should use), a dietary constraint, a recurring waste pattern

Also verify #7's `db.ts` here — `SELECT 1` through the pool.

**Acceptance:** all five tables exist; `pantry_items` 12–15 rows; `interactions` ≥ 8.

---

### Phase 3 — embeddings · `track-a/phase-3-embeddings`

**Gate: `gate_bedrock`** — needs #1 (model access granted) *and* #2 (creds). If it fails, go to §3.1 **and check the §8 fallback deadline**. This phase is the S4 critical path.

| Issue | Task |
| --- | --- |
| **#15** | `packages/shared/src/embed.ts` — wrap `InvokeModel` with `amazon.titan-embed-text-v2:0`, string → `number[1024]` |
| **#13** | `scripts/backfill-embeddings.ts` |
| **#14** | Verify similarity search by hand |

**#15:** on failure, log and **return `null` — never throw**. A failed embedding must not break a chat turn.

**#13 is the step most likely to cost you the demo.** `seed.sql` wrote rows into `interactions`, but recall queries `memory_vectors` — a table SQL alone cannot populate, because every row needs a 1024-float embedding. Skip this and cross-session recall silently returns nothing, and the failure presents as a broken vector index. You will lose hours debugging the wrong layer.

The script: read each seeded non-chatter interaction → generate a one-sentence summary → embed the summary → insert into `memory_vectors`. Embed the **summary**, not the raw text; raw conversational text is noisy and retrieves poorly.

**#14:**
```sql
SELECT content, embedding <=> $1 AS distance
FROM memory_vectors WHERE user_id = $2 ORDER BY distance LIMIT 5;
```

**Acceptance:** `embed()` returns a 1024-length array; `SELECT count(*) FROM memory_vectors` ≥ 6 with no null embeddings; a cilantro-related query ranks the cilantro preference first.

---

### Phase 4 — memory loop · `track-a/phase-4-memory-loop`

**Gate: Phase 3 merged.**

| Issue | Task |
| --- | --- |
| **#16** | `packages/memory/src/recall.ts` |
| **#17** | `packages/memory/src/classify.ts` |
| **#18** | `packages/memory/src/write.ts` |
| **#19** | `packages/memory/src/index.ts` — export `handleTurn()` |

**#16 — the distance/similarity trap.** `<=>` returns cosine **distance** (0 = identical, higher = less similar). The UI displays **similarity**. Populate both fields on `RecalledMemory`, with `similarity: 1 - distance`, or the inspector renders every score backwards. This looks correct in SQL and wrong on screen.

**#17:** one cheap Bedrock call returning strict JSON. **On any failure default to `chatter`** so a bad classification degrades quietly instead of breaking the turn.

**#18:** insert into `interactions` always; if `kind !== 'chatter'`, embed the summary and insert into `memory_vectors` too. **Runs after the response is sent** — it must never add latency to what the user is waiting on.

#### ⚠ #19 has a soft dependency on #22, and it must stay soft

GitHub says #19 is blocked by #22 (the Bedrock agent). **Do not treat that as hard.** Build the model call behind a small interface:

```ts
interface Responder { respond(input: string, memories: RecalledMemory[]): Promise<string> }
// default: ConverseResponder  — direct Bedrock Converse, works today, no agent required
// later:   AgentResponder     — InvokeAgent, swapped in after #22 lands
```

`handleTurn()` = embed → recall → `responder.respond()` → write → return `ChatResponse`.

This is the `plan.md` §9 fallback pre-wired rather than retrofitted at hour 30. It means the entire memory loop — the judged behaviour — is demonstrable before the agent exists, and Phase 5 becomes an upgrade rather than a prerequisite. **Amend issue #19 to say the #22 dependency is soft.**

**Acceptance:** `handleTurn()` callable from a Node script, returns a well-formed `ChatResponse`; a preference turn writes one row to each table, a chatter turn writes only to `interactions`.

---

### Phase 5 — agent + MCP · `track-a/phase-5-agent`

**Gate: `gate_lambdas`** — #22 needs Prajwal's ARNs from #31. **#23 has no gate and can be done any time**, including while blocked.

| Issue | Task |
| --- | --- |
| **#23** | `agent/mcp/cockroach-mcp.json` — endpoint `https://cockroachlabs.cloud/mcp` |
| **#22** | Create the Bedrock agent, register action groups against Prajwal's Lambdas |

**#23 caveat not captured in the issue:** generating the MCP config needs access to the CockroachDB Cloud console for *Prajwal's* organisation. If you are not a member, ask him to add you or send the MCP API key. Test MCP from Claude Code first — list tables and run a read query — before wiring it into the agent. This is one of three claimed CockroachDB tools, so it has to genuinely work.

**#22:** OpenAPI schemas go in `agent/config/action-groups.json`; agent ID and alias into `.env`. Once it works, swap `AgentResponder` in for `ConverseResponder` from Phase 4 — one line.

**Acceptance:** a read query through MCP returns rows; the agent responds and invokes at least one Lambda.

---

### Phase 6 — route wiring · `track-a/phase-6-route`

**Gate: `gate_nextjs`** — `apps/web/package.json` must exist, which is Prajwal's #32.

| Issue | Task |
| --- | --- |
| **#20** | `apps/web/app/api/chat/route.ts` |

A thin POST handler calling `handleTurn()`. **Ten lines, no logic.** You own this file even though it lives in Prajwal's app — it *is* the memory loop. Keeping it thin is what stops the two tracks colliding on it.

**Acceptance:** `curl -X POST localhost:3000/api/chat -d '{"message":"hi"}'` returns `{ answer, memories, sessionId }`.

---

### Phase 7 — integration + submission · `track-a/phase-7-submission`

**Gate: phases 4–6 merged.** Both developers present.

| Issue | Task |
| --- | --- |
| **#37** | Integration checkpoint — full demo script, fresh session, **twice in a row** |
| **#39** | README + Devpost submission |

Check these failure points first: Lambda cold start vs the agent's tool-call timeout; connection pool exhaustion; embedding dimension mismatch; env vars missing in Vercel production.

README must name **which CockroachDB tools were used and what the agent actually did with each** (MCP Server, Distributed Vector Indexing, `ccloud` CLI) and the same for AWS (Bedrock Agents, Lambda, S3). This is an explicit judging requirement, not boilerplate.

---

## 6. Dependency map

| Prajwal's issue | Gate | Blocks |
| --- | --- | --- |
| #1 Bedrock model access | `gate_bedrock` | #15, #17, #22 → **Phases 3, 4, 5** |
| #2 IAM credentials | `gate_creds` | #9 (partly), #15, #22 |
| #3 `DATABASE_URL` | `gate_db` | #10, #11, #12 → **Phase 2** |
| #31 Lambda ARNs | `gate_lambdas` | #22 → **Phase 5** |
| #32 Next.js scaffold | `gate_nextjs` | #20 → **Phase 6** |

**Phases 0 and 1 depend on nothing.** If you are ever blocked and those are not complete, you are working on the wrong thing.

---

## 7. Git workflow

You branch and PR; **Prajwal commits straight to `main`.** The asymmetry is deliberate: your branches rebase onto whatever he has pushed, so conflicts surface on your side where they can be resolved without interrupting him, and he needs no workflow change mid-project.

- `git pull --rebase` before every branch and before every push
- One branch and one PR per phase — do not accumulate phases on one branch
- Squash-merge and delete the branch
- Never edit a file in Prajwal's ownership list (`plan.md` §3). If you need one changed, comment on his issue.

---

## 8. Fallback ladder — and when it stops being optional

| If this breaks | Fall back to |
| --- | --- |
| `cspann` index unavailable | Exact vector search, no index. Note in README. |
| Vector search entirely | Keyword/recency retrieval over `interactions`. Keeps cross-session recall, loses semantic matching. |
| **Bedrock access not granted by 2026-08-17 14:00 MST** | **Switch to the direct Anthropic API. Do not keep waiting.** Keep Lambda + S3 for the AWS requirement. |
| Bedrock Agents too slow to configure | Stay on `ConverseResponder` from Phase 4. It already works. |
| Spoonacular unavailable | Serve from the seeded `recipes` cache. |
| Out of time generally | Cut shopping-list, cut CRUD polish, cut styling. |

**Never cut:** writing memory every turn, recalling it across sessions, showing that recall in the UI. If one thing works at the deadline, it is that loop.

The 14:00 row is a decision deadline, not a suggestion. Waiting indefinitely on model access is the single most likely way this project ends with nothing to demo.
