import { pool, embed } from '@pantrymind/shared';
import type { RecalledMemory } from '@pantrymind/shared';

/** Embeds the incoming message and returns the top-k most similar memories
 * for this user, ordered by similarity descending. `<=>` returns cosine
 * DISTANCE (0 = identical) — similarity is derived as 1 - distance so the
 * UI never has to do that conversion itself. */
export async function recall(userId: string, message: string, k = 5): Promise<RecalledMemory[]> {
  const vector = await embed(message);
  if (!vector) return [];

  const { rows } = await pool.query(
    `SELECT content, created_at, embedding <=> $1 AS distance
     FROM memory_vectors WHERE user_id = $2 ORDER BY distance LIMIT $3`,
    [JSON.stringify(vector), userId, k],
  );

  return rows.map((r) => ({
    content: r.content,
    created_at: r.created_at,
    distance: r.distance,
    similarity: 1 - r.distance,
  }));
}
