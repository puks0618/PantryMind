import { NextResponse } from 'next/server';
import { pool } from '@pantrymind/shared';

/**
 * GET /api/pantry — current items for the (single, hardcoded) demo user.
 * Not part of the plan's explicit file list; added because PantryList.tsx
 * needs a data source and this is the simplest one that doesn't require
 * round-tripping through Lambda just to read rows.
 */
export async function GET() {
  try {
    const demoHandle = process.env.DEMO_USER_HANDLE ?? 'demo';
    const { rows: userRows } = await pool.query('SELECT id FROM users WHERE handle = $1', [demoHandle]);
    if (userRows.length === 0) {
      return NextResponse.json([]);
    }

    const { rows } = await pool.query(
      `SELECT id, name, category, quantity, unit, expires_at, status
       FROM pantry_items
       WHERE user_id = $1
       ORDER BY expires_at ASC NULLS LAST`,
      [userRows[0].id]
    );
    return NextResponse.json(rows);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
