'use client';

// Deep import, not the package barrel: '@pantrymind/shared' re-exports db.ts,
// which pulls `pg` (and with it node's net/tls) into the client bundle and
// fails the build. pantry.ts has no runtime dependencies of its own.
import { PANTRY_CATEGORIES, PANTRY_UNITS, type FieldErrors } from '@pantrymind/shared/src/pantry';
import styles from './PantryList.module.css';

/** Form state is all-strings, the way the inputs hand it over. The route's
 *  parseCreate/parsePatch do the coercion — the browser doesn't need to. */
export interface ItemDraft {
  name: string;
  category: string;
  quantity: string;
  unit: string;
  expires_at: string;
}

export const EMPTY_DRAFT: ItemDraft = {
  name: '',
  category: '',
  quantity: '',
  unit: '',
  expires_at: '',
};

interface Props {
  draft: ItemDraft;
  errors: FieldErrors;
  disabled: boolean;
  /** Distinguishes the datalist/label ids when several field-sets are mounted. */
  idPrefix: string;
  onChange: (patch: Partial<ItemDraft>) => void;
}

/** The five editable fields, shared verbatim by the add form and every row's
 *  edit form so the two cannot drift apart. Presentation only — no fetching. */
export function PantryItemFields({ draft, errors, disabled, idPrefix, onChange }: Props) {
  return (
    <div className={styles.fields}>
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Name</span>
        <input
          className={styles.input}
          value={draft.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="spinach"
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(errors.name)}
        />
        {errors.name && <span className={styles.fieldError}>{errors.name}</span>}
      </label>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Category</span>
        <input
          className={styles.input}
          value={draft.category}
          onChange={(e) => onChange({ category: e.target.value })}
          list={`${idPrefix}-categories`}
          placeholder="produce"
          disabled={disabled}
          autoComplete="off"
          aria-invalid={Boolean(errors.category)}
        />
        <datalist id={`${idPrefix}-categories`}>
          {PANTRY_CATEGORIES.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        {errors.category && <span className={styles.fieldError}>{errors.category}</span>}
      </label>

      <div className={styles.fieldPair}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Quantity</span>
          <input
            className={styles.input}
            type="number"
            min="0"
            step="0.01"
            value={draft.quantity}
            onChange={(e) => onChange({ quantity: e.target.value })}
            placeholder="1"
            disabled={disabled}
            aria-invalid={Boolean(errors.quantity)}
          />
          {errors.quantity && <span className={styles.fieldError}>{errors.quantity}</span>}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Unit</span>
          <input
            className={styles.input}
            value={draft.unit}
            onChange={(e) => onChange({ unit: e.target.value })}
            list={`${idPrefix}-units`}
            placeholder="bag"
            disabled={disabled}
            autoComplete="off"
            aria-invalid={Boolean(errors.unit)}
          />
          <datalist id={`${idPrefix}-units`}>
            {PANTRY_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
          {errors.unit && <span className={styles.fieldError}>{errors.unit}</span>}
        </label>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Expires</span>
        <input
          className={styles.input}
          type="date"
          value={draft.expires_at}
          onChange={(e) => onChange({ expires_at: e.target.value })}
          disabled={disabled}
          aria-invalid={Boolean(errors.expires_at)}
        />
        {errors.expires_at && <span className={styles.fieldError}>{errors.expires_at}</span>}
      </label>
    </div>
  );
}
