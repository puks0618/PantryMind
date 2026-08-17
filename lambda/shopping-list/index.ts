import { pool } from './db';

interface ShoppingListInput {
  user_id: string;
  recipe_ids: string[];
}

/** Diffs required ingredients across selected recipes against what's currently on hand. */
export async function buildShoppingList(input: ShoppingListInput): Promise<{ name: string }[]> {
  const { rows: recipes } = await pool.query(`SELECT ingredients FROM recipes WHERE id = ANY($1::uuid[])`, [
    input.recipe_ids,
  ]);

  const required = new Set<string>();
  for (const r of recipes) {
    for (const ing of r.ingredients as { name: string }[]) {
      required.add(ing.name.toLowerCase());
    }
  }

  const { rows: pantryRows } = await pool.query(
    `SELECT name FROM pantry_items WHERE user_id = $1 AND status = 'active'`,
    [input.user_id]
  );
  const onHand = new Set(pantryRows.map((r: { name: string }) => r.name.toLowerCase()));

  return [...required].filter((name) => !onHand.has(name)).map((name) => ({ name }));
}

export const handler = async (event: ShoppingListInput) => {
  try {
    const missing = await buildShoppingList(event);
    return { statusCode: 200, body: JSON.stringify(missing) };
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: (err as Error).message }) };
  }
};
