import { NextResponse } from 'next/server';
import { pool, parseCreate, resolveDemoUserId, PANTRY_ITEM_COLUMNS } from '@pantrymind/shared';

/** Live pantry state — never prerender at build time, never serve from cache. */
export const dynamic = 'force-dynamic';

/** GET /api/pantry — every item for the (single, hardcoded) demo user. */
export async function GET() {
  try {
    const userId = await resolveDemoUserId();
    if (!userId) return NextResponse.json([]);

    const { rows } = await pool.query(
      `SELECT ${PANTRY_ITEM_COLUMNS}
       FROM pantry_items
       WHERE user_id = $1
       ORDER BY expires_at ASC NULLS LAST`,
      [userId]
    );
    return NextResponse.json(rows);
  } catch (err) {
    // Don't echo raw DB/internal error text back to the caller.
    console.error('GET /api/pantry failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** POST /api/pantry — add an item. `added_at` and `status` fall through to their
 *  column defaults, matching addItem() in lambda/pantry/index.ts. */
export async function POST(req: Request) {
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const parsed = parseCreate(body);
    if (!parsed.ok) {
      return NextResponse.json({ errors: parsed.errors }, { status: 400 });
    }

    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Demo user is not seeded.' }, { status: 404 });
    }

    const { name, category, quantity, unit, expires_at } = parsed.value;
    const { rows } = await pool.query(
      `INSERT INTO pantry_items (user_id, name, category, quantity, unit, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PANTRY_ITEM_COLUMNS}`,
      [userId, name, category, quantity, unit, expires_at]
    );
    return NextResponse.json(rows[0], { status: 201 });
  } catch (err) {
    console.error('POST /api/pantry failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
