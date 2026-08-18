import { pool } from './db';

/**
 * There is no authentication — the app runs against a single hardcoded demo
 * user (plan.md §2). This lookup was copy-pasted into every route handler that
 * needed it; it lives here so there is one definition of "who is the user".
 *
 * Returns null when the handle isn't seeded, so callers can decide between an
 * empty list and a 404.
 */
export async function resolveDemoUserId(): Promise<string | null> {
  const handle = process.env.DEMO_USER_HANDLE ?? 'demo';
  const { rows } = await pool.query('SELECT id FROM users WHERE handle = $1', [handle]);
  return rows.length > 0 ? (rows[0].id as string) : null;
}

/** The handle `resolveDemoUserId` looks up — for error messages. */
export function demoUserHandle(): string {
  return process.env.DEMO_USER_HANDLE ?? 'demo';
}
