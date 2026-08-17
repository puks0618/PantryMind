// Embeds every non-chatter interaction that doesn't yet have a memory_vectors
// row, and inserts it. Run this after scripts/seed.sql, every time — seeded
// interactions are invisible to recall until they go through here, because
// recall only ever queries memory_vectors, never interactions directly.
//
// Usage: npx tsx scripts/backfill-embeddings.ts
import { pool, embed } from '../packages/shared/src';

async function main() {
  const { rows } = await pool.query(`
    SELECT i.id, i.user_id, i.content, i.summary, i.kind
    FROM interactions i
    LEFT JOIN memory_vectors mv ON mv.interaction_id = i.id
    WHERE i.kind IS NOT NULL AND i.kind != 'chatter' AND mv.id IS NULL
  `);

  console.log(`${rows.length} interaction(s) need embedding.`);

  let ok = 0;
  let failed = 0;

  for (const row of rows) {
    const text = row.summary ?? row.content;
    const vector = await embed(text);

    if (!vector) {
      console.error(`  FAILED (embed returned null): "${text}"`);
      failed++;
      continue;
    }

    await pool.query(
      `INSERT INTO memory_vectors (user_id, interaction_id, content, embedding) VALUES ($1, $2, $3, $4)`,
      [row.user_id, row.id, text, JSON.stringify(vector)],
    );
    console.log(`  embedded: "${text}"`);
    ok++;
  }

  console.log(`Done. ${ok} embedded, ${failed} failed.`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('backfill failed:', err);
  process.exit(1);
});
