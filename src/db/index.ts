import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import * as schema from './schema';

/**
 * Lazy db client.
 *
 * The check for DATABASE_URL is deferred until the first query so that
 * `next build` (which imports route modules to collect page data) does
 * not crash on environments where the env var is intentionally absent
 * at build time. The first runtime request will throw clearly if the
 * env var is still missing.
 *
 * The Drizzle proxy is constructed lazily on first access and then
 * cached, so we avoid recreating the Neon client per query.
 */

type DB = NeonHttpDatabase<typeof schema>;

let cached: DB | null = null;

function getDb(): DB {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is not set. Add it to .env.local or your Vercel project.');
  }
  const client = neon(url);
  cached = drizzle(client, { schema });
  return cached;
}

export const db = new Proxy({} as DB, {
  get(_target, prop, receiver) {
    const real = getDb();
    const value = Reflect.get(real, prop, receiver);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };
