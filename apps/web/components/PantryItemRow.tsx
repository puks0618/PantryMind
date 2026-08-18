'use client';

import { useState, type FormEvent } from 'react';
import type { FieldErrors, ItemStatus } from '@pantrymind/shared';
import { PantryItemFields, type ItemDraft } from './PantryItemFields';
import { daysUntil, expiryLabel, urgency, type PantryRow } from './pantry-item';
import styles from './PantryList.module.css';

interface Props {
  item: PantryRow;
  onChanged: () => void | Promise<void>;
}

function toDraft(item: PantryRow): ItemDraft {
  return {
    name: item.name,
    category: item.category ?? '',
    quantity: item.quantity == null ? '' : String(item.quantity),
    unit: item.unit ?? '',
    expires_at: item.expires_at ?? '',
  };
}

/** Only the fields the user actually touched. An untouched field is left out of
 *  the PATCH entirely, which is what tells the route to leave its column alone;
 *  a field cleared to '' is sent as null, which clears it. */
function changedFields(draft: ItemDraft, item: PantryRow): Record<string, string | null> {
  const original = toDraft(item);
  const patch: Record<string, string | null> = {};
  for (const key of Object.keys(draft) as (keyof ItemDraft)[]) {
    if (draft[key] === original[key]) continue;
    patch[key] = key === 'name' ? draft[key] : draft[key] === '' ? null : draft[key];
  }
  return patch;
}

/**
 * One pantry row: a collapsed summary that expands into an edit form.
 *
 * Owns its own saving/error state so a failed save on one row doesn't blank the
 * whole list; on success it calls onChanged() and the parent refetches.
 */
export function PantryItemRow({ item, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ItemDraft>(() => toDraft(item));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  const days = item.expires_at ? daysUntil(item.expires_at) : null;
  const level = urgency(days);

  function toggle() {
    // Re-seed from the item on open so a cancelled edit doesn't linger.
    if (!open) {
      setDraft(toDraft(item));
      setErrors({});
      setError(null);
    }
    setOpen((prev) => !prev);
  }

  async function send(method: 'PATCH' | 'DELETE', body?: unknown): Promise<boolean> {
    setSaving(true);
    setError(null);
    setErrors({});
    try {
      const res = await fetch(`/api/pantry/${item.id}`, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        if (detail?.errors) {
          setErrors(detail.errors);
          return false;
        }
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      await onChanged();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const patch = changedFields(draft, item);
    if (Object.keys(patch).length === 0) {
      setOpen(false);
      return;
    }
    if (await send('PATCH', patch)) setOpen(false);
  }

  async function handleStatus(status: ItemStatus) {
    if (saving) return;
    if (await send('PATCH', { status })) setOpen(false);
  }

  /**
   * Removes the row outright. Two-click confirm rather than window.confirm — a
   * native dialog can't be styled and looks wrong on a screen recording.
   *
   * This is for mistakes. An item the user actually had should be retired with
   * "Used it" / "Wasted it" inside the editor, which keeps the row and with it
   * the waste-pattern signal the memory loop reads.
   */
  async function handleRemove() {
    if (saving) return;
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      return;
    }
    await send('DELETE');
  }

  return (
    <li className={styles.item} data-urgency={level} data-status={item.status} data-open={open}>
      {/* Siblings, not nested — a button inside a button is invalid markup and
          the remove control must not also toggle the editor. */}
      <div className={styles.rowHead}>
        <button
          type="button"
          className={styles.summary}
          onClick={toggle}
          aria-expanded={open}
          aria-label={`Edit ${item.name}`}
        >
          <span className={styles.dot} />
          {/* title so a name long enough to be ellipsised is still readable */}
          <span className={styles.name} title={item.name}>
            {item.name}
          </span>
          {item.status !== 'active' && <span className={styles.statusTag}>{item.status}</span>}
          {item.quantity != null && (
            <span className={styles.qty}>
              {item.quantity} {item.unit ?? ''}
            </span>
          )}
          {days !== null && <span className={styles.expiry}>{expiryLabel(days)}</span>}
        </button>

        <button
          type="button"
          className={styles.remove}
          data-confirming={confirmingRemove}
          onClick={handleRemove}
          onBlur={() => setConfirmingRemove(false)}
          disabled={saving}
          title="Remove from list"
          aria-label={
            confirmingRemove ? `Confirm removing ${item.name}` : `Remove ${item.name} from list`
          }
        >
          {confirmingRemove ? 'Remove?' : '×'}
        </button>
      </div>

      {/* Outside the editor: a failed remove happens while the row is collapsed. */}
      {error && <p className={styles.rowError}>{error}</p>}

      {open && (
        <form className={styles.editor} onSubmit={handleSave}>
          <PantryItemFields
            draft={draft}
            errors={errors}
            disabled={saving}
            idPrefix={`item-${item.id}`}
            onChange={(patch) => setDraft((prev) => ({ ...prev, ...patch }))}
          />

          <div className={styles.actions}>
            <button type="submit" className={styles.btnPrimary} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={styles.btnGhost}
              onClick={() => setOpen(false)}
              disabled={saving}
            >
              Cancel
            </button>
          </div>

          <div className={styles.actions}>
            {item.status !== 'consumed' && (
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => handleStatus('consumed')}
                disabled={saving}
              >
                Used it
              </button>
            )}
            {item.status !== 'wasted' && (
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => handleStatus('wasted')}
                disabled={saving}
              >
                Wasted it
              </button>
            )}
            {item.status !== 'active' && (
              <button
                type="button"
                className={styles.btnGhost}
                onClick={() => handleStatus('active')}
                disabled={saving}
              >
                Back to active
              </button>
            )}
          </div>
        </form>
      )}
    </li>
  );
}
