import type { ItemStatus } from './types';

/**
 * Validation + normalisation for pantry writes. The schema has no CHECK
 * constraints (see scripts/schema.sql) — `status`, `unit` and `quantity` are
 * bare STRING/DECIMAL columns — so this module is the only thing standing
 * between a request body and the table.
 *
 * Deliberately forgiving on vocabulary, strict on shape: an unrecognised unit
 * or category is normalised and accepted, but a malformed date or a negative
 * quantity is rejected with a field-level message.
 */

/** Suggestions for the UI's <datalist>. Not enforced — see `normaliseCategory`. */
export const PANTRY_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'seafood',
  'bakery',
  'frozen',
  'pantry',
  'beverage',
  'other',
] as const;

/** Suggestions for the UI's <datalist>. Not enforced — see `normaliseUnit`. */
export const PANTRY_UNITS = [
  'count',
  'g',
  'kg',
  'oz',
  'lb',
  'ml',
  'l',
  'cup',
  'tbsp',
  'tsp',
  'can',
  'box',
  'bag',
  'bottle',
  'jar',
  'loaf',
  'block',
  'bunch',
  'pack',
] as const;

export const ITEM_STATUSES: readonly ItemStatus[] = ['active', 'consumed', 'wasted'];

const NAME_MAX = 80;
const CATEGORY_MAX = 32;
const UNIT_MAX = 24;
const QUANTITY_MAX = 100_000;
/** A pantry item 50 years out is a typo, not a tin of beans. */
const EXPIRY_MAX_YEARS_AHEAD = 50;

/** Free-text units collapse to one spelling so the shopping-list diff can match them. */
const UNIT_ALIASES: Record<string, string> = {
  lbs: 'lb',
  pound: 'lb',
  pounds: 'lb',
  ounce: 'oz',
  ounces: 'oz',
  gram: 'g',
  grams: 'g',
  kilogram: 'kg',
  kilograms: 'kg',
  kgs: 'kg',
  litre: 'l',
  litres: 'l',
  liter: 'l',
  liters: 'l',
  millilitre: 'ml',
  millilitres: 'ml',
  milliliter: 'ml',
  milliliters: 'ml',
  ea: 'count',
  each: 'count',
  pc: 'count',
  pcs: 'count',
  piece: 'count',
  pieces: 'count',
  cups: 'cup',
  cans: 'can',
  boxes: 'box',
  bags: 'bag',
  bottles: 'bottle',
  jars: 'jar',
  packs: 'pack',
  // Volume spellings, needed so recipe amounts line up with pantry units.
  tsps: 'tsp',
  teaspoon: 'tsp',
  teaspoons: 'tsp',
  tbsps: 'tbsp',
  tbs: 'tbsp',
  tablespoon: 'tbsp',
  tablespoons: 'tbsp',
  'fl oz': 'floz',
  'fluid ounce': 'floz',
  'fluid ounces': 'floz',
  gal: 'gallon',
  gallons: 'gallon',
  qt: 'quart',
  quarts: 'quart',
  pt: 'pint',
  pints: 'pint',
  sticks: 'stick',
};

/**
 * Canonical spelling for a unit: trimmed, lowercased, alias-resolved.
 * Exported because cook.ts converts between units and has to agree with the
 * parser on what "lbs" and "tablespoons" are called.
 */
export function normaliseUnit(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const unit = String(raw).trim().toLowerCase();
  if (unit.length === 0) return null;
  return UNIT_ALIASES[unit] ?? unit;
}

export interface CreateFields {
  name: string;
  category: string | null;
  quantity: number | null;
  unit: string | null;
  expires_at: string | null;
}

export interface PatchFields extends CreateFields {
  status: ItemStatus;
}

/** Columns a PATCH may touch, in a fixed order. The SET clause is built from
 *  this allowlist rather than from request keys — that is what keeps it
 *  injection-free. */
export const PATCHABLE_COLUMNS: readonly (keyof PatchFields)[] = [
  'name',
  'category',
  'quantity',
  'unit',
  'expires_at',
  'status',
];

export type FieldErrors = Record<string, string>;
export type Parsed<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

/**
 * The SELECT/RETURNING projection every pantry response shares. Two casts matter:
 *
 *  - `to_char(expires_at, ...)` — pg hands back a DATE column as a JS Date,
 *    which serialises to "2026-08-19T00:00:00.000Z". The edit form's
 *    <input type="date"> needs a bare YYYY-MM-DD, which is also what
 *    PantryItem.expires_at has always claimed to be.
 *  - `quantity::float8` — pg returns DECIMAL as a *string*, while
 *    PantryItem.quantity is typed `number | null`. The cast makes the type
 *    honest without touching the frozen contract in types.ts.
 */
export const PANTRY_ITEM_COLUMNS = `id, name, category, quantity::float8 AS quantity, unit,
   to_char(expires_at, 'YYYY-MM-DD') AS expires_at, status`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function has(body: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/** `''` from a cleared form field means "no value", same as an explicit null. */
function blankToNull(value: unknown): unknown {
  return typeof value === 'string' && value.trim() === '' ? null : value;
}

// ---------------------------------------------------------------------------
// Field parsers. Each returns the normalised value, or throws a message string
// that the caller attaches to the field.
// ---------------------------------------------------------------------------

function parseName(raw: unknown): string {
  if (typeof raw !== 'string') throw 'Name is required.';
  const name = raw.trim().toLowerCase();
  if (name.length === 0) throw 'Name is required.';
  if (name.length > NAME_MAX) throw `Name must be ${NAME_MAX} characters or fewer.`;
  return name;
}

function parseCategory(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw 'Category must be text.';
  const category = raw.trim().toLowerCase();
  if (category.length === 0) return null;
  if (category.length > CATEGORY_MAX) throw `Category must be ${CATEGORY_MAX} characters or fewer.`;
  return category;
}

function parseQuantity(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  // <input type="number"> hands back a string, and the Bedrock adapter sends
  // everything as strings too — coerce rather than reject.
  const quantity = typeof raw === 'string' ? Number(raw) : raw;
  if (typeof quantity !== 'number' || !Number.isFinite(quantity)) throw 'Quantity must be a number.';
  if (quantity < 0) throw 'Quantity cannot be negative.';
  if (quantity > QUANTITY_MAX) throw `Quantity must be ${QUANTITY_MAX.toLocaleString()} or less.`;
  return quantity;
}

function parseUnit(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw 'Unit must be text.';
  if (raw.trim().length > UNIT_MAX) throw `Unit must be ${UNIT_MAX} characters or fewer.`;
  return normaliseUnit(raw);
}

function parseExpiresAt(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') throw 'Expiry must be a date.';
  const value = raw.trim();
  if (value.length === 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw 'Expiry must be a date (YYYY-MM-DD).';

  // The regex accepts 2026-02-31; round-tripping through Date does not.
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw 'That date does not exist.';
  }
  if (parsed.getUTCFullYear() > new Date().getUTCFullYear() + EXPIRY_MAX_YEARS_AHEAD) {
    throw 'Expiry is too far in the future.';
  }
  // No lower bound: adding an already-expired item in order to mark it wasted
  // is a legitimate flow.
  return value;
}

function parseStatus(raw: unknown): ItemStatus {
  if (typeof raw !== 'string' || !ITEM_STATUSES.includes(raw as ItemStatus)) {
    throw `Status must be one of: ${ITEM_STATUSES.join(', ')}.`;
  }
  return raw as ItemStatus;
}

const PARSERS: Record<keyof PatchFields, (raw: unknown) => unknown> = {
  name: parseName,
  category: parseCategory,
  quantity: parseQuantity,
  unit: parseUnit,
  expires_at: parseExpiresAt,
  status: parseStatus,
};

function runParser(field: keyof PatchFields, raw: unknown, errors: FieldErrors): unknown {
  try {
    return PARSERS[field](raw);
  } catch (message) {
    errors[field] = typeof message === 'string' ? message : 'Invalid value.';
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Every field is considered; only `name` is required. `status` is not settable
 *  at creation — the column defaults to 'active'. */
export function parseCreate(body: unknown): Parsed<CreateFields> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: { _: 'Expected a JSON object.' } };
  }

  const errors: FieldErrors = {};
  const value = {
    name: runParser('name', body.name, errors),
    category: runParser('category', blankToNull(body.category), errors),
    quantity: runParser('quantity', blankToNull(body.quantity), errors),
    unit: runParser('unit', blankToNull(body.unit), errors),
    expires_at: runParser('expires_at', blankToNull(body.expires_at), errors),
  } as CreateFields;

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}

/**
 * Partial update. A key that is *absent* leaves its column alone; a key that is
 * *present and null* clears it. That distinction is why this reads keys via
 * hasOwnProperty rather than testing truthiness — otherwise clearing an expiry
 * date would be impossible.
 *
 * An empty patch is valid here and rejected by the route, so the caller can
 * distinguish "nothing to do" from "bad input".
 */
export function parsePatch(body: unknown): Parsed<Partial<PatchFields>> {
  if (!isPlainObject(body)) {
    return { ok: false, errors: { _: 'Expected a JSON object.' } };
  }

  const errors: FieldErrors = {};
  const value: Partial<PatchFields> = {};

  for (const field of PATCHABLE_COLUMNS) {
    if (!has(body, field)) continue;
    // `name` and `status` are NOT NULL columns — a null here is a clear error,
    // not a request to blank them out.
    const raw = field === 'name' || field === 'status' ? body[field] : blankToNull(body[field]);
    const parsed = runParser(field, raw, errors);
    if (!(field in errors)) {
      (value as Record<string, unknown>)[field] = parsed;
    }
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, value };
}
