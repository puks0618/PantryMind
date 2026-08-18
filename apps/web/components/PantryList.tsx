'use client';

import { useEffect, useState } from 'react';
import styles from './PantryList.module.css';

interface PantryItemRow {
  id: string;
  name: string;
  category: string | null;
  quantity: string | number | null;
  unit: string | null;
  expires_at: string | null;
  status: string;
}

function daysUntil(dateStr: string): number {
  // pg returns CockroachDB's DATE columns as full ISO timestamps
  // ("2026-08-19T00:00:00.000Z"), not plain "YYYY-MM-DD" — parse as-is
  // rather than assuming a shape and concatenating a time suffix onto it.
  const target = new Date(dateStr).getTime();
  const now = new Date();
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((target - todayUtc) / 86_400_000);
}

function urgency(days: number | null): 'crit' | 'warn' | 'ok' {
  if (days === null) return 'ok';
  if (days <= 1) return 'crit';
  if (days <= 3) return 'warn';
  return 'ok';
}

function expiryLabel(days: number): string {
  if (days < 0) return 'expired';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return `${days}d`;
}

export function PantryList() {
  const [items, setItems] = useState<PantryItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/pantry')
      .then((res) => {
        if (!res.ok) throw new Error('Could not load pantry items');
        return res.json();
      })
      .then((data: PantryItemRow[]) => {
        if (!cancelled) setItems(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const active = items.filter((i) => i.status === 'active');
  const sorted = [...active].sort((a, b) => {
    if (!a.expires_at) return 1;
    if (!b.expires_at) return -1;
    return a.expires_at.localeCompare(b.expires_at);
  });

  return (
    <aside className={styles.pane} aria-label="Pantry items">
      <h2 className={styles.heading}>Your pantry</h2>
      {loading && <p className={styles.muted}>Loading&hellip;</p>}
      {error && <p className={styles.errorText}>{error}</p>}
      {!loading && !error && sorted.length === 0 && <p className={styles.muted}>No items yet.</p>}
      <ul className={styles.list}>
        {sorted.map((item) => {
          const days = item.expires_at ? daysUntil(item.expires_at) : null;
          const level = urgency(days);
          return (
            <li key={item.id} className={styles.item} data-urgency={level}>
              <span className={styles.dot} />
              <span className={styles.name}>{item.name}</span>
              {item.quantity != null && (
                <span className={styles.qty}>
                  {item.quantity} {item.unit ?? ''}
                </span>
              )}
              {days !== null && <span className={styles.expiry}>{expiryLabel(days)}</span>}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
