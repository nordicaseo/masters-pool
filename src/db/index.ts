import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import * as schema from './schema';

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error('DATABASE_URL is not set. Add it to .env.local or your Vercel project.');
}

const client = neon(url);
export const db = drizzle(client, { schema });
export { schema };
