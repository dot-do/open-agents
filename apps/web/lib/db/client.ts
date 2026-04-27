import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

type DrizzleClient = ReturnType<typeof drizzle<typeof schema>>;

let _db: DrizzleClient | null = null;

/**
 * Lazily-initialised Drizzle client backed by postgres.js with connection
 * pool limits.
 *
 * Pool tuning knobs (env vars with sensible defaults):
 *   POSTGRES_MAX_CONNECTIONS  – max pool size          (default: 20)
 *   POSTGRES_IDLE_TIMEOUT     – seconds before closing idle conn (default: 30)
 *   POSTGRES_CONNECT_TIMEOUT  – seconds to wait for a new conn   (default: 10)
 *   POSTGRES_STATEMENT_TIMEOUT – ms before aborting a statement  (default: 30000)
 *
 * The defaults work well for a single-region Vercel deployment talking to a
 * managed Postgres instance. Increase max connections for high-throughput
 * self-hosted setups; lower idle_timeout if your provider charges per-connection.
 */
export const db = new Proxy({} as DrizzleClient, {
  get(_, prop) {
    if (!_db) {
      if (!process.env.POSTGRES_URL) {
        throw new Error("POSTGRES_URL environment variable is required");
      }
      const client = postgres(process.env.POSTGRES_URL, {
        max: Number(process.env.POSTGRES_MAX_CONNECTIONS) || 20,
        idle_timeout: Number(process.env.POSTGRES_IDLE_TIMEOUT) || 30,
        connect_timeout: Number(process.env.POSTGRES_CONNECT_TIMEOUT) || 10,
        // postgres.js uses seconds for most options but the underlying PG
        // statement_timeout param is in milliseconds.
        connection: {
          statement_timeout:
            Number(process.env.POSTGRES_STATEMENT_TIMEOUT) || 30000,
        },
      });
      _db = drizzle(client, { schema });
    }
    return Reflect.get(_db, prop);
  },
});
