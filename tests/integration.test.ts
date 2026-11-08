import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir, utimes, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { migrate, rows } from '../src/lib/db';
import { createTask, claimTask, withdrawTask, submitWork, reviewWork, finishTask, settleReward, getTaskDetail, editTask, listTasks, reviewPublication, listPointsLeaders } from '../src/lib/tasks';
import { hashPassword, login, userForToken, changePassword, updateAccount, createAccount, removeAccount, requestRegistration, listRegistrationRequests, reviewRegistration } from '../src/lib/auth';
import { saveAttachment, downloadAttachment, cleanupExpired, validateFiles } from '../src/lib/files';
import { getWallet, recordPoints } from '../src/lib/wallet';
import type { User } from '../src/lib/types';
import * as taskService from '../src/lib/tasks';
import * as avatarService from '../src/lib/avatars';

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
  await pool.query('TRUNCATE registration_requests,audit_log,attachments,rewards,submissions,claims,tasks,sessions,login_attempts,users RESTART IDENTITY CASCADE');
  const users: User[] = [];
  for (const name of ['admin', 'publisher', 'worker', 'other', 'outsider']) {
    const id = randomUUID();
    const [u] = await rows(pool, `INSERT INTO users(id,username,name,password_hash,role,must_change_password) VALUES($1,$2,$2,$3,$4,false) RETURNING id,username,name,role,active,must_change_password`, [id, name, passwordHash, ['admin', 'publisher'].includes(name) ? 'admin' : 'member']);
    users.push(u as User);
  }
  [admin, publisher, worker, other, outsider] = users;
  await recordPoints(pool, publisher.id, 'fixture', 'legacy', 10000);
});

it('头像只更新当前成员，替换后持久保存且会话保持有效', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
  const session = await login(pool, worker.username, 'Test-password-2026', 'avatar');
  const version = await avatarService.updateAvatar(pool, worker, { image });
  expect(await avatarService.readAvatar(pool, worker.id)).toMatchObject({ type: 'image/png', data: Buffer.from(image.split(',')[1], 'base64') });
  expect(await avatarService.readAvatar(pool, other.id)).toBeNull();
  expect(await userForToken(pool, session.token)).toMatchObject({ id: worker.id, avatar_version: version });
  expect(await avatarService.updateAvatar(pool, worker, { image })).not.toBe(version);
});

it('头像拒绝伪装图片、无效格式及超大内容，保留原头像', async () => {
  for (const image of ['data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,aGVsbG8=', `data:image/png;base64,${'A'.repeat(800000)}`]) {
    await expect(avatarService.updateAvatar(pool, worker, { image })).rejects.toThrow();
  }
  expect(await avatarService.readAvatar(pool, worker.id)).toBeNull();
});

it('团队协作至少设置两个名额', async () => {
  await expect(make({ mode: 'team', capacity: 1 })).rejects.toThrow('团队至少设置2个名额');
  expect(await make({ mode: 'team', capacity: 2 })).toMatchObject({ mode: 'team', capacity: 2 });
});

describe('管理员移除承接人', () => {
  it('仅管理员可移除，原因必填且限长，保护隐私并释放名额且不允许重领', async () => {
    const task = await createTask(pool, worker, input({ reward: '1' }));
    await reviewPublication(pool, admin, task.id, { approve: true, version: task.publication_version });
    const claim = await claimTask(pool, other, task.id);
    await expect(taskService.removeClaim(pool, worker, task.id, claim.id, { reason: '发布者不合适' })).rejects.toMatchObject({ status: 403 });
    for (const reason of ['', '  ', 'x'.repeat(2001)]) await expect(taskService.removeClaim(pool, admin, task.id, claim.id, { reason })).rejects.toThrow();
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '  技能不匹配  ' });
    const detail = await getTaskDetail(pool, admin, task.id);
    expect(detail.task.claimed_count).toBe(0);
    expect(detail.claims[0]).toMatchObject({ status: 'removed', removal_reason: '技能不匹配', removed_by: admin.id, removed_by_name: admin.name });
    expect((await getTaskDetail(pool, worker, task.id)).claims[0].removal_reason).toBe('技能不匹配');
    expect((await getTaskDetail(pool, other, task.id)).claims[0].removal_reason).toBe('技能不匹配');
    const publicClaim = (await getTaskDetail(pool, outsider, task.id)).claims[0];
    expect(publicClaim.status).toBe('removed');
    for (const field of ['removal_reason', 'removed_by', 'removed_by_name', 'removed_at']) expect(publicClaim).not.toHaveProperty(field);
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '重复请求不能覆盖' });
    expect((await getTaskDetail(pool, admin, task.id)).claims[0].removal_reason).toBe('技能不匹配');
    expect(await rows(pool, "SELECT * FROM audit_log WHERE action='claim.remove' AND target_id=$1", [claim.id])).toHaveLength(1);
    await expect(claimTask(pool, other, task.id)).rejects.toThrow('移除');
    await expect(submitWork(pool, other, task.id, { content: '不能继续交付' })).rejects.toThrow();
    expect((await listTasks(pool, { mine: 'claimed', userId: other.id }))[0]).toMatchObject({ viewer_claim_status: 'removed', viewer_removal_reason: '技能不匹配' });
    await claimTask(pool, outsider, task.id);
  });

  it('移除不扣退出费、不补扣逾期，保留已扣分并停止后续累计', async () => {
    const task = await make({ deadline: new Date(Date.now() - 7 * 86400000).toISOString() });
    const claim = await claimTask(pool, worker, task.id);
    await pool.query("UPDATE claims SET created_at=now()-interval '121 hours' WHERE id=$1", [claim.id]);
    await recordPoints(pool, worker.id, 'past-overdue', 'overdue', -10, task.id);
    const before = (await rows(pool, 'SELECT * FROM wallet_ledger WHERE user_id=$1 ORDER BY id', [worker.id]));
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '改由其他成员处理' });
    await getWallet(pool, worker.id);
    const penalties = await rows(pool, "SELECT * FROM wallet_ledger WHERE user_id=$1 AND kind IN ('overdue','withdrawal') ORDER BY id", [worker.id]);
    expect(penalties).toEqual(before.filter(entry => ['overdue', 'withdrawal'].includes(entry.kind)));
    expect((await getTaskDetail(pool, admin, task.id)).task.points_reserved).toBe(task.points_reserved);
  });

  it('独立待验收成果终止验收并保留本人附件，新成员独立交付', async () => {
    const task = await make();
    const claim = await claimTask(pool, worker, task.id);
    const submission = await submitWork(pool, worker, task.id, { content: '原有成果' }, [zip()]);
    const attachment = (await getTaskDetail(pool, worker, task.id)).attachments[0];
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '调整执行人' });
    expect((await getTaskDetail(pool, worker, task.id)).submissions[0].status).toBe('voided');
    await expect(reviewWork(pool, publisher, submission.id, { approve: true })).rejects.toThrow();
    await expect(downloadAttachment(pool, worker, attachment.id)).resolves.toBeTruthy();
    await claimTask(pool, other, task.id);
    await expect(downloadAttachment(pool, other, attachment.id)).rejects.toMatchObject({ status: 403 });
    const replacement = await submitWork(pool, other, task.id, { content: '新的成果' });
    await reviewWork(pool, publisher, replacement.id, { approve: true });
    expect(await rows(pool, 'SELECT user_id FROM rewards WHERE task_id=$1', [task.id])).toEqual([{ user_id: other.id }]);
    await expect(taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '任务结束不能重复移除' })).rejects.toThrow();
  });

  it('团队保留现有成果，剩一人也可验收，移除者不能看其他成员成果或附件', async () => {
    const task = await make({ mode: 'team', capacity: 2 });
    const claim = await claimTask(pool, worker, task.id);
    await claimTask(pool, other, task.id);
    const submission = await submitWork(pool, other, task.id, { content: '团队交付' }, [zip()]);
    const attachment = (await getTaskDetail(pool, worker, task.id)).attachments[0];
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '成员不再参与' });
    const remaining = await getTaskDetail(pool, other, task.id);
    expect(remaining.task).toMatchObject({ team_locked: true, claimed_count: 1 });
    expect(remaining.submissions[0].status).toBe('pending');
    expect((await getTaskDetail(pool, worker, task.id)).submissions).toHaveLength(0);
    await expect(downloadAttachment(pool, worker, attachment.id)).rejects.toMatchObject({ status: 403 });
    await expect(claimTask(pool, outsider, task.id)).rejects.toThrow('锁定');
    await reviewWork(pool, publisher, submission.id, { approve: true, allocations: { [other.id]: 100 } });
    expect(await rows(pool, 'SELECT user_id,units FROM rewards WHERE task_id=$1', [task.id])).toEqual([{ user_id: other.id, units: 100 }]);
  });

  it('移除团队提交者不影响剩余成员的验收，待修改成员也可被移除', async () => {
    const task = await make({ mode: 'team', capacity: 2 });
    const workerClaim = await claimTask(pool, worker, task.id);
    const otherClaim = await claimTask(pool, other, task.id);
    const submission = await submitWork(pool, worker, task.id, { content: '团队旧版本' }, [zip()]);
    const oldAttachment = (await getTaskDetail(pool, worker, task.id)).attachments[0];
    await reviewWork(pool, publisher, submission.id, { approve: false, note: '补充说明' });
    await taskService.removeClaim(pool, admin, task.id, workerClaim.id, { reason: '交接工作' });
    expect((await getTaskDetail(pool, other, task.id)).submissions[0].id).toBe(submission.id);
    const revised = await submitWork(pool, other, task.id, { content: '已完善' });
    expect((await getTaskDetail(pool, worker, task.id)).submissions.map(s => s.id)).toEqual([submission.id]);
    await taskService.removeClaim(pool, admin, task.id, otherClaim.id, { reason: '重新组队' });
    expect((await getTaskDetail(pool, admin, task.id)).task).toMatchObject({ team_locked: false, claimed_count: 0 });
    expect((await rows(pool, 'SELECT status FROM submissions WHERE id=$1', [revised.id]))[0].status).toBe('voided');
    await claimTask(pool, outsider, task.id);
    expect((await getTaskDetail(pool, outsider, task.id)).submissions).toHaveLength(0);
    await expect(downloadAttachment(pool, outsider, oldAttachment.id)).rejects.toMatchObject({ status: 403 });
    const next = await submitWork(pool, outsider, task.id, { content: '新团队新成果' });
    await reviewWork(pool, publisher, next.id, { approve: true, allocations: { [outsider.id]: 100 } });
  });

  it('指定任务有移除空缺时可补充名单，禁止恢复被移除者并审计新增名单', async () => {
    const task = await make({ assignment: { mode: 'assigned', memberIds: [worker.id] } });
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [other.id] })).rejects.toThrow();
    const claim = await claimTask(pool, worker, task.id);
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '更换指定人选' });
    await expect(taskService.addTaskRecipients(pool, other, task.id, { memberIds: [other.id] })).rejects.toMatchObject({ status: 403 });
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [worker.id] })).rejects.toThrow('移除');
    await pool.query('UPDATE users SET active=false WHERE id=$1', [outsider.id]);
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [outsider.id] })).rejects.toThrow();
    await taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [other.id, other.id] });
    expect((await getTaskDetail(pool, admin, task.id)).recipients.map(r => r.id).sort()).toEqual([worker.id, other.id].sort());
    expect((await rows(pool, "SELECT details FROM audit_log WHERE action='task.add-recipients' AND target_id=$1", [task.id]))[0].details).toEqual({ memberIds: [other.id] });
    await expect(editTask(pool, publisher, task.id, input())).rejects.toThrow('锁定');
    await claimTask(pool, other, task.id);
  });

  it('非指定和锁定团队不可补招，已通过、已退出、已取消及结束任务不可移除', async () => {
    const task = await make({ capacity: 2 });
    const claim = await claimTask(pool, worker, task.id);
    const submission = await submitWork(pool, worker, task.id, { content: '完成了' });
    await reviewWork(pool, publisher, submission.id, { approve: true });
    await expect(taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '不能撤回验收' })).rejects.toThrow();
    const withdrawn = await claimTask(pool, other, task.id);
    await withdrawTask(pool, other, task.id);
    await expect(taskService.removeClaim(pool, admin, task.id, withdrawn.id, { reason: '已退出' })).rejects.toThrow();
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [outsider.id] })).rejects.toThrow();
    const team = await make({ mode: 'team', capacity: 2, assignment: { mode: 'assigned', memberIds: [worker.id, other.id] } });
    const one = await claimTask(pool, worker, team.id); await claimTask(pool, other, team.id);
    await submitWork(pool, worker, team.id, { content: '团队成果' });
    await taskService.removeClaim(pool, admin, team.id, one.id, { reason: '保留团队交付' });
    await expect(taskService.addTaskRecipients(pool, admin, team.id, { memberIds: [outsider.id] })).rejects.toThrow();
    await finishTask(pool, publisher, team.id, 'cancel');
    const two = (await getTaskDetail(pool, admin, team.id)).claims.find(c => c.user_id === other.id)!;
    await expect(taskService.removeClaim(pool, admin, team.id, two.id, { reason: '已取消' })).rejects.toThrow();
  });

  it('移除与验收并发只能生效一种结果，不会向已移除者发奖', async () => {
    for (let index = 0; index < 3; index++) {
      const task = await make(); const claim = await claimTask(pool, worker, task.id);
      const submission = await submitWork(pool, worker, task.id, { content: '并发处理' });
      const results = await Promise.allSettled([
        taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '并发移除' }),
        reviewWork(pool, publisher, submission.id, { approve: true }),
      ]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      const [current] = await rows(pool, 'SELECT status FROM claims WHERE id=$1', [claim.id]);
      expect(await rows(pool, 'SELECT * FROM rewards WHERE claim_id=$1', [claim.id])).toHaveLength(current.status === 'removed' ? 0 : 1);
    }
  });

  it('原因2000字可保存，补位名单按最终去重总数限制100人', async () => {
    const task = await make({ assignment: { mode: 'assigned', memberIds: [worker.id] } });
    const claim = await claimTask(pool, worker, task.id);
    await taskService.removeClaim(pool, admin, task.id, claim.id, { reason: '原'.repeat(2000) });
    await pool.query("INSERT INTO users(id,username,name,password_hash,role,must_change_password) SELECT 'replacement-'||n,'replacement.'||n,'补位'||n,$1,'member',false FROM generate_series(1,100) n", [passwordHash]);
    const ids = Array.from({ length: 99 }, (_, index) => `replacement-${index + 1}`);
    await taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [...ids, ...ids] });
    expect((await getTaskDetail(pool, admin, task.id)).recipients).toHaveLength(100);
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: ['replacement-100'] })).rejects.toThrow('100');
    await expect(taskService.addTaskRecipients(pool, admin, task.id, { memberIds: [...ids, 'extra-1', 'extra-2'] })).rejects.toThrow('100');
  });

  it('迁移009保留旧团队交付并回填成员范围，不扩大其他成员访问权限', async () => {
    const schema = `legacy_${randomUUID().replaceAll('-', '')}`;
    await pool.query(`CREATE SCHEMA ${schema}`);
    const legacy = new Pool({ connectionString: 'postgres://postgres:test-only-password@127.0.0.1:55439/postgres', options: `-c search_path=${schema}`, max: 1 });
    try {
      await legacy.query('CREATE TABLE schema_migrations(version text PRIMARY KEY,applied_at timestamptz DEFAULT now())');
      for (const file of (await readdir('db')).filter(file => /^00[1-8]-.*\.sql$/.test(file)).sort()) {
        await legacy.query(await readFile(path.join('db', file), 'utf8'));
        await legacy.query('INSERT INTO schema_migrations(version) VALUES($1)', [file.slice(0, 3)]);
      }
      await legacy.query('INSERT INTO users SELECT * FROM public.users');
      await legacy.query("INSERT INTO tasks(id,publisher_id,title,description,criteria,mode,reward_type,reward_units,capacity,team_locked) VALUES('legacy-team',$1,'旧团队任务','已有内容','已有要求','team','points',100,2,true)", [publisher.id]);
      await legacy.query("INSERT INTO claims(id,task_id,user_id,status,submitted_before,created_at) VALUES('legacy-a','legacy-team',$1,'submitted',true,now()-interval '1 hour'),('legacy-b','legacy-team',$2,'submitted',true,now()-interval '1 hour')", [worker.id, other.id]);
      await legacy.query("INSERT INTO submissions(id,task_id,claim_id,submitter_id,content) VALUES('legacy-submission','legacy-team',NULL,$1,'旧团队已有成果')", [worker.id]);
      await migrate(legacy);
      expect(await rows(legacy, 'SELECT claim_id FROM submission_members ORDER BY claim_id')).toEqual([{ claim_id: 'legacy-a' }, { claim_id: 'legacy-b' }]);
      expect((await getTaskDetail(legacy, other, 'legacy-team')).submissions[0]).toMatchObject({ id: 'legacy-submission', content: '旧团队已有成果', status: 'pending' });
      expect((await getTaskDetail(legacy, outsider, 'legacy-team')).submissions).toHaveLength(0);
      expect((await getTaskDetail(legacy, admin, 'legacy-team')).claims.every(claim => claim.status === 'submitted')).toBe(true);
    } finally { await legacy.end(); await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
  });
});

it('仅管理员可以删除已完成悬赏，奖励、积分流水与榜单仍保留', async () => {
  const task = await createTask(pool, publisher, input({ title: '历史归档测试' }), [zip()]);
  await expect(taskService.removeCompletedTask(pool, admin, task.id)).rejects.toMatchObject({ status: 409 });
  const detail = await getTaskDetail(pool, publisher, task.id);
  await claimTask(pool, worker, task.id);
  const submission = await submitWork(pool, worker, task.id, { content: '已完成归档' });
  await reviewWork(pool, publisher, submission.id, { approve: true });
  await expect(taskService.removeCompletedTask(pool, worker, task.id)).rejects.toMatchObject({ status: 403 });
  await taskService.removeCompletedTask(pool, admin, task.id);
  await expect(getTaskDetail(pool, admin, task.id)).rejects.toMatchObject({ status: 404 });
  await expect(downloadAttachment(pool, worker, detail.attachments[0].id)).rejects.toMatchObject({ status: 404 });
  expect(await listTasks(pool, { status: 'completed' })).toEqual([]);
  expect(await taskService.listRewards(pool, worker)).toEqual([expect.objectContaining({ units: 100, task_removed: true })]);
  expect((await getWallet(pool, worker.id)).entries).toContainEqual(expect.objectContaining({ kind: 'reward', amount: 100 }));
  expect(await listPointsLeaders(pool)).toContainEqual(expect.objectContaining({ id: worker.id, points: 100 }));
});

it('搜索并关联可见的已完成任务，删除后从搜索与引用中隐藏', async () => {
  const reference = await make({ title: '实验报告汇总' });
  const unfinished = await make({ title: '实验报告初稿' });
  await finishTask(pool, publisher, reference.id, 'complete');
  expect(await taskService.searchTaskReferences(pool, '实验报告')).toEqual([{ id: reference.id, title: reference.title }]);
  await expect(make({ referenceIds: [unfinished.id] })).rejects.toThrow('已完成');
  const task = await make({ referenceIds: [reference.id] });
  await editTask(pool, publisher, task.id, input({}));
  expect((await getTaskDetail(pool, worker, task.id)).references).toEqual([{ id: reference.id, title: reference.title }]);
  await taskService.removeCompletedTask(pool, admin, reference.id);
  expect(await taskService.searchTaskReferences(pool, '实验报告')).toEqual([]);
  expect((await getTaskDetail(pool, worker, task.id)).references).toEqual([]);
});

it('奖励反馈每人一票，可改选或撤回，只有发布者能看汇总', async () => {
  const task = await make();
  await expect(taskService.setRewardVote(pool, publisher, task.id, { vote: 'high' })).rejects.toMatchObject({ status: 403 });
  await taskService.setRewardVote(pool, worker, task.id, { vote: 'low' });
  await taskService.setRewardVote(pool, worker, task.id, { vote: 'high' });
  await taskService.setRewardVote(pool, other, task.id, { vote: 'low' });
  expect((await listTasks(pool, { userId: worker.id }))[0]).toMatchObject({ reward_vote: 'high', low_votes: null, high_votes: null });
  expect((await getTaskDetail(pool, publisher, task.id)).task).toMatchObject({ low_votes: 1, high_votes: 1 });
  await taskService.setRewardVote(pool, worker, task.id, { vote: null });
  expect((await getTaskDetail(pool, publisher, task.id)).task).toMatchObject({ low_votes: 1, high_votes: 0 });
  await finishTask(pool, publisher, task.id, 'complete');
  await expect(taskService.setRewardVote(pool, worker, task.id, { vote: 'high' })).rejects.toThrow('结束');
});

it('待审核数量分别统计悬赏与注册，审核后归零', async () => {
  const task = await createTask(pool, worker, input({ reward: '1' }));
  await requestRegistration(pool, { username: 'badge.member', name: '待审核成员', password: 'Test-password-2026' }, 'badge-register');
  expect(await taskService.getPendingReviews(pool)).toEqual({ tasks: 1, registrations: 1 });
  await reviewPublication(pool, admin, task.id, { approve: true, version: task.publication_version });
  const [request] = await listRegistrationRequests(pool);
  await reviewRegistration(pool, admin, request.id, false);
  expect(await taskService.getPendingReviews(pool)).toEqual({ tasks: 0, registrations: 0 });
});

it('申请通过后才能以成员身份登录，且只能审批一次', async () => {
  const application = { username: 'New.Member', name: '新成员', password: 'Test-password-2026', role: 'admin' };
  await requestRegistration(pool, application, 'register');
  await expect(requestRegistration(pool, application, 'register')).rejects.toMatchObject({ status: 409 });
  await expect(login(pool, application.username, application.password, 'login')).rejects.toMatchObject({ status: 401 });
  const [pending] = await listRegistrationRequests(pool);
  expect(pending).toEqual({ id: expect.any(String), username: 'new.member', name: '新成员' });
  await expect(reviewRegistration(pool, worker, pending.id, true)).rejects.toMatchObject({ status: 403 });
  const results = await Promise.allSettled([
    reviewRegistration(pool, admin, pending.id, true),
    reviewRegistration(pool, admin, pending.id, true),
  ]);
  expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
  const { user } = await login(pool, application.username, application.password, 'login');
  expect(user).toMatchObject({ role: 'member', active: true, must_change_password: false });
  expect(await listRegistrationRequests(pool)).toEqual([]);
});

it('拒绝申请后不会创建账号，并允许重新申请', async () => {
  const application = { username: 'new.member', name: '新成员', password: 'Test-password-2026' };
  await requestRegistration(pool, application, 'register');
  const [pending] = await listRegistrationRequests(pool);
  await reviewRegistration(pool, admin, pending.id, false);
  await expect(login(pool, application.username, application.password, 'login')).rejects.toMatchObject({ status: 401 });
  await requestRegistration(pool, application, 'register');
  expect(await listRegistrationRequests(pool)).toHaveLength(1);
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
  const task = await createTask(pool, other, input({ capacity: 2, reward: '40', tags: ['分析', ' 脚本 '] }));
  expect(await getWallet(pool, other.id)).toMatchObject({ balance: 20, reserved: 80, unlimited: false });
  await expect(createTask(pool, other, input({ reward: '21' }))).rejects.toMatchObject({ status: 409 });
  await expect(editTask(pool, admin, task.id, input({ reward: '101' }))).rejects.toMatchObject({ status: 409 });
  await reviewPublication(pool, admin, task.id, { approve: true, version: task.publication_version });
  expect((await listTasks(pool, { q: '脚本' }))[0].tags).toEqual(expect.arrayContaining(['分析', '脚本']));
  await claimTask(pool, worker, task.id);
  const submission = await submitWork(pool, worker, task.id, { content: '完成交付' });
  await reviewWork(pool, admin, submission.id, { approve: true });
  await finishTask(pool, admin, task.id, 'complete');
  expect(await getWallet(pool, other.id)).toMatchObject({ balance: 60, reserved: 0 });
  expect(await getWallet(pool, worker.id)).toMatchObject({ balance: 140, reserved: 0 });
});

it('管理员悬赏由平台发奖，降级后只影响后续发布和编辑', async () => {
  const task = await createTask(pool, publisher, input({ reward: '50000' }));
  const editable = await createTask(pool, publisher, input({ reward: '50000' }));
  expect(await getWallet(pool, publisher.id)).toMatchObject({ unlimited: true, reserved: 0 });
  await updateAccount(pool, admin, publisher.id, { role: 'member' });
  expect(await getWallet(pool, publisher.id)).toMatchObject({ unlimited: false, reserved: 0 });
  await expect(editTask(pool, admin, editable.id, input({ reward: '50000' }))).rejects.toMatchObject({ status: 409 });
  await claimTask(pool, worker, task.id);
  const submission = await submitWork(pool, worker, task.id, { content: '完成交付' });
  await reviewWork(pool, admin, submission.id, { approve: true });
  expect(await getWallet(pool, worker.id)).toMatchObject({ balance: 50100 });
  expect((await getWallet(pool, publisher.id)).entries.every(entry => !['reserve', 'refund'].includes(entry.kind))).toBe(true);
});

it('成员升为管理员后，编辑悬赏退回原预留并切换为平台出资', async () => {
  const task = await createTask(pool, worker, input({ reward: '80' }));
  await updateAccount(pool, admin, worker.id, { role: 'admin' });
  await editTask(pool, admin, task.id, input({ reward: '50000' }));
  expect(await getWallet(pool, worker.id)).toMatchObject({ balance: 100, reserved: 0, unlimited: true });
});

it('推荐人选公开可见且不限制领取', async () => {
  const task = await make({ assignment: { mode: 'recommended', memberIds: [worker.id] } });
  expect((await getTaskDetail(pool, other, task.id)).recipients).toEqual([{ id: worker.id, name: worker.name }]);
  await expect(claimTask(pool, other, task.id)).resolves.toMatchObject({ user_id: other.id });
});

it('仅指定对象可以抢名额，旧客户端编辑保留名单，首次领取后锁定', async () => {
  const task = await make({ assignment: { mode: 'assigned', memberIds: [worker.id, other.id] } });
  await editTask(pool, publisher, task.id, input({ reward: '80' }));
  expect((await getTaskDetail(pool, publisher, task.id)).recipients.map(member => member.id)).toEqual([other.id, worker.id]);
  expect(await getTaskDetail(pool, worker, task.id)).toMatchObject({ recipients: [], task: { assignment_mode: 'assigned', selected_for_viewer: true } });
  expect((await listTasks(pool, { userId: worker.id }))[0]).toMatchObject({ selected_for_viewer: true });
  await expect(claimTask(pool, outsider, task.id)).rejects.toMatchObject({ status: 403 });
  const claims = await Promise.allSettled([claimTask(pool, worker, task.id), claimTask(pool, other, task.id)]);
  expect(claims.filter(result => result.status === 'fulfilled')).toHaveLength(1);
  await expect(editTask(pool, publisher, task.id, input({ assignment: { mode: 'public', memberIds: [] } }))).rejects.toThrow('已锁定');
});

it('拒绝空名单、重复、停用、发布者本人和过多指定名额', async () => {
  await updateAccount(pool, admin, outsider.id, { active: false });
  for (const memberIds of [[], [worker.id, worker.id], [outsider.id], [publisher.id], ['missing']]) {
    await expect(make({ assignment: { mode: 'assigned', memberIds } })).rejects.toThrow();
  }
  await expect(make({ capacity: 2, assignment: { mode: 'assigned', memberIds: [worker.id] } })).rejects.toThrow('指定人数');
  const task = await make();
  expect((await getTaskDetail(pool, worker, task.id)).task.assignment_mode).toBe('public');
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
  it('积分榜显示十位成员，并在截取处稳定排序', async () => {
    const task = await make();
    await pool.query(`WITH entrants AS (
      INSERT INTO users(id,username,name,password_hash,role)
      SELECT 'rank-'||n,'rank-'||n,'同分成员',$1,'member'
      FROM generate_series(10,21) n RETURNING id
    ), entries AS (
      INSERT INTO claims(id,task_id,user_id,status)
      SELECT 'claim-'||id,$2,id,'accepted' FROM entrants RETURNING id,user_id
    )
    INSERT INTO rewards(id,task_id,claim_id,user_id,reward_type,units)
    SELECT 'reward-'||id,$2,id,user_id,'points',10 FROM entries`, [passwordHash, task.id]);
    const leaders = await listPointsLeaders(pool);
    expect(leaders.map(({ id, rank }) => [id, rank])).toEqual(
      Array.from({ length: 10 }, (_, index) => [`rank-${index + 10}`, 1]),
    );
  });
  it('积分榜累计已验收奖励、同分并列并排除停用成员和金额奖励', async () => {
    async function award(member: User, reward: string, reward_type = 'points') {
      const task = await make({ reward, reward_type });
      await claimTask(pool, member, task.id);
      const submission = await submitWork(pool, member, task.id, { content: '完成交付' });
      await reviewWork(pool, publisher, submission.id, { approve: true });
    }
    await award(worker, '40');
    await award(worker, '60');
    await award(other, '100');
    await award(outsider, '200');
    await award(admin, '300', 'money');
    expect((await listPointsLeaders(pool)).map(({ rank, points }) => [rank, points])).toEqual([[1, 200], [2, 100], [2, 100]]);
    await updateAccount(pool, admin, outsider.id, { active: false });
    expect((await listPointsLeaders(pool)).map(({ id, rank, points }) => [id, rank, points])).toEqual([
      [other.id, 1, 100], [worker.id, 1, 100],
    ]);
  });

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
  it('仅管理员可变更他人角色，升降级均撤销旧会话', async () => {
    await expect(updateAccount(pool, worker, other.id, { role: 'admin' })).rejects.toMatchObject({ status: 403 });
    await expect(updateAccount(pool, admin, admin.id, { role: 'member' })).rejects.toThrow();
    const memberSession = await login(pool, worker.username, 'Test-password-2026', 'role-test');
    await updateAccount(pool, admin, worker.id, { role: 'admin' });
    expect(await userForToken(pool, memberSession.token)).toBeNull();
    const adminSession = await login(pool, worker.username, 'Test-password-2026', 'role-test');
    expect(adminSession.user.role).toBe('admin');
    await updateAccount(pool, admin, worker.id, { role: 'member' });
    expect(await userForToken(pool, adminSession.token)).toBeNull();
    expect((await login(pool, worker.username, 'Test-password-2026', 'role-test')).user.role).toBe('member');
  });

  it('并发互相降级时至少保留一名管理员', async () => {
    const results = await Promise.allSettled([
      updateAccount(pool, admin, publisher.id, { role: 'member' }),
      updateAccount(pool, publisher, admin.id, { role: 'member' }),
    ]);
    expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(await rows(pool, "SELECT id FROM users WHERE role='admin' AND active")).toHaveLength(1);
  });

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
