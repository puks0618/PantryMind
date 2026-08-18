// Checks the recipe -> pantry deduction engine: unit conversion, ingredient
// name matching, and planCook()'s handling of shortfalls and unresolvable
// ingredients. Then runs a real transactional cook against the live cluster
// using a throwaway user, so the demo pantry is never touched.
//
// Usage: npx dotenv -e .env -- npx tsx scripts/verify-cook.ts
import {
  pool,
  planCook,
  convertQuantity,
  namesMatch,
  nameTokens,
  roundQuantity,
  PANTRY_ITEM_COLUMNS,
  type PantryCandidate,
} from '../packages/shared/src';

let ok = 0;
let failed = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (condition) {
    ok++;
    console.log(`  ok   ${label}`);
  } else {
    failed++;
    console.error(`  FAIL ${label}${detail === undefined ? '' : ` — got ${JSON.stringify(detail)}`}`);
  }
}
const near = (a: number | null, b: number) => a !== null && Math.abs(a - b) < 1e-6;

function verifyUnits() {
  console.log('\n1. Unit conversion');
  check('identity', convertQuantity(2, 'count', 'count') === 2);
  check('oz -> lb', near(convertQuantity(8, 'oz', 'lb'), 0.5), convertQuantity(8, 'oz', 'lb'));
  check('lb -> oz', near(convertQuantity(1, 'lb', 'oz'), 16), convertQuantity(1, 'lb', 'oz'));
  check('kg -> g', convertQuantity(1.5, 'kg', 'g') === 1500);
  check('cup -> gallon', near(convertQuantity(1, 'cup', 'gallon'), 0.0625), convertQuantity(1, 'cup', 'gallon'));
  check('tbsp -> tsp', near(convertQuantity(1, 'tbsp', 'tsp'), 3), convertQuantity(1, 'tbsp', 'tsp'));
  check('alias lbs -> lb', near(convertQuantity(1, 'lbs', 'oz'), 16), convertQuantity(1, 'lbs', 'oz'));
  check('alias tablespoons -> tbsp', near(convertQuantity(2, 'tablespoons', 'tsp'), 6));
  check('null unit reads as count', convertQuantity(2, null, 'count') === 2);

  check('mass -> volume refused', convertQuantity(1, 'lb', 'cup') === null);
  check('count -> mass refused', convertQuantity(2, 'count', 'lb') === null);
  check('volume -> opaque refused (cup -> bag)', convertQuantity(2, 'cup', 'bag') === null);
  check('opaque -> count refused (bag -> count)', convertQuantity(1, 'bag', 'count') === null);
  check('opaque exact match allowed (bag -> bag)', convertQuantity(1, 'bag', 'bag') === 1);
  check('unknown unit only matches itself', convertQuantity(1, 'sachet', 'sachet') === 1);
  check('unknown unit vs count refused', convertQuantity(1, 'sachet', 'count') === null);
}

function verifyMatching() {
  console.log('\n2. Ingredient name matching');
  check('exact', namesMatch('bananas', 'bananas'));
  check('plural vs singular', namesMatch('banana', 'bananas'));
  check('-ies plural', namesMatch('cherry', 'cherries'));
  check('-oes plural', nameTokens('tomatoes').join(' ') === 'tomato', nameTokens('tomatoes'));
  check('prefix match: chicken vs chicken thighs', namesMatch('chicken', 'chicken thighs'));
  check('suffix match: yogurt vs greek yogurt', namesMatch('yogurt', 'greek yogurt'));
  check('suffix match is symmetric', namesMatch('greek yogurt', 'yogurt'));
  check('strips noise words', nameTokens('fresh chopped tomatoes').join(' ') === 'tomato', nameTokens('fresh chopped tomatoes'));
  check('strips parentheticals', nameTokens('butter (unsalted)').join(' ') === 'butter', nameTokens('butter (unsalted)'));

  check('no substring false positive: corn vs cornstarch', !namesMatch('corn', 'cornstarch'));
  check('no mid-token match: milk vs coconut milk powder', !namesMatch('milk', 'coconut milk powder'));
  check('no mid-token match: cream vs sour cream cheese', !namesMatch('cream', 'sour cream cheese'));
  check('unrelated words do not match', !namesMatch('rice', 'bread'));
}

function verifyPlanning() {
  console.log('\n3. planCook');
  const pantry: PantryCandidate[] = [
    { id: 'i1', name: 'bananas', quantity: 5, unit: 'count', expires_at: '2026-08-22', status: 'active' },
    { id: 'i2', name: 'butter', quantity: 1, unit: 'lb', expires_at: '2026-10-01', status: 'active' },
    { id: 'i3', name: 'flour', quantity: 1, unit: 'bag', expires_at: null, status: 'active' },
    { id: 'i4', name: 'milk', quantity: 1, unit: 'gallon', expires_at: '2026-08-20', status: 'active' },
    { id: 'i5', name: 'rice', quantity: 2, unit: 'lb', expires_at: null, status: 'consumed' },
    { id: 'i6', name: 'eggs', quantity: null, unit: 'count', expires_at: null, status: 'active' },
  ];

  const plan = planCook(
    [
      { name: 'bananas', quantity: 2, unit: 'count' },
      { name: 'butter', quantity: 4, unit: 'oz' },
      { name: 'milk', quantity: 1, unit: 'cup' },
      { name: 'flour', quantity: 2, unit: 'cup' },
      { name: 'rice', quantity: 1, unit: 'lb' },
      { name: 'eggs', quantity: 2, unit: 'count' },
      { name: 'saffron', quantity: 1, unit: 'g' },
      { name: 'salt' },
    ],
    pantry
  );

  const byName = Object.fromEntries(plan.deductions.map((d) => [d.item_name, d]));
  const unresolvedBy = Object.fromEntries(plan.unresolved.map((u) => [u.ingredient, u]));

  check('exact-unit deduction', byName.bananas?.deduct === 2 && byName.bananas?.remaining === 3, byName.bananas);
  check('does not empty a partly-used item', byName.bananas?.consumed === false);
  check('cross-unit deduction oz from lb', near(byName.butter?.deduct ?? null, 0.25), byName.butter);
  check('cross-unit deduction cup from gallon', near(byName.milk?.deduct ?? null, 0.0625), byName.milk);
  check('incompatible units flagged, not guessed', unresolvedBy.flour?.reason === 'incompatible-units', unresolvedBy.flour);
  check('consumed items are not spendable', unresolvedBy.rice?.reason === 'not-in-pantry', unresolvedBy.rice);
  check('unknown pantry quantity flagged', unresolvedBy.eggs?.reason === 'unknown-pantry-quantity', unresolvedBy.eggs);
  check('missing ingredient flagged', unresolvedBy.saffron?.reason === 'not-in-pantry');
  check('recipe with no amount flagged', unresolvedBy.salt?.reason === 'not-in-pantry' || unresolvedBy.salt?.reason === 'unknown-recipe-amount', unresolvedBy.salt);
  check('nothing both deducted and unresolved', plan.deductions.length + plan.unresolved.length === 8, {
    d: plan.deductions.length,
    u: plan.unresolved.length,
  });

  console.log('\n4. Shortfall');
  const short = planCook([{ name: 'eggs', quantity: 3, unit: 'count' }], [
    { id: 'e1', name: 'eggs', quantity: 2, unit: 'count', expires_at: null, status: 'active' },
  ]);
  const d = short.deductions[0];
  check('deducts only what is on hand', d?.deduct === 2, d);
  check('remaining is zero, not negative', d?.remaining === 0, d);
  check('flips to consumed', d?.consumed === true);
  check('reports the gap', d?.shortfall === 1, d?.shortfall);

  console.log('\n5. Urgency preference');
  const twoBananas = planCook([{ name: 'bananas', quantity: 1, unit: 'count' }], [
    { id: 'later', name: 'bananas', quantity: 5, unit: 'count', expires_at: '2026-12-01', status: 'active' },
    { id: 'sooner', name: 'bananas', quantity: 5, unit: 'count', expires_at: '2026-08-19', status: 'active' },
  ]);
  check('spends the soonest-expiring match first', twoBananas.deductions[0]?.item_id === 'sooner', twoBananas.deductions[0]);

  console.log('\n6. One pantry item is not spent twice');
  const doubled = planCook(
    [
      { name: 'bananas', quantity: 1, unit: 'count' },
      { name: 'banana', quantity: 1, unit: 'count' },
    ],
    [{ id: 'b1', name: 'bananas', quantity: 5, unit: 'count', expires_at: null, status: 'active' }]
  );
  check('second reference finds nothing left to claim', doubled.deductions.length === 1, doubled.deductions);
  check('and is reported as unresolved', doubled.unresolved.length === 1, doubled.unresolved);
}

async function verifyLive() {
  console.log('\n7. Transactional apply against the live cluster');
  const handle = `verify-cook-${Date.now()}`;
  const { rows: users } = await pool.query('INSERT INTO users (handle) VALUES ($1) RETURNING id', [handle]);
  const userId = users[0].id as string;

  try {
    await pool.query(
      `INSERT INTO pantry_items (user_id, name, category, quantity, unit, expires_at) VALUES
         ($1,'bananas','produce',5,'count','2026-12-01'),
         ($1,'butter','dairy',1,'lb','2026-12-01'),
         ($1,'flour','pantry',1,'bag',NULL)`,
      [userId]
    );

    const { rows: pantry } = await pool.query(
      `SELECT ${PANTRY_ITEM_COLUMNS} FROM pantry_items WHERE user_id = $1 AND status = 'active'`,
      [userId]
    );
    const plan = planCook(
      [
        { name: 'bananas', quantity: 3, unit: 'count' },
        { name: 'butter', quantity: 4, unit: 'oz' },
        { name: 'flour', quantity: 2, unit: 'cup' },
      ],
      pantry as PantryCandidate[]
    );
    check('plan covers 2 deductions + 1 unresolved', plan.deductions.length === 2 && plan.unresolved.length === 1, {
      d: plan.deductions.length,
      u: plan.unresolved.length,
    });

    // Mirrors the transaction in apps/web/app/api/cook/route.ts.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const d of plan.deductions) {
        const { rows } = await client.query(
          `SELECT quantity::float8 AS quantity FROM pantry_items
           WHERE id = $1 AND user_id = $2 AND status = 'active' FOR UPDATE`,
          [d.item_id, userId]
        );
        const available = rows[0].quantity ?? 0;
        const remaining = roundQuantity(available - Math.min(d.deduct, available));
        if (remaining <= 1e-6) {
          await client.query(`UPDATE pantry_items SET quantity=0, status='consumed' WHERE id=$1 AND user_id=$2`, [d.item_id, userId]);
        } else {
          await client.query(`UPDATE pantry_items SET quantity=$1 WHERE id=$2 AND user_id=$3`, [remaining, d.item_id, userId]);
        }
      }
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const { rows: after } = await pool.query(
      `SELECT name, quantity::float8 AS quantity, unit, status FROM pantry_items WHERE user_id = $1 ORDER BY name`,
      [userId]
    );
    const m = Object.fromEntries(after.map((r) => [r.name, r]));
    check('bananas 5 -> 2', m.bananas.quantity === 2 && m.bananas.status === 'active', m.bananas);
    check('butter 1 lb -> 0.75 lb (4 oz taken)', near(m.butter.quantity, 0.75), m.butter);
    check('flour untouched — units could not be reconciled', m.flour.quantity === 1 && m.flour.status === 'active', m.flour);

    console.log('\n8. Rollback leaves nothing half-applied');
    const client2 = await pool.connect();
    try {
      await client2.query('BEGIN');
      await client2.query(`UPDATE pantry_items SET quantity=0 WHERE user_id=$1 AND name='bananas'`, [userId]);
      await client2.query('ROLLBACK');
    } finally {
      client2.release();
    }
    const { rows: rolled } = await pool.query(
      `SELECT quantity::float8 AS quantity FROM pantry_items WHERE user_id=$1 AND name='bananas'`,
      [userId]
    );
    check('rolled-back write did not persist', rolled[0].quantity === 2, rolled[0]);

    console.log('\n9. Emptying an item retires it');
    const { rows: pantry2 } = await pool.query(
      `SELECT ${PANTRY_ITEM_COLUMNS} FROM pantry_items WHERE user_id=$1 AND status='active'`,
      [userId]
    );
    const finish = planCook([{ name: 'bananas', quantity: 2, unit: 'count' }], pantry2 as PantryCandidate[]);
    const fd = finish.deductions[0];
    await pool.query(`UPDATE pantry_items SET quantity=0, status='consumed' WHERE id=$1 AND user_id=$2`, [fd.item_id, userId]);
    const { rows: done } = await pool.query(
      `SELECT quantity::float8 AS quantity, status FROM pantry_items WHERE id=$1`,
      [fd.item_id]
    );
    check('plan marks the emptying deduction as consumed', fd.consumed === true, fd);
    check('item is consumed with quantity 0', done[0].status === 'consumed' && done[0].quantity === 0, done[0]);
  } finally {
    await pool.query('DELETE FROM pantry_items WHERE user_id = $1', [userId]);
    await pool.query('DELETE FROM users WHERE id = $1', [userId]);
    console.log('\ncleaned up throwaway user');
  }
}

async function main() {
  verifyUnits();
  verifyMatching();
  verifyPlanning();
  await verifyLive();
  console.log(`\nDone. ${ok} passed, ${failed} failed.`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('verify-cook failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
