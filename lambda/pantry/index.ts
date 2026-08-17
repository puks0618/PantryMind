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

export async function markConsumed(item_id: string): Promise<PantryItem> {
  return setStatus(item_id, 'consumed');
}

export async function markWasted(item_id: string): Promise<PantryItem> {
  return setStatus(item_id, 'wasted');
}

async function setStatus(item_id: string, status: ItemStatus): Promise<PantryItem> {
  const { rows } = await pool.query(
    `UPDATE pantry_items SET status = $2 WHERE id = $1
     RETURNING id, user_id, name, category, quantity, unit, added_at, expires_at, status`,
    [item_id, status]
  );
  return rows[0];
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

type Action = 'addItem' | 'listItems' | 'markConsumed' | 'markWasted' | 'getExpiringItems';

export const handler = async (event: { action: Action; params: any }) => {
  try {
    let result: unknown;
    switch (event.action) {
      case 'addItem':
        result = await addItem(event.params);
        break;
      case 'listItems':
        result = await listItems(event.params.user_id);
        break;
      case 'markConsumed':
        result = await markConsumed(event.params.item_id);
        break;
      case 'markWasted':
        result = await markWasted(event.params.item_id);
        break;
      case 'getExpiringItems':
        result = await getExpiringItems(event.params.user_id, event.params.within_days ?? 3);
        break;
      default:
        throw new Error(`Unknown action: ${event.action}`);
    }
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: (err as Error).message }) };
  }
};
