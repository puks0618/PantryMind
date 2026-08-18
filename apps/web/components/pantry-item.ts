import type { PantryItem } from '@pantrymind/shared';

/** What /api/pantry actually returns — the contract type minus the columns the
 *  projection omits. `quantity` is a real number and `expires_at` a bare
 *  YYYY-MM-DD because the route casts both (PANTRY_ITEM_COLUMNS). */
export type PantryRow = Omit<PantryItem, 'user_id' | 'added_at'>;

/** Whole days from today (UTC) to the given YYYY-MM-DD. Negative = already expired. */
export function daysUntil(dateStr: string): number {
  const target = new Date(`${dateStr}T00:00:00Z`).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

export function urgency(days: number | null): 'crit' | 'warn' | 'ok' {
  if (days === null) return 'ok';
  if (days <= 1) return 'crit';
  if (days <= 3) return 'warn';
  return 'ok';
}

export function expiryLabel(days: number): string {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}
