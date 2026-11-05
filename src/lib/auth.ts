import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { z } from 'zod';
import { rows, transaction, type Db } from './db';
import { ensure } from './rules';
import type { RegistrationRequest, User } from './types';

export const publicUserFields = 'id,username,name,role,active,must_change_password';
export const tokenHash = (value: string) => createHash('sha256').update(value).digest('hex');
function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 }, (error, key) => error ? reject(error) : resolve(key)));
}
export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${(await derive(password, salt)).toString('hex')}`;
}
async function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hex] = encoded.split('$');
  if (algorithm !== 'scrypt' || !salt || !hex) return false;
  const actual = await derive(password, salt), expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
const dummyHash = hashPassword(randomBytes(32).toString('hex'));
const passwordInput = z.string().min(12, '密码至少12位').max(128, '密码最多128位');
const accountInput = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,32}$/, '账号使用3至32位字母、数字、点、横线或下划线'),
  name: z.string().trim().min(1).max(40),
  password: passwordInput,
});

async function countAttempt(db: Db, key: string) {
  const [attempt] = await rows(db, `INSERT INTO login_attempts(key) VALUES($1) ON CONFLICT(key) DO UPDATE SET
    attempts=CASE WHEN login_attempts.started_at < now()-interval '15 minutes' THEN 1 ELSE login_attempts.attempts+1 END,
    started_at=CASE WHEN login_attempts.started_at < now()-interval '15 minutes' THEN now() ELSE login_attempts.started_at END RETURNING attempts`, [key]);
  return Number(attempt.attempts);
}

export async function login(pool: Pool, username: string, password: string, ip: string) {
  ensure(typeof username === 'string' && username.length <= 64 && typeof password === 'string' && password.length <= 128, '账号或密码不正确', 401);
  const keys = [tokenHash(`account:${username.toLowerCase()}`), tokenHash(`ip:${ip}`)];
  for (let i = 0; i < keys.length; i++) {
    ensure(await countAttempt(pool, keys[i]) <= (i === 0 ? 10 : 60), '登录尝试过多，请15分钟后再试', 429);
  }
  const [record] = await rows(pool, `SELECT ${publicUserFields},password_hash FROM users WHERE username=$1`, [username.toLowerCase()]);
  const valid = await verifyPassword(password, record?.password_hash ?? await dummyHash);
  ensure(record?.active && valid, '账号或密码不正确，或账号已停用', 401);
  const { password_hash: _, ...user } = record;
  return transaction(pool, async db => {
    // 和重置/停用使用相同的行锁，避免并发重置后创建旧凭据会话。
    const [current] = await rows(db, 'SELECT active,password_hash,role FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    ensure(current.active && current.password_hash === record.password_hash, '账号状态已变更，请重新登录', 401);
    const token = randomBytes(32).toString('hex');
    await db.query("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '7 days')", [tokenHash(token), user.id]);
    await db.query('DELETE FROM login_attempts WHERE key=$1', [keys[0]]);
    return { token, user: { ...user, role: current.role } as User };
  });
}
export async function userForToken(db: Db, token: string | undefined | null): Promise<User | null> {
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const [user] = await rows<User>(db, `SELECT u.id,u.username,u.name,u.role,u.active,u.must_change_password FROM sessions s
    JOIN users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active`, [tokenHash(token)]);
  return user ?? null;
}
export async function logout(db: Db, token: string | undefined) {
  if (token) await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash(token)]);
}
export async function createAccount(pool: Pool, actor: User, value: unknown) {
  ensure(actor.role === 'admin', '仅管理员可以创建账号', 403);
  const input = accountInput.extend({ role: z.enum(['admin', 'member']) }).parse(value);
  const passwordHash = await hashPassword(input.password);
  return transaction(pool, async db => {
    const existing = await rows(db, 'SELECT id FROM users WHERE username=$1', [input.username]);
    ensure(!existing.length, '这个账号已经存在');
    const [user] = await rows<User>(db, `INSERT INTO users(id,username,name,password_hash,role) VALUES($1,$2,$3,$4,$5) RETURNING ${publicUserFields}`,
      [randomUUID(), input.username, input.name, passwordHash, input.role]);
    await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [actor.id, 'account.create', user.id]); return user;
  });
}

export async function requestRegistration(pool: Pool, value: unknown, ip: string) {
  const input = accountInput.parse(value);
  ensure(await countAttempt(pool, tokenHash(`registration:${ip}`)) <= 10, '注册申请过多，请15分钟后再试', 429);
  const passwordHash = await hashPassword(input.password);
  await transaction(pool, async db => {
    const result = await db.query(`INSERT INTO registration_requests(id,username,name,password_hash)
      VALUES($1,$2,$3,$4) ON CONFLICT (username) DO NOTHING`,
      [randomUUID(), input.username, input.name, passwordHash]);
    const existing = await rows(db, 'SELECT id FROM users WHERE username=$1', [input.username]);
    ensure(result.rowCount && !existing.length, '该账号已存在或已有待审核申请', 409);
  });
}

export function listRegistrationRequests(db: Db) {
  return rows<RegistrationRequest>(db, 'SELECT id,username,name FROM registration_requests ORDER BY created_at,id');
}

export async function reviewRegistration(pool: Pool, actor: User, id: string, approve: boolean) {
  ensure(actor.role === 'admin', '仅管理员可以审核注册申请', 403);
  await transaction(pool, async db => {
    const [request] = await rows(db, 'SELECT username,name,password_hash FROM registration_requests WHERE id=$1 FOR UPDATE', [id]);
    ensure(request, '注册申请已处理或不存在', 409);
    if (approve) {
      const result = await db.query(`INSERT INTO users(id,username,name,password_hash,role,must_change_password)
        VALUES($1,$2,$3,$4,'member',false) ON CONFLICT (username) DO NOTHING`,
        [id, request.username, request.name, request.password_hash]);
      ensure(result.rowCount, '该账号已存在，可以拒绝此申请', 409);
    }
    await db.query('DELETE FROM registration_requests WHERE id=$1', [id]);
    await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)',
      [actor.id, approve ? 'registration.approve' : 'registration.reject', id]);
  });
}
async function lockManagedAccount(db: Db, actorId: string, id: string) {
  // 按相同顺序锁定两个账号，避免管理员同时撤销对方权限。
  const accounts = await rows<Pick<User, 'id' | 'role' | 'active'>>(db,
    'SELECT id,role,active FROM users WHERE id IN ($1,$2) AND removed_at IS NULL ORDER BY id FOR UPDATE', [actorId, id]);
  const actor = accounts.find(account => account.id === actorId);
  ensure(actor?.active && actor.role === 'admin', '仅管理员可以管理账号', 403);
  const target = accounts.find(account => account.id === id);
  ensure(target, '账号不存在', 404);
  return target;
}

export async function updateAccount(pool: Pool, actor: User, id: string, value: unknown) {
  ensure(actor.role === 'admin', '仅管理员可以管理账号', 403);
  const input = z.object({ password: passwordInput.optional(), active: z.boolean().optional(), role: z.enum(['admin', 'member']).optional() }).parse(value);
  ensure(input.password !== undefined || input.active !== undefined || input.role !== undefined, '没有需要修改的内容');
  ensure(!(actor.id === id && input.active === false), '不能停用当前管理员账号');
  ensure(!(actor.id === id && input.role === 'member'), '不能降低当前管理员账号的权限');
  const encoded = input.password ? await hashPassword(input.password) : null;
  await transaction(pool, async db => {
    const user = await lockManagedAccount(db, actor.id, id);
    const newRole = input.role !== user.role ? input.role : undefined;
    if (!newRole && !encoded && input.active === undefined) return;
    await db.query(`UPDATE users SET password_hash=coalesce($2,password_hash), active=coalesce($3,active),
      role=coalesce($4,role), must_change_password=CASE WHEN $2::text IS NOT NULL THEN true ELSE must_change_password END WHERE id=$1`,
      [id, encoded, input.active ?? null, newRole ?? null]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    if (newRole) {
      await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [actor.id, newRole === 'admin' ? 'account.promote' : 'account.demote', id]);
    }
    if (encoded || input.active !== undefined) {
      await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [actor.id, encoded ? 'account.reset-password' : 'account.status', id]);
    }
  });
}
export async function removeAccount(pool: Pool, actor: User, id: string) {
  ensure(actor.role === 'admin', '仅管理员可以删除账号', 403);
  ensure(actor.id !== id, '不能删除当前管理员账号');
  await transaction(pool, async db => {
    await lockManagedAccount(db, actor.id, id);
    await db.query('UPDATE users SET active=false,removed_at=now() WHERE id=$1', [id]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [id]);
    await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [actor.id, 'account.remove', id]);
  });
}
export async function changePassword(pool: Pool, user: User, oldPassword: string, newPassword: string) {
  passwordInput.parse(newPassword); ensure(typeof oldPassword === 'string' && oldPassword.length <= 128, '原密码不正确');
  const [record] = await rows(pool, 'SELECT password_hash FROM users WHERE id=$1', [user.id]);
  ensure(record && await verifyPassword(oldPassword, record.password_hash), '原密码不正确');
  ensure(oldPassword !== newPassword, '新密码不能与原密码相同');
  const encoded = await hashPassword(newPassword);
  await transaction(pool, async db => {
    const [current] = await rows(db, 'SELECT password_hash FROM users WHERE id=$1 FOR UPDATE', [user.id]);
    ensure(current.password_hash === record.password_hash, '密码已更新，请重新登录');
    await db.query('UPDATE users SET password_hash=$2,must_change_password=false WHERE id=$1', [user.id, encoded]);
    await db.query('DELETE FROM sessions WHERE user_id=$1', [user.id]);
    await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [user.id, 'account.change-password', user.id]);
  });
}
