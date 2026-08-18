import { NextResponse } from 'next/server';
import { pool, resolveDemoUserId } from '@pantrymind/shared';

/**
 * GET /api/sessions — one row per distinct chat session for the demo user,
 * most recently active first. `title` is the session's first user message,
 * truncated, so the sidebar has something more useful than a bare UUID.
 */
export async function GET() {
  try {
    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json([]);
    }

    const { rows } = await pool.query(
      `WITH first_msg AS (
         SELECT DISTINCT ON (session_id) session_id, content AS title, created_at AS started_at
         FROM interactions
         WHERE user_id = $1 AND role = 'user'
         ORDER BY session_id, created_at ASC
       ),
       last_activity AS (
         SELECT session_id, MAX(created_at) AS last_at
         FROM interactions
         WHERE user_id = $1
         GROUP BY session_id
       )
       SELECT f.session_id, f.title, f.started_at, l.last_at
       FROM first_msg f
       JOIN last_activity l ON l.session_id = f.session_id
       ORDER BY l.last_at DESC`,
      [userId]
    );

    const sessions = rows.map((r) => ({
      sessionId: r.session_id,
      title: r.title.length > 60 ? `${r.title.slice(0, 57)}...` : r.title,
      startedAt: r.started_at,
      lastAt: r.last_at,
    }));

    return NextResponse.json(sessions);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
