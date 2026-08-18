'use client';

import { useState } from 'react';
import styles from './PantryList.module.css';

interface RecipeSummary {
  id: string;
  title: string;
  ingredients: { name: string; quantity?: number | null; unit?: string | null }[];
}

interface Deduction {
  item_id: string;
  item_name: string;
  unit: string | null;
  available: number;
  deduct: number;
  remaining: number;
  consumed: boolean;
  shortfall: number | null;
  needed: number;
}

interface Unresolved {
  ingredient: string;
  quantity: number | null;
  unit: string | null;
  reason: string;
  detail: string;
}

interface CookPlan {
  recipe_id: string;
  title: string;
  deductions: Deduction[];
  unresolved: Unresolved[];
}

interface Props {
  onCooked: () => void | Promise<void>;
}

function fmt(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/**
 * Pick a recipe, see exactly what cooking it takes out of the pantry, then
 * apply it.
 *
 * The preview is not decoration. Matching a recipe ingredient to a pantry item
 * is a heuristic, so the user gets to see and correct every subtraction before
 * anything is written — choosing a recipe on its own never mutates the pantry.
 */
export function CookPanel({ onCooked }: Props) {
  const [open, setOpen] = useState(false);
  const [recipes, setRecipes] = useState<RecipeSummary[] | null>(null);
  const [plan, setPlan] = useState<CookPlan | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setOpen(false);
    setPlan(null);
    setEdits({});
    setError(null);
  }

  async function openPicker() {
    setOpen(true);
    setError(null);
    if (recipes) return;
    setBusy(true);
    try {
      const res = await fetch('/api/recipes');
      if (!res.ok) throw new Error('Could not load recipes');
      setRecipes(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load recipes');
    } finally {
      setBusy(false);
    }
  }

  async function preview(recipeId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_id: recipeId }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      const next: CookPlan = await res.json();
      setPlan(next);
      setEdits(Object.fromEntries(next.deductions.map((d) => [d.item_id, String(d.deduct)])));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan || busy) return;
    const deductions = plan.deductions
      .map((d) => ({ item_id: d.item_id, deduct: Number(edits[d.item_id] ?? d.deduct) }))
      .filter((d) => Number.isFinite(d.deduct) && d.deduct > 0);

    if (deductions.length === 0) {
      setError('Nothing to deduct.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipe_id: plan.recipe_id, confirm: true, deductions }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null);
        throw new Error(detail?.error ?? `Request failed (${res.status})`);
      }
      await onCooked();
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.addRow} onClick={openPicker}>
        Cook a recipe
      </button>
    );
  }

  return (
    <div className={styles.addForm}>
      {!plan && (
        <>
          <p className={styles.fieldLabel}>Choose a recipe</p>
          {busy && <p className={styles.muted}>Loading&hellip;</p>}
          {error && <p className={styles.fieldError}>{error}</p>}
          {recipes?.length === 0 && <p className={styles.muted}>No recipes yet.</p>}
          <ul className={styles.recipeList}>
            {recipes?.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className={styles.recipeItem}
                  onClick={() => preview(r.id)}
                  disabled={busy}
                >
                  <span className={styles.recipeTitle}>{r.title}</span>
                  <span className={styles.recipeMeta}>{r.ingredients.length} ingredients</span>
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <button type="button" className={styles.btnGhost} onClick={reset}>
              Cancel
            </button>
          </div>
        </>
      )}

      {plan && (
        <>
          <p className={styles.fieldLabel}>{plan.title} &mdash; deduct from pantry</p>

          {plan.deductions.length === 0 && (
            <p className={styles.muted}>Nothing here matches your pantry.</p>
          )}

          <ul className={styles.planList}>
            {plan.deductions.map((d) => (
              <li key={d.item_id} className={styles.planRow}>
                <span className={styles.planName}>{d.item_name}</span>
                <input
                  className={styles.planInput}
                  type="number"
                  min="0"
                  step="0.01"
                  value={edits[d.item_id] ?? ''}
                  onChange={(e) => setEdits((prev) => ({ ...prev, [d.item_id]: e.target.value }))}
                  disabled={busy}
                  aria-label={`Amount of ${d.item_name} to deduct`}
                />
                <span className={styles.planUnit}>{d.unit ?? ''}</span>
                <span className={styles.planDelta}>
                  {fmt(d.available)} &rarr; {fmt(d.remaining)}
                </span>
                {d.consumed && <span className={styles.planTag}>empties</span>}
                {d.shortfall != null && (
                  <span className={styles.planShort}>
                    short {fmt(d.shortfall)} {d.unit ?? ''}
                  </span>
                )}
              </li>
            ))}
          </ul>

          {plan.unresolved.length > 0 && (
            <ul className={styles.planList}>
              {plan.unresolved.map((u, i) => (
                <li key={`${u.ingredient}-${i}`} className={styles.planWarn}>
                  <span className={styles.planName}>{u.ingredient}</span>
                  <span className={styles.planWarnText}>{u.detail}</span>
                </li>
              ))}
            </ul>
          )}

          {error && <p className={styles.fieldError}>{error}</p>}

          <div className={styles.actions}>
            <button
              type="button"
              className={styles.btnPrimary}
              onClick={apply}
              disabled={busy || plan.deductions.length === 0}
            >
              {busy ? 'Updating…' : 'I cooked this'}
            </button>
            <button type="button" className={styles.btnGhost} onClick={() => setPlan(null)} disabled={busy}>
              Back
            </button>
            <button type="button" className={styles.btnGhost} onClick={reset} disabled={busy}>
              Cancel
            </button>
          </div>
        </>
      )}
    </div>
  );
}
