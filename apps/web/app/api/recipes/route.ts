import { NextResponse } from 'next/server';
import { pool } from '@pantrymind/shared';

/** Reads the DB on every request — never prerender it at build time (there's no
 *  DATABASE_URL then) and never serve it from the Data Cache. */
export const dynamic = 'force-dynamic';

/**
 * GET /api/recipes — the cookable set.
 *
 * Reads the `recipes` cache table directly rather than going through the
 * recipes Lambda: that Lambda calls Spoonacular and falls back to this same
 * table when SPOONACULAR_API_KEY is unset, which it currently is. Ranking by
 * expiry belongs to the agent path; this is just "what can I cook".
 */
export async function GET() {
  try {
    const { rows } = await pool.query(
      `SELECT id, external_id, title, ingredients, instructions, source_url
       FROM recipes
       ORDER BY title ASC`
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/recipes failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
