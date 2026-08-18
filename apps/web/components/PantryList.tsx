'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { FieldErrors } from '@pantrymind/shared';
import { PantryItemFields, EMPTY_DRAFT, type ItemDraft } from './PantryItemFields';
import { PantryItemRow } from './PantryItemRow';
import type { PantryRow } from './pantry-item';
import styles from './PantryList.module.css';

/** Blank strings mean "not set" — send null so the column stays empty. */
function draftToBody(draft: ItemDraft): Record<string, string | null> {
  return {
    name: draft.name,
    category: draft.category || null,
    quantity: draft.quantity || null,
    unit: draft.unit || null,
    expires_at: draft.expires_at || null,
  };
}

export function PantryList() {
  const [items, setItems] = useState<PantryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>(EMPTY_DRAFT);
  const [addErrors, setAddErrors] = useState<FieldErrors>({});
  const [addError, setAddError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [showInactive, setShowInactive] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/pantry');
      if (!res.ok) throw new Error('Could not load pantry items');
      setItems((await res.json()) as PantryRow[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Chat mutations (addItem/updateItem/markConsumed/markWasted, all via
  // Lambda tool calls) land in the same pantry_items table this panel reads,
  // but nothing pushes a signal back to this component when that happens —
  // poll instead of wiring cross-component state for what's a once-per-demo
  // convenience.
  useEffect(() => {
    const interval = setInterval(() => void refresh(), 5000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (saving || !draft.name.trim()) return;

    setSaving(true);
    setAddError(null);
    setAddErrors({});
    try {
      const res = await fetch('/api/pantry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draftToBody(draft)),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        if (detail?.errors) {
          setAddErrors(detail.errors);
          return;
        }
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      setDraft(EMPTY_DRAFT);
      setAdding(false);
      await refresh();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setSaving(false);
    }
  }

  const visible = items.filter((i) => (showInactive ? true : i.status === 'active'));
  const sorted = [...visible].sort((a, b) => {
    if (!a.expires_at) return 1;
    if (!b.expires_at) return -1;
    return a.expires_at.localeCompare(b.expires_at);
  });
  const inactiveCount = items.length - items.filter((i) => i.status === 'active').length;

  return (
    <aside className={styles.pane} aria-label="Pantry items">
      <div className={styles.headingRow}>
        <h2 className={styles.heading}>Your pantry</h2>
        {inactiveCount > 0 && (
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show used/wasted ({inactiveCount})
          </label>
        )}
      </div>

      {adding ? (
        <form className={styles.addForm} onSubmit={handleAdd}>
          <PantryItemFields
            draft={draft}
            errors={addErrors}
            disabled={saving}
            idPrefix="add"
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          />
          {addError && <p className={styles.fieldError}>{addError}</p>}
          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.btnPrimary}
              disabled={saving || !draft.name.trim()}
            >
              {saving ? 'Adding…' : 'Add item'}
            </button>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => {
                setAdding(false);
                setDraft(EMPTY_DRAFT);
                setAddErrors({});
                setAddError(null);
              }}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className={styles.addRow} onClick={() => setAdding(true)}>
          + Add item
        </button>
      )}

      {loading && <p className={styles.muted}>Loading&hellip;</p>}
      {error && <p className={styles.errorText}>{error}</p>}
      {!loading && !error && sorted.length === 0 && <p className={styles.muted}>No items yet.</p>}

      <ul className={styles.list}>
        {sorted.map((item) => (
          <PantryItemRow key={item.id} item={item} onChanged={refresh} />
        ))}
      </ul>
    </aside>
  );
}
