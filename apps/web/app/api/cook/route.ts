import { NextResponse } from 'next/server';
import {
  pool,
  planCook,
  isUuid,
  roundQuantity,
  resolveDemoUserId,
  PANTRY_ITEM_COLUMNS,
  type RecipeIngredient,
  type PantryCandidate,
} from '@pantrymind/shared';

/**
 * POST /api/cook — work out (and optionally apply) what cooking a recipe takes
 * out of the pantry.
 *
 *   { recipe_id }                            → dry run, returns the plan
 *   { recipe_id, confirm: true, deductions } → applies it, in one transaction
 *
 * The two-step shape is deliberate. Ingredient matching is a heuristic, so the
 * user sees exactly what will be subtracted and can correct it before anything
 * is written. `deductions` comes back from the client so edits in the preview
 * are honoured — every entry is re-checked against the DB before it's used.
 */

async function loadPantry(userId: string): Promise<PantryCandidate[]> {
  const { rows } = await pool.query(
    `SELECT ${PANTRY_ITEM_COLUMNS} FROM pantry_items WHERE user_id = $1 AND status = 'active'`,
    [userId]
  );
  return rows as PantryCandidate[];
}

export async function POST(req: Request) {
  try {
    let body: any;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 });
    }

    if (!isUuid(body?.recipe_id)) {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }

    const userId = await resolveDemoUserId();
    if (!userId) {
      return NextResponse.json({ error: 'Demo user is not seeded.' }, { status: 404 });
    }

    const { rows: recipeRows } = await pool.query(
      'SELECT id, title, ingredients FROM recipes WHERE id = $1',
      [body.recipe_id]
    );
    if (recipeRows.length === 0) {
      return NextResponse.json({ error: 'Recipe not found.' }, { status: 404 });
    }
    const recipe = recipeRows[0];
    const ingredients = (recipe.ingredients ?? []) as RecipeIngredient[];

    // --- Dry run -----------------------------------------------------------
    if (body.confirm !== true) {
      const plan = planCook(ingredients, await loadPantry(userId));
      return NextResponse.json({ recipe_id: recipe.id, title: recipe.title, ...plan });
    }

    // --- Apply -------------------------------------------------------------
    const requested = Array.isArray(body.deductions) ? body.deductions : null;
    if (!requested || requested.length === 0) {
      return NextResponse.json({ error: 'No deductions to apply.' }, { status: 400 });
    }
    for (const d of requested) {
      if (!isUuid(d?.item_id) || typeof d?.deduct !== 'number' || !Number.isFinite(d.deduct) || d.deduct < 0) {
        return NextResponse.json({ error: 'Invalid deduction.' }, { status: 400 });
      }
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const applied = [];

      for (const d of requested) {
        // FOR UPDATE: re-read inside the transaction so a concurrent edit
        // can't make us write a quantity derived from a stale read.
        const { rows } = await client.query(
          `SELECT name, quantity::float8 AS quantity, unit
           FROM pantry_items WHERE id = $1 AND user_id = $2 AND status = 'active'
           FOR UPDATE`,
          [d.item_id, userId]
        );
        if (rows.length === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: 'One of those items is no longer in your pantry. Nothing was changed.' },
            { status: 409 }
          );
        }

        const available = rows[0].quantity ?? 0;
        const deduct = roundQuantity(Math.min(d.deduct, available));
        const remaining = roundQuantity(available - deduct);

        // Only touch `status` when the item is actually emptied — writing
        // 'active' unconditionally would resurrect something already retired.
        if (remaining <= 1e-6) {
          await client.query(
            `UPDATE pantry_items SET quantity = 0, status = 'consumed' WHERE id = $1 AND user_id = $2`,
            [d.item_id, userId]
          );
        } else {
          await client.query(`UPDATE pantry_items SET quantity = $1 WHERE id = $2 AND user_id = $3`, [
            remaining,
            d.item_id,
            userId,
          ]);
        }

        applied.push({
          item_id: d.item_id,
          item_name: rows[0].name,
          unit: rows[0].unit,
          deducted: deduct,
          remaining: remaining <= 1e-6 ? 0 : remaining,
          consumed: remaining <= 1e-6,
        });
      }

      await client.query('COMMIT');
      return NextResponse.json({ recipe_id: recipe.id, title: recipe.title, applied });
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('POST /api/cook failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
