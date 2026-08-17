import { Pool } from 'pg';

/**
 * Duplicated from packages/shared/src/db.ts on purpose: SAM's esbuild builder
 * isolates each function's CodeUri into its own staging dir, so a relative
 * import reaching outside lambda/shopping-list/ doesn't survive the copy.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 2,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 5_000,
  ssl: { rejectUnauthorized: true },
});
