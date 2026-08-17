# PantryMind — Demo Video Script

3:00 max. Every beat below is something that must actually work on the deployed app — nothing here
is aspirational. **Build only what appears in this script.** If a beat is broken by feature freeze,
cut the beat from the video rather than debug it live.

## Cast

- One browser window, incognito, pointed at the production Vercel URL.
- Demo user: `demo` (hardcoded, matches `DEMO_USER_HANDLE`).
- Seed data already loaded before recording starts — `scripts/seed.sql` applied, embeddings
  backfilled via `scripts/backfill-embeddings.ts`. Re-run both if re-recording.

---

## 0:00–0:20 — The problem

On camera, spoken, no UI on screen yet:

> "Households throw out food because nobody remembers what's about to expire, or what they said
> last time they cooked it. PantryMind is a pantry agent that remembers — across sessions."

## 0:20–1:10 — Live pantry, expiry-aware suggestion, a stated preference

Screen: chat pane, fresh page load. **Session 1.**

1. Type: *"I just bought a dozen eggs and a bag of spinach, the spinach won't last long."*
   → Agent confirms both items added. Because seeded memory already shows a leafy-greens waste
   pattern, it proactively flags it — this is memory influencing output on the very first turn.
2. Type: *"What should I make with what's expiring soonest?"*
   → Agent lists the 2–3 nearest-expiry pantry items and suggests a recipe built around them.
3. Type: *"I really don't like cilantro, don't put it in recipes for me."*
   → Agent acknowledges. **This is the preference Session 2 must recall.** Point at the
   MemoryInspector panel as it logs the new memory being written.

## 1:10–2:10 — ★ THE CENTREPIECE. Fresh session, cross-session recall.

Close the tab. Open a brand-new incognito window. New session ID, same demo user.

1. Type: *"What should I cook tonight?"*
2. **Before the answer renders, narrate:** "This is a session that has never seen this
   conversation. Nothing about cilantro has been said here."
3. Agent responds with a recipe that omits cilantro, and **says so in plain language** —
   e.g. *"...I left out the usual cilantro garnish since I remember you don't like it."*
4. **Point at the MemoryInspector panel**, which shows something like:
   `recalled: "user dislikes cilantro" — 0.8+ similarity, N days ago`
5. Hold this shot. This single frame is what the whole project is judged on.

## 2:10–2:45 — Architecture, named out loud

Cut to `docs/architecture.png`.

> "Under the hood: CockroachDB Cloud, provisioned and queried via the ccloud CLI, with a
> distributed vector index over every memory embedding, and a Managed MCP Server the agent
> queries directly. On AWS: Bedrock Agents for reasoning, Lambda for pantry and recipe logic,
> S3 for demo assets, and Titan embeddings generated on every turn."

## 2:45–3:00 — Close

Demo URL and repo link on screen. End.

---

## Recording checklist

- [ ] Seed data fresh — re-run `seed.sql` + `backfill-embeddings.ts` if re-recording
- [ ] Both sessions rehearsed once, end to end, before hitting record
- [ ] MemoryInspector similarity score is legible on screen — zoom in if needed
- [ ] Total runtime under 3:00 — time it before upload
- [ ] Uploaded to YouTube, set to **Public**, link tested in a separate incognito window
