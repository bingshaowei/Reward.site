import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir, utimes, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { migrate, rows } from '../src/lib/db';
import { createTask, claimTask, withdrawTask, submitWork, reviewWork, finishTask, settleReward, getTaskDetail, editTask, listTasks, reviewPublication } from '../src/lib/tasks';
import { hashPassword, login, userForToken, changePassword, updateAccount, createAccount, removeAccount } from '../src/lib/auth';
import { saveAttachment, downloadAttachment, cleanupExpired, validateFiles } from '../src/lib/files';
import { getWallet, recordPoints } from '../src/lib/wallet';
import type { User } from '../src/lib/types';
import * as taskService from '../src/lib/tasks';

const postgres = new EmbeddedPostgres({ databaseDir: '.data/test-postgres', user: 'postgres', password: 'test-only-password', port: 55439, persistent: true, autoRehydrateSymlinks: true, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: () => {} });
const pool = new Pool({ connectionString: 'postgres://postgres:test-only-password@127.0.0.1:55439/postgres', max: 10 });
let admin: User, publisher: User, worker: User, other: User, outsider: User, passwordHash: string;
const input = (overrides = {}) => ({ title: '完成一项真实工作', description: '整理并交付团队需要的工作材料。', criteria: '材料完整且可以使用。', mode: 'independent', reward_type: 'points', reward: '100', capacity: 1, ...overrides });
const make = (overrides = {}) => createTask(pool, publisher, input(overrides));
const zipBytes = new Uint8Array(22);
zipBytes.set([0x50, 0x4b, 0x05, 0x06]);
const zip = (name = '参考资料.zip') => new File([zipBytes], name, { type: 'application/zip' });
beforeAll(async () => {
  if (!existsSync('.data/test-postgres/PG_VERSION')) await postgres.initialise();
  await postgres.start();
  await migrate(pool);
  passwordHash = await hashPassword('Test-password-2026');
  process.env.UPLOAD_DIR = path.resolve('.data/test-uploads');
});
afterAll(async () => { await pool.end(); await postgres.stop(); });
beforeEach(async () => {
  await pool.query('TRUNCATE audit_log,attachments,rewards,submissions,claims,tasks,sessions,login_attempts,users RESTART IDENTITY CASCADE');
  const users: User[] = [];
  for (const name of ['admin', 'publisher', 'worker', 'other', 'outsider']) {
    const id = randomUUID();
    const [u] = await rows(pool, `INSERT INTO users(id,username,name,password_hash,role,must_change_password) VALUES($1,$2,$2,$3,$4,false) RETURNING id,username,name,role,active,must_change_password`, [id, name, passwordHash, ['admin', 'publisher'].includes(name) ? 'admin' : 'member']);
    users.push(u as User);
  }
  [admin, publisher, worker, other, outsider] = users;
  await recordPoints(pool, publisher.id, 'fixture', 'legacy', 10000);
});

it('成员只能提交积分悬赏，退回重提后管理员须审核最新版本', async () => {
  await expect(createTask(pool, worker, input({ reward_type: 'money' }))).rejects.toMatchObject({ status: 403 });
  const task = await createTask(pool, worker, input(), [zip()]);
  expect(task.publication_status).toBe('pending');
  expect(await listTasks(pool)).toHaveLength(0);
  expect(await listTasks(pool, { publicationQueue: true })).toHaveLength(1);
  const detail = await getTaskDetail(pool, worker, task.id);
  await expect(downloadAttachment(pool, other, detail.attachments[0].id)).rejects.toMatchObject({ status: 404 });
  await expect(getTaskDetail(pool, other, task.id)).rejects.toMatchObject({ status: 404 });
  await expect(claimTask(pool, other, task.id)).rejects.toMatchObject({ status: 403 });
  const approval = { approve: true, version: task.publication_version };
  await expect(reviewPublication(pool, worker, task.id, approval)).rejects.toMatchObject({ status: 403 });
  await reviewPublication(pool, admin, task.id, { ...approval, approve: false, note: '请调整积分' });
  await editTask(pool, worker, task.id, input({ reward: '50' }));
  await expect(reviewPublication(pool, admin, task.id, approval)).rejects.toMatchObject({ status: 409 });
  const revised = (await getTaskDetail(pool, admin, task.id)).task;
  await reviewPublication(pool, admin, task.id, { approve: true, version: revised.publication_version });
  expect((await listTasks(pool))[0].reward_units).toBe(50);
  await expect(claimTask(pool, worker, task.id)).rejects.toThrow('不能领取自己发布的任务');
  await claimTask(pool, other, task.id);
});

it('积分预留覆盖所有名额，部分验收后退回未发出的积分', async () => {
  const task = await createTask(pool, admin, input({ capacity: 2, reward: '40', tags: ['分析', ' 脚本 '] }));
  expect((await getWallet(pool, admin.id))).toMatchObject({ balance: 20, reserved: 80 });
  await expect(createTask(pool, admin, input({ reward: '21' }))).rejects.toMatchObject({ status: 409 });
  expect((await listTasks(pool, { q: '脚本' }))[0].tags).toEqual(expect.arrayContaining(['分析', '脚本']));
  await claimTask(pool, worker, task.id);
  const submission = await submitWork(pool, worker, task.id, { content: '完成交付' });
  await reviewWork(pool, admin, submission.id, { approve: true });
  await finishTask(pool, admin, task.id, 'complete');
  expect(await getWallet(pool, admin.id)).toMatchObject({ balance: 60, reserved: 0 });
  expect(await getWallet(pool, worker.id)).toMatchObject({ balance: 140, reserved: 0 });
});

it('满五天退出扣25分，逾期一天另扣10分，重复结算不重扣', async () => {
  const [migration] = await rows(pool, "SELECT applied_at FROM schema_migrations WHERE version='004'");
  try {
    await pool.query("UPDATE schema_migrations SET applied_at=now()-interval '7 days' WHERE version='004'");
    await createTask(pool, worker, input({ reward: '80' }));
    const task = await make({ deadline: new Date(Date.now() - 25 * 3600000).toISOString() });
    const claim = await claimTask(pool, worker, task.id);
    await pool.query("UPDATE claims SET created_at=now()-interval '121 hours' WHERE id=$1", [claim.id]);
    expect((await getWallet(pool, worker.id)).balance).toBe(10);
    expect((await getWallet(pool, worker.id)).balance).toBe(10);
    await withdrawTask(pool, worker, task.id);
    const wallet = await getWallet(pool, worker.id);
    expect(wallet.balance).toBe(-15);
    expect(wallet.entries.filter(entry => ['overdue', 'withdrawal'].includes(entry.kind)).map(entry => entry.amount)).toEqual([-25, -10]);
  } finally {
    await pool.query("UPDATE schema_migrations SET applied_at=$1 WHERE version='004'", [migration.applied_at]);
  }
});

it('补发月度积分并按发放前余额计息，重复结算不重发', async () => {
  const [migration] = await rows(pool, "SELECT applied_at FROM schema_migrations WHERE version='004'");
  const now = new Date();
  const [boundary] = await rows<{ since: Date }>(pool, "SELECT (date_trunc('month', $1::timestamptz AT TIME ZONE 'Asia/Shanghai')-interval '1 month') AT TIME ZONE 'Asia/Shanghai' AS since", [now]);
  try {
    await pool.query("UPDATE schema_migrations SET applied_at=$1 WHERE version='004'", [boundary.since]);
    await pool.query('UPDATE users SET created_at=$2 WHERE id=$1', [worker.id, boundary.since]);
    await recordPoints(pool, worker.id, 'savings', 'legacy', 1000, null, new Date(+boundary.since - 1));
    const first = await getWallet(pool, worker.id);
    expect(first.balance).toBe(1221);
    expect(first.entries.filter(entry => entry.kind === 'monthly')).toHaveLength(2);
    expect((await getWallet(pool, worker.id)).balance).toBe(1221);
  } finally {
    await pool.query("UPDATE schema_migrations SET applied_at=$1 WHERE version='004'", [migration.applied_at]);
  }
});

it('参考文件仅限压缩包，合计上限100MB', async () => {
  await expect(validateFiles([zip()], true)).resolves.toBeUndefined();
  await expect(validateFiles([new File(['文字'], '说明.txt')], true)).rejects.toThrow('仅支持');
  await expect(validateFiles([new File(['文字'], '伪装.zip')], true)).rejects.toThrow('扩展名不符');
  const limit = 100 * 1024 * 1024;
  const large = new File([zipBytes, new Uint8Array(limit - zipBytes.length)], '大文件.zip');
  await expect(validateFiles([large], true)).resolves.toBeUndefined();
  await expect(validateFiles([large, zip()], true)).rejects.toThrow('合计不得超过100MB');
});

it('仅管理员可删除账号，删除撤销会话并保留任务记录', async () => {
  const task = await createTask(pool, worker, input());
  const session = await login(pool, worker.username, 'Test-password-2026', 'remove-test');
  await expect(removeAccount(pool, other, worker.id)).rejects.toMatchObject({ status: 403 });
  await removeAccount(pool, admin, worker.id);
  expect(await userForToken(pool, session.token)).toBeNull();
  await expect(updateAccount(pool, admin, worker.id, { active: true })).rejects.toMatchObject({ status: 404 });
  expect((await getTaskDetail(pool, admin, task.id)).task.publisher_id).toBe(worker.id);
});

describe('真实 PostgreSQL 任务和奖励流程', () => {
  it('并发领取最后一个名额只能成功一次，且不能领取自己的任务', async () => {
    const task = await make();
    await expect(claimTask(pool, publisher, task.id)).rejects.toThrow();
    const results = await Promise.allSettled([claimTask(pool, worker, task.id), claimTask(pool, other, task.id)]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect((await rows(pool, "SELECT * FROM claims WHERE status='working'"))).toHaveLength(1);
  });
  it('积分任务可退回重交，并发重复验收只发一次奖励', async () => {
    const task = await make(); await claimTask(pool, worker, task.id);
    const s = await submitWork(pool, worker, task.id, { content: '第一次提交' });
    await expect(reviewWork(pool, other, s.id, { approve: true })).rejects.toThrow();
    await expect(reviewWork(pool, publisher, s.id, { approve: false, note: '' })).rejects.toThrow();
    await reviewWork(pool, publisher, s.id, { approve: false, note: '请补充数据来源' });
    const s2 = await submitWork(pool, worker, task.id, { content: '已补充数据来源' });
    await Promise.allSettled([reviewWork(pool, publisher, s2.id, { approve: true }), reviewWork(pool, publisher, s2.id, { approve: true })]);
    expect((await rows(pool, 'SELECT units FROM rewards')).map(r => r.units)).toEqual([100]);
    expect((await getTaskDetail(pool, worker, task.id)).task.status).toBe('completed');
  });
  it('领取后退出释放名额，首次领取后不能修改奖励', async () => {
    const task = await make(); await claimTask(pool, worker, task.id);
    await withdrawTask(pool, worker, task.id);
    await expect(editTask(pool, publisher, task.id, input({ reward: '200' }))).rejects.toThrow();
    await claimTask(pool, other, task.id);
    const s = await submitWork(pool, other, task.id, { content: '交付' });
    await expect(withdrawTask(pool, other, task.id)).rejects.toThrow();
    expect(s.id).toBeTruthy();
  });
  it('独立多人分别验收，取消其余名额时保留已发放的积分', async () => {
    const task = await make({ capacity: 3 });
    await claimTask(pool, worker, task.id); await claimTask(pool, other, task.id);
    const s = await submitWork(pool, worker, task.id, { content: '我的成果' });
    await reviewWork(pool, publisher, s.id, { approve: true });
    await expect(finishTask(pool, publisher, task.id, 'complete')).rejects.toThrow();
    await finishTask(pool, publisher, task.id, 'cancel');
    expect((await rows(pool, 'SELECT units FROM rewards'))[0].units).toBe(100);
    expect((await rows(pool, 'SELECT status FROM claims WHERE user_id=$1', [other.id]))[0].status).toBe('cancelled');
    await expect(submitWork(pool, other, task.id, { content: '迟到的提交' })).rejects.toThrow();
  });
  it('团队首次提交锁定成员，验收分配必须覆盖全员且总额正确', async () => {
    const task = await make({ mode: 'team', capacity: 3, reward_type: 'money', reward: '19.99' });
    await claimTask(pool, worker, task.id); await claimTask(pool, other, task.id);
    const s = await submitWork(pool, other, task.id, { content: '团队共同交付' });
    await expect(claimTask(pool, outsider, task.id)).rejects.toThrow();
    await expect(withdrawTask(pool, worker, task.id)).rejects.toThrow();
    await expect(reviewWork(pool, publisher, s.id, { approve: true, allocations: { [worker.id]: 1999 } })).rejects.toThrow();
    await expect(reviewWork(pool, publisher, s.id, { approve: true, allocations: { [worker.id]: 1000, [other.id]: 1000 } })).rejects.toThrow();
    await reviewWork(pool, publisher, s.id, { approve: true, allocations: { [worker.id]: 1000, [other.id]: 999 } });
    const rewards = await rows(pool, 'SELECT * FROM rewards ORDER BY units DESC');
    expect(rewards.map(r => r.units)).toEqual([1000, 999]);
    expect(rewards.every(r => r.paid_at === null)).toBe(true);
    await expect(settleReward(pool, outsider, rewards[0].id)).rejects.toThrow();
    await settleReward(pool, publisher, rewards[0].id);
    const paidAt = (await rows(pool, 'SELECT paid_at FROM rewards WHERE id=$1', [rewards[0].id]))[0].paid_at;
    await settleReward(pool, admin, rewards[0].id);
    expect((await rows(pool, 'SELECT paid_at FROM rewards WHERE id=$1', [rewards[0].id]))[0].paid_at).toEqual(paidAt);
  });
  it('无进行中成员时可以提前结束，已结束的任务不可重新领取', async () => {
    const task = await make({ capacity: 3 });
    await finishTask(pool, publisher, task.id, 'complete');
    await expect(claimTask(pool, worker, task.id)).rejects.toThrow();
  });
  it('累计奖励独立于他人的1000条新明细，个人统计不被挤掉', async () => {
    const task = await make(); await claimTask(pool, worker, task.id);
    const s = await submitWork(pool, worker, task.id, { content: '积分交付' });
    await reviewWork(pool, publisher, s.id, { approve: true });
    const money = await make({ reward_type: 'money', reward: '19.99' });
    await claimTask(pool, worker, money.id);
    const sm = await submitWork(pool, worker, money.id, { content: '金额交付' });
    await reviewWork(pool, publisher, sm.id, { approve: true });
    await pool.query(`WITH t AS (INSERT INTO tasks(id,publisher_id,title,description,criteria,mode,reward_type,reward_units,capacity,status)
      SELECT 'bulk-task-'||n,$1,'其他人的奖励','说明','标准','independent','points',1,1,'completed' FROM generate_series(1,1001) n RETURNING id),
      c AS (INSERT INTO claims(id,task_id,user_id,status) SELECT 'bulk-claim-'||id,id,$2,'accepted' FROM t RETURNING id,task_id)
      INSERT INTO rewards(id,task_id,claim_id,user_id,reward_type,units) SELECT 'bulk-reward-'||id,task_id,id,$2,'points',1 FROM c`, [publisher.id, other.id]);
    const getOverview = (taskService as unknown as { getOverview: (db: Pool, user: User) => Promise<Record<string, number>> }).getOverview;
    const overview = await getOverview(pool, worker);
    expect(overview.points).toBe(100); expect(overview.total_money).toBe(1999); expect(overview.pending_money).toBe(1999);
    expect(overview.completed_tasks).toBe(1003);
  });
});

describe('账号与会话', () => {
  it('错误密码不能登录，退出、重置和停用能立即使会话失效', async () => {
    await expect(login(pool, 'worker', 'wrong-password', 'test')).rejects.toThrow();
    const session = await login(pool, 'worker', 'Test-password-2026', 'test');
    expect((await userForToken(pool, session.token))?.id).toBe(worker.id);
    await updateAccount(pool, admin, worker.id, { password: 'New-password-2026' });
    expect(await userForToken(pool, session.token)).toBeNull();
    const session2 = await login(pool, 'worker', 'New-password-2026', 'test');
    await updateAccount(pool, admin, worker.id, { active: false });
    expect(await userForToken(pool, session2.token)).toBeNull();
    await expect(login(pool, 'worker', 'New-password-2026', 'test')).rejects.toThrow();
  });
  it('登录尝试限流，普通成员不能创建账号，管理员不能停用自己', async () => {
    for (let i = 0; i < 10; i++) await login(pool, 'worker', 'wrong-password', 'rate-test').catch(() => {});
    await expect(login(pool, 'worker', 'Test-password-2026', 'rate-test')).rejects.toMatchObject({ status: 429 });
    await expect(createAccount(pool, worker, { username: 'newuser', name: '新成员', password: 'New-password-2026', role: 'member' })).rejects.toThrow();
    await expect(updateAccount(pool, admin, admin.id, { active: false })).rejects.toThrow();
  });
  it('修改本人密码必须校验旧密码，并注销其他会话', async () => {
    const session = await login(pool, 'worker', 'Test-password-2026', 'test');
    await expect(changePassword(pool, worker, 'bad-password', 'New-password-2026')).rejects.toThrow();
    await changePassword(pool, worker, 'Test-password-2026', 'New-password-2026');
    expect(await userForToken(pool, session.token)).toBeNull();
    const next = await login(pool, 'worker', 'New-password-2026', 'test');
    expect(next.user.must_change_password).toBe(false);
  });
});

describe('附件权限与保留期限', () => {
  it('数据库回滚会回收同一请求中已经写入的附件', async () => {
    const dir = process.env.UPLOAD_DIR!; await mkdir(dir, { recursive: true });
    const before = (await readdir(dir)).sort();
    await pool.query(`CREATE OR REPLACE FUNCTION test_reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'audit failure'; END $$;
      CREATE TRIGGER test_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_reject_audit()`);
    try { await expect(createTask(pool, publisher, input(), [zip('需求1.zip'), zip('需求2.zip')])).rejects.toThrow('audit failure'); }
    finally { await pool.query('DROP TRIGGER test_audit_failure ON audit_log; DROP FUNCTION test_reject_audit()'); }
    expect((await rows(pool, 'SELECT * FROM attachments'))).toHaveLength(0);
    expect((await readdir(dir)).sort()).toEqual(before);
  });
  it('进程中断留下的孤儿文件可重试回收，正常附件始终保留', async () => {
    const task = await make();
    const a = await saveAttachment(pool, publisher, task.id, null, zip());
    const dir = process.env.UPLOAD_DIR!, orphan = path.join(dir, `${randomUUID()}.blob`), old = new Date(Date.now() - 2 * 86400000);
    await writeFile(orphan, 'aborted upload'); await utimes(orphan, old, old); await utimes(path.join(dir, a.storage_name), old, old);
    const outcome = await cleanupExpired(pool);
    expect((outcome as { orphaned: number }).orphaned).toBeGreaterThanOrEqual(1);
    await expect(readFile(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await downloadAttachment(pool, publisher, a.id)).data).toEqual(Buffer.from(zipBytes));
  });
  it('成果附件不向其他成员开放，任务结束前不会清理', async () => {
    const task = await make(); await claimTask(pool, worker, task.id);
    const s = await submitWork(pool, worker, task.id, { content: '成果' });
    const file = new File(['real result'], '成果.txt', { type: 'text/plain' });
    const attachment = await saveAttachment(pool, worker, task.id, s.id, file);
    await expect(downloadAttachment(pool, outsider, attachment.id)).rejects.toThrow();
    expect((await downloadAttachment(pool, publisher, attachment.id)).data.toString()).toBe('real result');
    const stat = await cleanupExpired(pool, new Date('2099-01-01T00:00:00Z'));
    expect(stat.cleaned).toBe(0);
  });
  it('结束后第15天才清理，保留元数据并拒绝过期下载', async () => {
    const task = await make();
    const attachment = await saveAttachment(pool, publisher, task.id, null, zip());
    await finishTask(pool, publisher, task.id, 'cancel');
    await pool.query("UPDATE tasks SET ended_at='2026-11-01T00:00:00Z' WHERE id=$1", [task.id]);
    expect((await cleanupExpired(pool, new Date('2026-11-15T23:59:59Z'))).cleaned).toBe(0);
    expect((await cleanupExpired(pool, new Date('2026-11-16T00:00:00Z'))).cleaned).toBe(1);
    expect((await rows(pool, 'SELECT expired_at FROM attachments WHERE id=$1', [attachment.id]))[0].expired_at).toBeTruthy();
    await expect(downloadAttachment(pool, publisher, attachment.id)).rejects.toMatchObject({ status: 410 });
  });
  it('清理失败不标记成功，后续重试能够完成', async () => {
    const task = await make();
    const attachment = await saveAttachment(pool, publisher, task.id, null, zip());
    await finishTask(pool, publisher, task.id, 'cancel');
    await pool.query("UPDATE tasks SET ended_at='2026-01-01' WHERE id=$1", [task.id]);
    const result = await cleanupExpired(pool, new Date(), async () => { throw new Error('disk failure'); });
    expect(result.failed).toBe(1);
    expect((await rows(pool, 'SELECT expired_at FROM attachments WHERE id=$1', [attachment.id]))[0].expired_at).toBeNull();
    expect((await cleanupExpired(pool, new Date())).cleaned).toBe(1);
  });
  it('拒绝可执行文件、伪装扩展名和大于20MB的文件', async () => {
    const task = await make();
    await expect(saveAttachment(pool, publisher, task.id, null, new File(['MZ'], 'run.exe'))).rejects.toThrow();
    await expect(saveAttachment(pool, publisher, task.id, null, new File(['MZ'], 'image.png'))).rejects.toThrow();
    await expect(saveAttachment(pool, publisher, task.id, null, new File([new Uint8Array(20 * 1024 * 1024 + 1)], 'big.txt'))).rejects.toThrow();
  });
});
