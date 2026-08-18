// End-to-end check of the pantry CRUD path: the validators in
// packages/shared/src/pantry.ts, then the SQL those validators feed, run
// against the live cluster.
//
// Uses a throwaway user, never the demo user — a pantry that's about to be
// screen-recorded stays untouched. Cleans up after itself even on failure.
//
// Usage: npx dotenv -e .env -- npx tsx scripts/verify-pantry-crud.ts
import {
  pool,
  parseCreate,
  parsePatch,
  isUuid,
  PATCHABLE_COLUMNS,
  PANTRY_ITEM_COLUMNS,
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

/** Mirrors the SET-clause builder in apps/web/app/api/pantry/[id]/route.ts. */
function buildUpdate(patch: Record<string, unknown>, id: string, userId: string) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const column of PATCHABLE_COLUMNS) {
    if (!(column in patch)) continue;
    values.push(patch[column]);
    sets.push(`${column} = $${values.length}`);
  }
  values.push(id, userId);
  return {
    text: `UPDATE pantry_items SET ${sets.join(', ')}
           WHERE id = $${values.length - 1} AND user_id = $${values.length}
           RETURNING ${PANTRY_ITEM_COLUMNS}`,
    values,
    setCount: sets.length,
  };
}

function verifyValidators() {
  console.log('\n1. parseCreate');

  const good = parseCreate({ name: '  Tomatoes ', quantity: '1.5', unit: 'lbs', expires_at: '2026-12-01' });
  check('accepts a well-formed item', good.ok);
  if (good.ok) {
    check('trims + lowercases name', good.value.name === 'tomatoes', good.value.name);
    check('coerces "1.5" to the number 1.5', good.value.quantity === 1.5, good.value.quantity);
    check('normalises unit lbs -> lb', good.value.unit === 'lb', good.value.unit);
  }

  const noName = parseCreate({ quantity: 1 });
  check('rejects a missing name', !noName.ok && 'name' in noName.errors);

  const blankName = parseCreate({ name: '   ' });
  check('rejects a whitespace-only name', !blankName.ok);

  const negative = parseCreate({ name: 'milk', quantity: -1 });
  check('rejects a negative quantity', !negative.ok && 'quantity' in negative.errors);

  const nan = parseCreate({ name: 'milk', quantity: 'abc' });
  check('rejects a non-numeric quantity', !nan.ok && 'quantity' in nan.errors);

  const badDate = parseCreate({ name: 'milk', expires_at: '2026-02-31' });
  check('rejects 2026-02-31 (regex-valid, calendar-invalid)', !badDate.ok && 'expires_at' in badDate.errors);

  const wrongShape = parseCreate({ name: 'milk', expires_at: '01/02/2026' });
  check('rejects a non-ISO date', !wrongShape.ok);

  const pastDate = parseCreate({ name: 'milk', expires_at: '2020-01-01' });
  check('allows a past expiry (needed to log something already spoiled)', pastDate.ok);

  const blanks = parseCreate({ name: 'milk', category: '', unit: '', expires_at: '', quantity: '' });
  check(
    'treats blank form fields as null',
    blanks.ok &&
      blanks.value.category === null &&
      blanks.value.unit === null &&
      blanks.value.expires_at === null &&
      blanks.value.quantity === null
  );

  check('rejects a non-object body', !parseCreate('nope').ok);

  console.log('\n2. parsePatch');

  const absent = parsePatch({ quantity: 3 });
  check('omits keys that were absent', absent.ok && !('expires_at' in absent.value));

  const cleared = parsePatch({ expires_at: null });
  check(
    'keeps a present-but-null key so the column can be cleared',
    cleared.ok && 'expires_at' in cleared.value && cleared.value.expires_at === null
  );

  const clearedByBlank = parsePatch({ unit: '' });
  check('treats a blank string as a clear', clearedByBlank.ok && clearedByBlank.value.unit === null);

  const empty = parsePatch({});
  check('an empty patch is valid but produces no SET clause', empty.ok && Object.keys(empty.value).length === 0);

  const unknown = parsePatch({ nonsense: 1, quantity: 2 });
  check('ignores keys outside the allowlist', unknown.ok && !('nonsense' in unknown.value));

  const badStatus = parsePatch({ status: 'deleted' });
  check('rejects a status outside the enum', !badStatus.ok && 'status' in badStatus.errors);

  const nullName = parsePatch({ name: null });
  check('rejects null for the NOT NULL name column', !nullName.ok);

  console.log('\n3. isUuid');
  check('accepts a real uuid', isUuid('00000000-0000-0000-0000-000000000001'));
  check('rejects a non-uuid', !isUuid('not-a-uuid'));
  check('rejects a non-string', !isUuid(42));
}

async function verifyDatabase() {
  const handle = `verify-crud-${Date.now()}`;
  const { rows: userRows } = await pool.query(
    'INSERT INTO users (handle) VALUES ($1) RETURNING id',
    [handle]
  );
  const userId = userRows[0].id as string;

  const { rows: otherRows } = await pool.query(
    'INSERT INTO users (handle) VALUES ($1) RETURNING id',
    [`${handle}-other`]
  );
  const otherUserId = otherRows[0].id as string;

  try {
    console.log('\n4. Insert + projection');
    const create = parseCreate({
      name: 'Test Spinach',
      category: 'produce',
      quantity: '1.5',
      unit: 'lbs',
      expires_at: '2026-12-01',
    });
    if (!create.ok) throw new Error(`parseCreate rejected the fixture: ${JSON.stringify(create.errors)}`);

    const { name, category, quantity, unit, expires_at } = create.value;
    const { rows: inserted } = await pool.query(
      `INSERT INTO pantry_items (user_id, name, category, quantity, unit, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${PANTRY_ITEM_COLUMNS}`,
      [userId, name, category, quantity, unit, expires_at]
    );
    const item = inserted[0];

    check('row was created', inserted.length === 1);
    check('expires_at comes back as bare YYYY-MM-DD', item.expires_at === '2026-12-01', item.expires_at);
    check('quantity comes back as a JS number', typeof item.quantity === 'number', typeof item.quantity);
    check('quantity value survives the float8 cast', item.quantity === 1.5, item.quantity);
    check("status defaults to 'active'", item.status === 'active', item.status);

    console.log('\n5. Patch');
    const patch = parsePatch({ quantity: 2, expires_at: '2027-01-15' });
    if (!patch.ok) throw new Error('parsePatch rejected a valid patch');
    const q1 = buildUpdate(patch.value, item.id, userId);
    check('builds one SET entry per supplied field', q1.setCount === 2, q1.setCount);
    const { rows: patched } = await pool.query(q1.text, q1.values);
    check('quantity persisted', patched[0].quantity === 2, patched[0].quantity);
    check('expiry persisted', patched[0].expires_at === '2027-01-15', patched[0].expires_at);
    check('untouched field left alone', patched[0].unit === 'lb', patched[0].unit);

    console.log('\n6. Clearing a nullable column');
    const clear = parsePatch({ expires_at: null });
    if (!clear.ok) throw new Error('parsePatch rejected a null expiry');
    const q2 = buildUpdate(clear.value, item.id, userId);
    const { rows: clearedRows } = await pool.query(q2.text, q2.values);
    check('expiry cleared to null', clearedRows[0].expires_at === null, clearedRows[0].expires_at);

    console.log('\n7. Status transition');
    const status = parsePatch({ status: 'wasted' });
    if (!status.ok) throw new Error('parsePatch rejected a valid status');
    const q3 = buildUpdate(status.value, item.id, userId);
    const { rows: wasted } = await pool.query(q3.text, q3.values);
    check("status is now 'wasted'", wasted[0].status === 'wasted', wasted[0].status);

    console.log('\n8. Cross-user scoping');
    const q4 = buildUpdate({ quantity: 999 }, item.id, otherUserId);
    const { rowCount: hijacked } = await pool.query(q4.text, q4.values);
    check("another user's PATCH matches 0 rows", hijacked === 0, hijacked);

    const { rowCount: hijackedDelete } = await pool.query(
      'DELETE FROM pantry_items WHERE id = $1 AND user_id = $2',
      [item.id, otherUserId]
    );
    check("another user's DELETE matches 0 rows", hijackedDelete === 0, hijackedDelete);

    const { rows: stillThere } = await pool.query('SELECT quantity::float8 AS quantity FROM pantry_items WHERE id = $1', [item.id]);
    check('item survived both hijack attempts unchanged', stillThere.length === 1 && stillThere[0].quantity === 2);

    console.log('\n9. Delete');
    const { rowCount: deleted } = await pool.query(
      'DELETE FROM pantry_items WHERE id = $1 AND user_id = $2',
      [item.id, userId]
    );
    check('owner delete affected 1 row', deleted === 1, deleted);

    const { rows: gone } = await pool.query('SELECT id FROM pantry_items WHERE id = $1', [item.id]);
    check('row is gone', gone.length === 0);

    const { rowCount: again } = await pool.query(
      'DELETE FROM pantry_items WHERE id = $1 AND user_id = $2',
      [item.id, userId]
    );
    check('deleting again affects 0 rows (route turns this into a 404)', again === 0, again);
  } finally {
    await pool.query('DELETE FROM pantry_items WHERE user_id = ANY($1)', [[userId, otherUserId]]);
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [[userId, otherUserId]]);
    console.log('\ncleaned up throwaway users');
  }
}

async function main() {
  verifyValidators();
  await verifyDatabase();

  console.log(`\nDone. ${ok} passed, ${failed} failed.`);
  await pool.end();
  if (failed > 0) process.exit(1);
}

main().catch(async (err) => {
  console.error('verify-pantry-crud failed:', err);
  await pool.end().catch(() => {});
  process.exit(1);
});
