import { getPool, migrate } from '../src/lib/db';
const pool = getPool();
try { await migrate(pool); console.log('数据库迁移完成。'); } finally { await pool.end(); }
