import { pool, embed } from '@pantrymind/shared';
import { classify } from './classify';

/** Persists one completed exchange. Inserts both turns into `interactions`
 * unconditionally; if the exchange carries a durable fact (kind !== 'chatter'),
 * embeds the summary and adds a `memory_vectors` row too. Intended to run
 * after the response has already been returned to the user — never await
 * this in a way that delays the answer. */
export async function write(
  userId: string,
  sessionId: string,
  userMessage: string,
  assistantAnswer: string,
): Promise<void> {
  const { kind, summary } = await classify(userMessage, assistantAnswer);

  const { rows } = await pool.query(
    `INSERT INTO interactions (user_id, session_id, role, content, summary, kind)
     VALUES ($1, $2, 'user', $3, $4, $5) RETURNING id`,
    [userId, sessionId, userMessage, summary, kind],
  );

  await pool.query(
    `INSERT INTO interactions (user_id, session_id, role, content, kind)
     VALUES ($1, $2, 'assistant', $3, 'chatter')`,
    [userId, sessionId, assistantAnswer],
  );

  if (kind !== 'chatter' && summary) {
    const vector = await embed(summary);
    if (vector) {
      await pool.query(
        `INSERT INTO memory_vectors (user_id, interaction_id, content, embedding) VALUES ($1, $2, $3, $4)`,
        [userId, rows[0].id, summary, JSON.stringify(vector)],
      );
    }
  }
}
