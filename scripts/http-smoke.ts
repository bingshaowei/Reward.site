import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { getPool } from '../src/lib/db';

loadEnvFile('.env.local');
const base = process.env.APP_ORIGIN!;
assert.ok(['localhost', '127.0.0.1'].includes(new URL(base).hostname), '仅允许在本机演示环境运行');
const text = await readFile('.data/演示账号.txt', 'utf8');
const demoPassword = text.match(/密码：(.*)/)?.[1]?.trim(); assert.ok(demoPassword);
let checks = 0;
async function request(route: string, cookie = '', method = 'GET', data?: unknown, status = 200, origin = base) {
  const r = await fetch(`${base}/api/${route}`, { method, headers: { Origin: origin, ...(cookie ? { Cookie: cookie } : {}), ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data), redirect: 'manual' });
  assert.equal(r.status, status, `${method} ${route}: ${r.status} ${status !== r.status ? await r.text() : ''}`); checks++;
  return r;
}
async function signIn(username: string, password: string) { const r = await request('auth/login', '', 'POST', { username, password }); const cookie = r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return cookie; }
await request('tasks', '', 'GET', undefined, 401);
await request('auth/login', '', 'POST', { username: 'demo', password: demoPassword }, 403, 'https://untrusted.example');
const admin = await signIn('demo', demoPassword);
const stamp = randomBytes(5).toString('hex'), people: { id: string; cookie: string }[] = [];
for (const role of ['publisher', 'worker', 'other', 'outsider']) {
  const username = `test.${role}.${stamp}`, initial = randomBytes(10).toString('hex'), changed = randomBytes(10).toString('hex');
  const r = await request('users', admin, 'POST', { username, name: `本地验收${role}`, password: initial, role: 'member' }, 201);
  const { user } = await r.json(); let cookie = await signIn(username, initial);
  await request('tasks', cookie, 'GET', undefined, 403);
  await request('me/password', cookie, 'POST', { oldPassword: initial, newPassword: changed });
  await request('me', cookie, 'GET', undefined, 401);
  cookie = await signIn(username, changed); people.push({ id: user.id, cookie });
}
const [publisher, worker, other, outsider] = people;
const createBody = (mode: string, capacity: number, reward_type = 'points', reward = '80') => ({ title: `接口验收示例 · ${mode}`, description: '仅用于验证本机完整流程的示例工作。', criteria: '提交完整成果并通过验收。', mode, capacity, reward_type, reward });
const form = new FormData(); form.set('data', JSON.stringify(createBody('independent', 1))); form.append('files', new File([new Uint8Array([80, 75, 5, 6, ...Array(18).fill(0)])], '工作说明.zip', { type: 'application/zip' }));
const { task } = await (await request('tasks', publisher.cookie, 'POST', form, 201)).json();
await request(`tasks/${task.id}/publication-review`, admin, 'POST', { approve: true, version: task.publication_version });
await getPool().query('UPDATE tasks SET is_demo=true WHERE id=$1', [task.id]);
const claims = await Promise.all([request(`tasks/${task.id}/claim`, worker.cookie, 'POST', {}, 200).then(() => true).catch(() => false), request(`tasks/${task.id}/claim`, other.cookie, 'POST', {}, 200).then(() => true).catch(() => false)]);
assert.equal(claims.filter(Boolean).length, 1); checks++;
const assignee = claims[0] ? worker : other;
const upload = new FormData(); upload.set('data', JSON.stringify({ content: '已完成成果，附交付文件。' })); upload.append('files', new File(['delivery body'], '交付.txt', { type: 'text/plain' }));
const { submission } = await (await request(`tasks/${task.id}/submit`, assignee.cookie, 'POST', upload, 201)).json();
const detail = await (await request(`tasks/${task.id}`, publisher.cookie)).json();
const attachment = detail.attachments.find((a: { submission_id: string }) => a.submission_id === submission.id);
await request(`attachments/${attachment.id}`, outsider.cookie, 'GET', undefined, 403);
assert.equal(await (await request(`attachments/${attachment.id}`, assignee.cookie)).text(), 'delivery body'); checks++;
await request(`submissions/${submission.id}/review`, publisher.cookie, 'POST', { approve: false, note: '补充说明' });
const s2 = (await (await request(`tasks/${task.id}/submit`, assignee.cookie, 'POST', { content: '已补充说明' }, 201)).json()).submission;
await request(`submissions/${s2.id}/review`, publisher.cookie, 'POST', { approve: true });
await request(`submissions/${s2.id}/review`, publisher.cookie, 'POST', { approve: true }, 400);
await request('tasks', publisher.cookie, 'POST', createBody('team', 3, 'money', '19.99'), 403);
const team = (await (await request('tasks', admin, 'POST', createBody('team', 3, 'money', '19.99'), 201)).json()).task;
await getPool().query('UPDATE tasks SET is_demo=true WHERE id=$1', [team.id]);
await request(`tasks/${team.id}/claim`, worker.cookie, 'POST', {}); await request(`tasks/${team.id}/claim`, other.cookie, 'POST', {});
const teamSubmission = (await (await request(`tasks/${team.id}/submit`, worker.cookie, 'POST', { content: '团队成果' }, 201)).json()).submission;
await request(`tasks/${team.id}/claim`, outsider.cookie, 'POST', {}, 400);
await request(`submissions/${teamSubmission.id}/review`, admin, 'POST', { approve: true, allocations: { [worker.id]: 1000, [other.id]: 999 } });
const teamDetail = await (await request(`tasks/${team.id}`, admin)).json();
assert.equal(teamDetail.task.status, 'completed'); assert.equal(teamDetail.rewards.length, 2); checks += 2;
await request(`rewards/${teamDetail.rewards[0].id}/settle`, admin, 'POST', {});
for (const route of ['/tasks', '/workspace', '/admin', '/account', `/tasks/${team.id}`]) { const r = await fetch(`${base}${route}`, { headers: { Cookie: admin } }); assert.equal(r.status, 200); checks++; }
await request(`users/${worker.id}`, admin, 'PATCH', { active: false });
await request('tasks', worker.cookie, 'GET', undefined, 401);
await request('auth/logout', admin, 'POST', {});
await request('me', admin, 'GET', undefined, 401);
await getPool().end();
console.log(`HTTP端到端验证通过：${checks}项检查（登录、首次改密、权限、并发领取、附件、交付、退回、验收、团队分配、结算及页面）。`);
