import { NextResponse } from 'next/server';
import {
  pool,
  parsePatch,
  isUuid,
  resolveDemoUserId,
  PATCHABLE_COLUMNS,
  PANTRY_ITEM_COLUMNS,
} from '@pantrymind/shared';

type Ctx = { params: { id: string } };

/**
 * Both handlers scope every query with `AND user_id = $n`. There is no auth, so
 * that scoping is the only thing stopping a leaked item UUID from being edited
 * or deleted by another user — same reasoning as setStatus() in
 * lambda/pantry/index.ts.
 */

/** PATCH /api/pantry/:id — partial update of any editable field, status included. */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    // Without this guard a malformed id reaches CockroachDB as a UUID parse
    // error and surfaces as an opaque 500 instead of an honest 404.
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    const parsed = parsePatch(body);
    if (!parsed.ok) {
      return NextResponse.json({ errors: parsed.errors }, { status: 400 });
    }

    // Column names come from the fixed allowlist, never from request keys —
    // that is what makes interpolating them into the SET clause safe.
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const column of PATCHABLE_COLUMNS) {
      if (!(column in parsed.value)) continue;
      values.push(parsed.value[column]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
    }

    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Demo user is not seeded.' }, { status: 404 });
    }

    values.push(params.id, userId);
    const { rows } = await pool.query(
      `UPDATE pantry_items SET ${sets.join(', ')}
       WHERE id = $${values.length - 1} AND user_id = $${values.length}
       RETURNING ${PANTRY_ITEM_COLUMNS}`,
      values
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('PATCH /api/pantry/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/pantry/:id — removes the row outright.
 *
 * This is for mis-adds and typos. Marking something used or wasted is a PATCH
 * of `status`, which keeps the row and therefore keeps the waste-pattern signal
 * the memory loop reads.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    if (!isUuid(params.id)) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }

    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Demo user is not seeded.' }, { status: 404 });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM pantry_items WHERE id = $1 AND user_id = $2',
      [params.id, userId]
    );
    if (rowCount === 0) {
      return NextResponse.json({ error: 'Item not found.' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('DELETE /api/pantry/[id] failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
