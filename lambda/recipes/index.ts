import { pool } from './db';

// Mirrors packages/shared/src/types.ts — see lambda/recipes/db.ts for why this is local.
interface Recipe {
  id: string;
  external_id: string | null;
  title: string;
  ingredients: { name: string; amount?: string }[];
  instructions: string | null;
  source_url: string | null;
}

const SPOONACULAR_KEY = process.env.SPOONACULAR_API_KEY;
const SPOONACULAR_URL = 'https://api.spoonacular.com/recipes/findByIngredients';

interface FindRecipesInput {
  ingredients: string[];  // pantry item names available to cook with
  near_expiry: string[];  // subset of ingredients that are near-expiry, used for ranking
  /**
   * Disliked ingredients from recalled memory. The agent passes this through from
   * what it recalled about the user — this is how memory visibly changes output.
   */
  exclude?: string[];
}

export async function findRecipes(input: FindRecipesInput): Promise<Recipe[]> {
  const exclude = (input.exclude ?? []).map((s) => s.toLowerCase());

  const candidates = (await fetchCandidates(input.ingredients)).filter(
    (r) => !r.ingredients.some((i) => exclude.includes(i.name.toLowerCase()))
  );

  return candidates
    .map((recipe) => ({
      recipe,
      score: recipe.ingredients.filter((i) =>
        input.near_expiry.some((n) => n.toLowerCase() === i.name.toLowerCase())
      ).length,
    }))
    .sort((a, b) => b.score - a.score)
    .map((s) => s.recipe);
}

async function fetchCandidates(ingredients: string[]): Promise<Recipe[]> {
  if (!SPOONACULAR_KEY) {
    return cachedRecipes();
  }

  const url = `${SPOONACULAR_URL}?ingredients=${encodeURIComponent(ingredients.join(','))}&number=10&apiKey=${SPOONACULAR_KEY}`;
  const res = await fetch(url);
  if (!res.ok) {
    return cachedRecipes();
  }

  const data: any[] = await res.json();
  const mapped: Recipe[] = data.map((d) => ({
    id: '',
    external_id: String(d.id),
    title: d.title,
    ingredients: [
      ...(d.usedIngredients ?? []).map((i: any) => ({ name: i.name })),
      ...(d.missedIngredients ?? []).map((i: any) => ({ name: i.name })),
    ],
    instructions: null,
    source_url: `https://spoonacular.com/recipes/${slugify(d.title)}-${d.id}`,
  }));

  await cacheRecipes(mapped);
  return mapped;
}

async function cachedRecipes(): Promise<Recipe[]> {
  const { rows } = await pool.query(
    `SELECT id, external_id, title, ingredients, instructions, source_url
     FROM recipes ORDER BY cached_at DESC LIMIT 20`
  );
  return rows;
}

/** No unique constraint on external_id in schema.sql — dedupe here instead of ON CONFLICT. */
async function cacheRecipes(recipes: Recipe[]): Promise<void> {
  for (const r of recipes) {
    const { rows: existing } = await pool.query(`SELECT id FROM recipes WHERE external_id = $1 LIMIT 1`, [r.external_id]);
    if (existing.length > 0) continue;
    await pool.query(
      `INSERT INTO recipes (external_id, title, ingredients, instructions, source_url)
       VALUES ($1, $2, $3, $4, $5)`,
      [r.external_id, r.title, JSON.stringify(r.ingredients), r.instructions, r.source_url]
    );
  }
}

function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

export const handler = async (event: FindRecipesInput) => {
  try {
    const recipes = await findRecipes(event);
    return { statusCode: 200, body: JSON.stringify(recipes) };
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: (err as Error).message }) };
  }
};
