import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

export type Db = Pool | PoolClient;
const globalDb = globalThis as unknown as { bountyPool?: Pool };
export function getPool(): Pool {
  if (!globalDb.bountyPool) {
    if (!process.env.DATABASE_URL) throw new Error('尚未配置 DATABASE_URL，请先完成数据库初始化');
    globalDb.bountyPool = new Pool({ connectionString: process.env.DATABASE_URL, max: 10, connectionTimeoutMillis: 5000, statement_timeout: 15000, idle_in_transaction_session_timeout: 60000 });
  }
  return globalDb.bountyPool;
}
export async function rows<T extends QueryResultRow = QueryResultRow>(db: Db, sql: string, values: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, values)).rows;
}
export async function transaction<T>(pool: Pool, fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try { await db.query('BEGIN'); const result = await fn(db); await db.query('COMMIT'); return result; }
  catch (error) { await db.query('ROLLBACK'); throw error; }
  finally { db.release(); }
}
export async function migrate(pool: Pool) {
  await transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(674822)');
    await db.query('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz DEFAULT now())');
    for (const [version, file] of [['001', '001-init.sql'], ['002', '002-publication-review.sql'], ['003', '003-attachments-tags.sql'], ['004', '004-points-wallet.sql'], ['005', '005-registration.sql'], ['006', '006-task-recipients.sql']]) {
      if ((await rows(db, 'SELECT version FROM schema_migrations WHERE version=$1', [version])).length) continue;
      await db.query(await readFile(path.join(process.cwd(), 'db', file), 'utf8'));
      await db.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
    }
  });
}
