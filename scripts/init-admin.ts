import { randomUUID } from 'node:crypto';
import { getPool, rows, transaction } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { ensure } from '../src/lib/rules';
export async function initAdmin() {
  const pool = getPool();
  return transaction(pool, async db => {
    await db.query('SELECT pg_advisory_xact_lock(674823)');
    if ((await rows(db, "SELECT id FROM users WHERE role='admin'")).length) { console.log('管理员已存在，保留原账号和密码。'); return; }
    const username = process.env.ADMIN_USERNAME ?? 'admin', password = process.env.ADMIN_PASSWORD;
    ensure(/^[a-z0-9_.-]{3,32}$/.test(username), '管理员账号必须为3至32位小写字母、数字、点、横线或下划线');
    ensure(password && password.length >= 12 && password.length <= 128, '首次启动请设置12至128位 ADMIN_PASSWORD');
    await db.query("INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,'管理员',$3,'admin')", [randomUUID(), username, await hashPassword(password)]);
    console.log('初始管理员已创建，首次登录后必须修改密码。');
  });
}
if (process.env.BOUNTY_IMPORT_ONLY !== 'true') {
  try { await initAdmin(); } finally { await getPool().end(); }
}
