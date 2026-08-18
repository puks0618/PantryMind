import { NextResponse } from 'next/server';
import { pool, resolveDemoUserId, isUuid } from '@pantrymind/shared';

type Ctx = { params: { id: string } };

/**
 * GET /api/sessions/:id — full message transcript for one session, oldest
 * first. Reconstructed from `interactions`, so historical assistant turns
 * carry no `memories` — recall isn't stored per-turn, only the classified
 * summary that may or may not have become a memory. MemoryInspector simply
 * renders nothing for these, same as any turn with no recalled memories.
 */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: 'Session not found.' }, { status: 404 });
    }

    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json([]);
    }

    const { rows } = await pool.query(
      `SELECT role, content, created_at
       FROM interactions
       WHERE user_id = $1 AND session_id = $2
       ORDER BY created_at ASC`,
      [userId, params.id]
    );

    const messages = rows.map((r) => ({ role: r.role, content: r.content }));
    return NextResponse.json(messages);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
