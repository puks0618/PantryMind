import { normaliseUnit } from './pantry';

/**
 * Works out what cooking a recipe should take out of the pantry.
 *
 * Two things make this harder than "subtract the number":
 *
 *  1. Recipe amounts and pantry amounts are in different units. Converting
 *     inside a dimension (oz→lb, cup→gallon) is exact arithmetic. Converting
 *     *across* one — cups of flour out of a "bag", count of bananas out of a
 *     "bunch" — has no honest answer, so this never guesses. It reports the
 *     ingredient as unresolved and lets the user decide.
 *  2. Ingredient names are free text from a recipe API and pantry names are
 *     free text from a user. Matching is deliberately conservative: exact,
 *     then singular/plural, then whole-token containment. Never substring —
 *     "corn" must not match "cornstarch".
 *
 * Pure functions, no DB access: the route does the reading and writing, this
 * decides what should happen.
 */

type Dimension = 'mass' | 'volume' | 'count';

/** Base units: grams for mass, millilitres for volume, items for count. */
const UNIT_TABLE: Record<string, { dim: Dimension; factor: number }> = {
  g: { dim: 'mass', factor: 1 },
  kg: { dim: 'mass', factor: 1000 },
  oz: { dim: 'mass', factor: 28.349523125 },
  lb: { dim: 'mass', factor: 453.59237 },

  ml: { dim: 'volume', factor: 1 },
  l: { dim: 'volume', factor: 1000 },
  tsp: { dim: 'volume', factor: 4.92892159375 },
  tbsp: { dim: 'volume', factor: 14.78676478125 },
  floz: { dim: 'volume', factor: 29.5735295625 },
  cup: { dim: 'volume', factor: 236.5882365 },
  pint: { dim: 'volume', factor: 473.176473 },
  quart: { dim: 'volume', factor: 946.352946 },
  gallon: { dim: 'volume', factor: 3785.411784 },

  count: { dim: 'count', factor: 1 },
};

/**
 * Container units — "1 bag", "1 loaf", "1 can". These are real units to a
 * user but carry no fixed magnitude, so they only ever match themselves.
 * Listed for the error message, not for arithmetic.
 */
const OPAQUE_UNITS = new Set([
  'bag', 'box', 'can', 'jar', 'bottle', 'pack', 'loaf', 'block', 'bulb',
  'bunch', 'tub', 'stick pack', 'stick', 'head', 'clove', 'slice', 'sprig',
]);

/** A missing unit is treated as a plain count — "2 bananas" against an item
 *  recorded with no unit is the common case and means what you'd expect. */
function unitKey(unit: string | null | undefined): string {
  const normalised = normaliseUnit(unit ?? null);
  return normalised ?? 'count';
}

export function unitDimension(unit: string | null | undefined): Dimension | null {
  return UNIT_TABLE[unitKey(unit)]?.dim ?? null;
}

/** Rounds off float noise from unit conversion (0.30000000000000004 → 0.3). */
export function roundQuantity(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

/**
 * Converts `quantity` from one unit to another. Returns null when there is no
 * honest conversion — different dimensions, or an opaque container unit that
 * isn't an exact match.
 */
export function convertQuantity(
  quantity: number,
  from: string | null | undefined,
  to: string | null | undefined
): number | null {
  const f = unitKey(from);
  const t = unitKey(to);
  if (f === t) return quantity;

  const uf = UNIT_TABLE[f];
  const ut = UNIT_TABLE[t];
  if (!uf || !ut || uf.dim !== ut.dim) return null;

  return roundQuantity((quantity * uf.factor) / ut.factor);
}

// ---------------------------------------------------------------------------
// Name matching
// ---------------------------------------------------------------------------

const NOISE_WORDS = new Set([
  'fresh', 'frozen', 'dried', 'chopped', 'sliced', 'diced', 'minced', 'ground',
  'large', 'medium', 'small', 'ripe', 'raw', 'cooked', 'whole', 'boneless',
  'skinless', 'unsalted', 'salted', 'extra', 'virgin', 'plain', 'of',
]);

function singularise(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  // "tomatoes" -> "tomato", "potatoes" -> "potato". Must run before the bare
  // -s rule, which would otherwise leave "tomatoe".
  if (word.length > 4 && word.endsWith('oes')) return word.slice(0, -2);
  if (word.length > 3 && /(s|x|z|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

/** Lowercase, strip punctuation and recipe filler, singularise each word. */
export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE_WORDS.has(w))
    .map(singularise);
}

/**
 * The shorter name must be a contiguous prefix or suffix of the longer one:
 * "chicken" matches "chicken thighs", "yogurt" matches "greek yogurt".
 *
 * Two things this deliberately rejects, both of which would deduct from the
 * wrong pantry item:
 *  - loose set containment — "milk" appears inside "coconut milk powder" but
 *    is a different product, and it is neither a prefix nor a suffix.
 *  - substring matching — "corn" would otherwise match "cornstarch".
 */
export function namesMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const offset = long.length - short.length;
  const isPrefix = short.every((t, i) => long[i] === t);
  const isSuffix = short.every((t, i) => long[offset + i] === t);
  return isPrefix || isSuffix;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

export interface RecipeIngredient {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  /** Legacy free-text amount from the original contract. Display only. */
  amount?: string;
}

export interface PantryCandidate {
  id: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  expires_at: string | null;
  status: string;
}

export interface Deduction {
  item_id: string;
  item_name: string;
  unit: string | null;
  /** Quantity on hand before cooking. */
  available: number;
  /** How much to take, already clamped to what's actually there. */
  deduct: number;
  /** Quantity remaining afterwards. */
  remaining: number;
  /** True when this empties the item, which also flips it to 'consumed'. */
  consumed: boolean;
  /** How much the recipe wanted beyond what's on hand, in the item's unit. */
  shortfall: number | null;
  /** What the recipe asked for, for display. */
  needed: number;
}

export type UnresolvedReason =
  | 'not-in-pantry'
  | 'incompatible-units'
  | 'unknown-recipe-amount'
  | 'unknown-pantry-quantity';

export interface Unresolved {
  ingredient: string;
  quantity: number | null;
  unit: string | null;
  reason: UnresolvedReason;
  detail: string;
  /** Set when a pantry item matched by name but the amounts couldn't be reconciled. */
  item_id?: string;
}

export interface CookPlan {
  deductions: Deduction[];
  unresolved: Unresolved[];
}

/**
 * Picks the pantry item to spend on an ingredient.
 *
 * Among equally-good name matches it takes the one expiring soonest — the same
 * urgency ordering the rest of the app runs on, so cooking burns down the
 * items most at risk of being wasted.
 */
function pickItem(
  ingredientName: string,
  pantry: PantryCandidate[],
  claimed: Set<string>
): PantryCandidate | null {
  const candidates = pantry.filter(
    (item) => item.status === 'active' && !claimed.has(item.id) && namesMatch(ingredientName, item.name)
  );
  if (candidates.length === 0) return null;

  return [...candidates].sort((a, b) => {
    if (a.expires_at && b.expires_at) return a.expires_at.localeCompare(b.expires_at);
    if (a.expires_at) return -1;
    if (b.expires_at) return 1;
    return 0;
  })[0];
}

export function planCook(ingredients: RecipeIngredient[], pantry: PantryCandidate[]): CookPlan {
  const deductions: Deduction[] = [];
  const unresolved: Unresolved[] = [];
  const claimed = new Set<string>();

  for (const ingredient of ingredients) {
    const base = {
      ingredient: ingredient.name,
      quantity: ingredient.quantity ?? null,
      unit: ingredient.unit ?? null,
    };

    const item = pickItem(ingredient.name, pantry, claimed);
    if (!item) {
      unresolved.push({ ...base, reason: 'not-in-pantry', detail: 'Not in your pantry.' });
      continue;
    }

    if (ingredient.quantity == null) {
      unresolved.push({
        ...base,
        item_id: item.id,
        reason: 'unknown-recipe-amount',
        detail: `Recipe doesn't say how much ${ingredient.name} to use.`,
      });
      continue;
    }

    if (item.quantity == null) {
      unresolved.push({
        ...base,
        item_id: item.id,
        reason: 'unknown-pantry-quantity',
        detail: `No quantity recorded for ${item.name}.`,
      });
      continue;
    }

    const needed = convertQuantity(ingredient.quantity, ingredient.unit, item.unit);
    if (needed === null) {
      const from = unitKey(ingredient.unit);
      const to = unitKey(item.unit);
      const opaque = OPAQUE_UNITS.has(from) || OPAQUE_UNITS.has(to);
      unresolved.push({
        ...base,
        item_id: item.id,
        reason: 'incompatible-units',
        detail: opaque
          ? `Can't work out ${from} from a ${to} — no fixed size.`
          : `Can't convert ${from} to ${to}.`,
      });
      continue;
    }

    claimed.add(item.id);
    const available = item.quantity;
    const deduct = roundQuantity(Math.min(needed, available));
    const remaining = roundQuantity(available - deduct);
    const shortfall = needed > available ? roundQuantity(needed - available) : null;

    deductions.push({
      item_id: item.id,
      item_name: item.name,
      unit: item.unit,
      available,
      deduct,
      remaining,
      // Floating point: treat anything under a hair as empty.
      consumed: remaining <= 1e-6,
      shortfall,
      needed: roundQuantity(needed),
    });
  }

  return { deductions, unresolved };
}
