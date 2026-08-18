import { pool } from './db';

// Mirrors packages/shared/src/types.ts — see lambda/pantry/db.ts for why this is local.
type ItemStatus = 'active' | 'consumed' | 'wasted';
interface PantryItem {
  id: string;
  user_id: string;
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  added_at: string;
  expires_at: string | null;
  status: ItemStatus;
}

export async function addItem(input: {
  user_id: string;
  name: string;
  quantity?: number | null;
  unit?: string | null;
  expires_at?: string | null;
  category?: string | null;
}): Promise<PantryItem> {
  const { rows } = await pool.query(
    `INSERT INTO pantry_items (user_id, name, category, quantity, unit, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, user_id, name, category, quantity, unit, added_at, expires_at, status`,
    [input.user_id, input.name, input.category ?? null, input.quantity ?? null, input.unit ?? null, input.expires_at ?? null]
  );
  return rows[0];
}

export async function listItems(user_id: string): Promise<PantryItem[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, name, category, quantity, unit, added_at, expires_at, status
     FROM pantry_items WHERE user_id = $1 ORDER BY added_at DESC`,
    [user_id]
  );
  return rows;
}

export async function markConsumed(item_id: string, user_id: string): Promise<PantryItem> {
  return setStatus(item_id, user_id, 'consumed');
}

export async function markWasted(item_id: string, user_id: string): Promise<PantryItem> {
  return setStatus(item_id, user_id, 'wasted');
}

// Scoped by user_id too — otherwise anyone who knows another user's item UUID
// could flip its status.
async function setStatus(item_id: string, user_id: string, status: ItemStatus): Promise<PantryItem> {
  const { rows } = await pool.query(
    `UPDATE pantry_items SET status = $3 WHERE id = $1 AND user_id = $2
     RETURNING id, user_id, name, category, quantity, unit, added_at, expires_at, status`,
    [item_id, user_id, status]
  );
  if (rows.length === 0) {
    throw new Error('Item not found');
  }
  return rows[0];
}

/**
 * Partial update of any editable field. The column list is a fixed allowlist,
 * so interpolating names into the SET clause is safe; values stay parameterised.
 *
 * Validation is intentionally thin here. The web UI's write path goes through
 * packages/shared/src/pantry.ts (parsePatch), which is the real validator — this
 * handler exists for agent tool parity and can't import it, for the same
 * esbuild-staging reason db.ts documents. A key that is absent leaves its column
 * alone; a key that is present and null clears it.
 */
export async function updateItem(
  item_id: string,
  user_id: string,
  patch: Partial<Pick<PantryItem, 'name' | 'category' | 'quantity' | 'unit' | 'expires_at' | 'status'>>
): Promise<PantryItem> {
  const PATCHABLE = ['name', 'category', 'quantity', 'unit', 'expires_at', 'status'] as const;

  const sets: string[] = [];
  const values: unknown[] = [];
  for (const column of PATCHABLE) {
    if (!Object.prototype.hasOwnProperty.call(patch, column)) continue;
    values.push(patch[column]);
    sets.push(`${column} = $${values.length}`);
  }
  if (sets.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(item_id, user_id);
  const { rows } = await pool.query(
    `UPDATE pantry_items SET ${sets.join(', ')}
     WHERE id = $${values.length - 1} AND user_id = $${values.length}
     RETURNING id, user_id, name, category, quantity, unit, added_at, expires_at, status`,
    values
  );
  if (rows.length === 0) {
    throw new Error('Item not found');
  }
  return rows[0];
}

/** Hard delete, for mis-adds. Use markConsumed/markWasted to retire an item the
 *  user actually had — those keep the row, and with it the waste-pattern signal. */
export async function deleteItem(item_id: string, user_id: string): Promise<{ deleted: boolean }> {
  const { rowCount } = await pool.query(
    'DELETE FROM pantry_items WHERE id = $1 AND user_id = $2',
    [item_id, user_id]
  );
  if (rowCount === 0) {
    throw new Error('Item not found');
  }
  return { deleted: true };
}

/** Sorted by urgency — soonest expiry first. Pure date arithmetic, no rules engine. */
export async function getExpiringItems(user_id: string, within_days: number): Promise<PantryItem[]> {
  const { rows } = await pool.query(
    `SELECT id, user_id, name, category, quantity, unit, added_at, expires_at, status
     FROM pantry_items
     WHERE user_id = $1 AND status = 'active' AND expires_at IS NOT NULL
       AND expires_at <= (now() + ($2 || ' days')::interval)::date
     ORDER BY expires_at ASC`,
    [user_id, within_days]
  );
  return rows;
}

type Action =
  | 'addItem'
  | 'listItems'
  | 'updateItem'
  | 'deleteItem'
  | 'markConsumed'
  | 'markWasted'
  | 'getExpiringItems';

const VALID_ACTIONS: Action[] = [
  'addItem',
  'listItems',
  'updateItem',
  'deleteItem',
  'markConsumed',
  'markWasted',
  'getExpiringItems',
];

export const handler = async (event: { action: Action; params: any }) => {
  if (!VALID_ACTIONS.includes(event.action)) {
    return { statusCode: 400, body: JSON.stringify({ error: `Unknown action: ${event.action}` }) };
  }

  try {
    let result: unknown;
    switch (event.action) {
      case 'addItem':
        result = await addItem(event.params);
        break;
      case 'listItems':
        result = await listItems(event.params.user_id);
        break;
      case 'updateItem': {
        const { item_id, user_id, ...patch } = event.params;
        result = await updateItem(item_id, user_id, patch);
        break;
      }
      case 'deleteItem':
        result = await deleteItem(event.params.item_id, event.params.user_id);
        break;
      case 'markConsumed':
        result = await markConsumed(event.params.item_id, event.params.user_id);
        break;
      case 'markWasted':
        result = await markWasted(event.params.item_id, event.params.user_id);
        break;
      case 'getExpiringItems':
        result = await getExpiringItems(event.params.user_id, event.params.within_days ?? 3);
        break;
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    // Don't echo raw DB/internal error text back to the caller.
    console.error('pantry handler error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal server error' }) };
  }
};
