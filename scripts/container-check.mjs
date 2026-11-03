import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';

loadEnvFile('.data/container-check.env');
const base = 'http://localhost:18080', checks = { count: 0 };
const args = project => ['compose', '--env-file', '.data/container-check.env', '-p', project, '-f', 'compose.yaml', '-f', 'compose.test.yaml'];
async function docker(project, command, { input, output } = {}) {
  const child = spawn('docker', [...args(project), ...command], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  child.stderr.on('data', b => { stderr += b.toString(); });
  const exited = new Promise((resolve, reject) => { child.on('error', reject); child.on('close', code => code === 0 ? resolve() : reject(new Error(`Docker ${command[0]} failed: ${stderr.slice(-1200)}`))); });
  const writing = output ? pipeline(child.stdout, createWriteStream(output)) : Promise.resolve();
  if (!output) child.stdout.on('data', b => { stdout += b.toString(); });
  const reading = typeof input === 'string' ? pipeline(createReadStream(input), child.stdin) : (input ? (child.stdin.end(input), Promise.resolve()) : (child.stdin.end(), Promise.resolve()));
  await Promise.all([exited, writing, reading]); return stdout;
}
async function waitFor(fn) { let error; for (let i = 0; i < 45; i++) { try { if (await fn()) return; } catch (e) { error = e; } await new Promise(r => setTimeout(r, 1000)); } throw error ?? new Error('容器就绪等待超时'); }
async function request(route, cookie = '', method = 'GET', data, expected = 200) {
  const response = await fetch(`${base}/api/${route}`, { method, headers: { Origin: base, ...(cookie ? { Cookie: cookie } : {}), ...(data instanceof FormData ? {} : { 'Content-Type': 'application/json' }) }, body: data === undefined ? undefined : data instanceof FormData ? data : JSON.stringify(data) });
  assert.equal(response.status, expected, `${route}: ${response.status === expected ? '' : await response.text()}`); checks.count++; return response;
}
async function login(username, password) { const r = await request('auth/login', '', 'POST', { username, password }); const cookie = r.headers.get('set-cookie')?.split(';')[0]; assert.ok(cookie); return cookie; }

await waitFor(async () => (await fetch(`${base}/api/health`)).ok);
await request('tasks', '', 'GET', undefined, 401);
const statePath = '.data/container-check-state.json';
let state;
try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
let adminPassword = state?.password ?? process.env.ADMIN_PASSWORD;
let admin = await login('admin', adminPassword);
if (!state) {
  const password = randomBytes(12).toString('hex');
  await request('me/password', admin, 'POST', { oldPassword: adminPassword, newPassword: password });
  adminPassword = password; state = { password }; await writeFile(statePath, JSON.stringify(state), { mode: 0o600 });
  admin = await login('admin', password);
}
const workerName = `worker.${randomBytes(5).toString('hex')}`, initialPassword = randomBytes(12).toString('hex'), password = randomBytes(12).toString('hex');
await request('users', admin, 'POST', { username: workerName, name: '容器验收成员', password: initialPassword, role: 'member' }, 201);
let worker = await login(workerName, initialPassword);
await request('tasks', worker, 'GET', undefined, 403);
await request('me/password', worker, 'POST', { oldPassword: initialPassword, newPassword: password });
worker = await login(workerName, password);
const form = new FormData(); form.set('data', JSON.stringify({ title: '容器验收示例：验证持久化与恢复', description: '用于实际Linux容器的重启和备份恢复验证。', criteria: '数据库和附件完整保留。', mode: 'independent', reward_type: 'points', reward: '25', capacity: 1 }));
const zipBytes = Buffer.from([80, 75, 5, 6, ...Array(18).fill(0)]);
form.append('files', new File([zipBytes], '容器附件.zip', { type: 'application/zip' }));
const task = (await (await request('tasks', admin, 'POST', form, 201)).json()).task;
await request(`tasks/${task.id}/claim`, worker, 'POST', {});
const submission = (await (await request(`tasks/${task.id}/submit`, worker, 'POST', { content: '已完成真实容器验收工作' }, 201)).json()).submission;
await request(`submissions/${submission.id}/review`, admin, 'POST', { approve: true });
let detail = await (await request(`tasks/${task.id}`, admin)).json();
assert.equal(detail.task.status, 'completed'); assert.equal(detail.rewards[0].units, 25); checks.count += 2;
const attachmentId = detail.attachments[0].id;
assert.deepEqual(Buffer.from(await (await request(`attachments/${attachmentId}`, worker)).arrayBuffer()), zipBytes); checks.count++;
console.log('容器全流程通过，开始重启验证。');
await docker('bounty-check', ['restart', 'db', 'app', 'cleanup', 'caddy']);
await waitFor(async () => (await fetch(`${base}/api/health`)).ok);
detail = await (await request(`tasks/${task.id}`, admin)).json(); assert.equal(detail.rewards[0].units, 25); checks.count++;
assert.deepEqual(Buffer.from(await (await request(`attachments/${attachmentId}`, worker)).arrayBuffer()), zipBytes); checks.count++;

console.log('重启后数据与会话保留，开始数据库和附件备份恢复。');
await mkdir('.data/container-backup', { recursive: true });
await docker('bounty-check', ['stop', 'app', 'cleanup']);
try {
  await docker('bounty-check', ['exec', '-T', 'db', 'pg_dump', '-U', 'bounty', '-d', 'bounty', '-Fc'], { output: '.data/container-backup/database.dump' });
  await docker('bounty-check', ['run', '--rm', '--no-deps', '--entrypoint', 'tar', 'app', '-C', '/app/data', '-czf', '-', 'uploads'], { output: '.data/container-backup/uploads.tar.gz' });
} finally { await docker('bounty-check', ['start', 'app', 'cleanup']); }
await docker('bounty-restore-check', ['up', '-d', 'db']);
await waitFor(async () => { try { await docker('bounty-restore-check', ['exec', '-T', 'db', 'pg_isready', '-U', 'bounty', '-d', 'bounty']); return true; } catch { return false; } });
// 仅测试用的固定恢复库，可重复执行；清理目标限定在独立的测试项目卷。
await docker('bounty-restore-check', ['exec', '-T', 'db', 'pg_restore', '--clean', '--if-exists', '--no-owner', '-U', 'bounty', '-d', 'bounty'], { input: '.data/container-backup/database.dump' });
await docker('bounty-restore-check', ['run', '--rm', '--no-deps', '--entrypoint', 'sh', 'app', '-c', 'mkdir -p /app/data/uploads && tar -xzf - -C /app/data'], { input: '.data/container-backup/uploads.tar.gz' });
await docker('bounty-restore-check', ['up', '-d', 'app', 'cleanup']);
await waitFor(async () => { try { return (await docker('bounty-restore-check', ['exec', '-T', 'app', 'node', '-e', "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1))"])).trim() === ''; } catch { return false; } });
const verification = `import assert from 'node:assert/strict'; const headers={Cookie:${JSON.stringify(admin)}}; const r=await fetch('http://127.0.0.1:3000/api/tasks/${task.id}',{headers}); assert.equal(r.status,200); const d=await r.json(); assert.equal(d.task.status,'completed'); assert.equal(d.rewards[0].units,25); const f=await fetch('http://127.0.0.1:3000/api/attachments/${attachmentId}',{headers}); assert.equal(Buffer.from(await f.arrayBuffer()).toString('hex'),${JSON.stringify(zipBytes.toString('hex'))}); console.log('恢复后的任务、奖励、账号会话与附件均正常。');`;
console.log((await docker('bounty-restore-check', ['exec', '-T', 'app', 'node', '--input-type=module'], { input: Buffer.from(verification) })).trim()); checks.count += 4;
await writeFile('.data/container-check-result.json', JSON.stringify({ passed: true, checks: checks.count, verified: ['fresh-start', 'login', 'workflow', 'restart', 'backup', 'restore'], at: new Date().toISOString() }, null, 2));
await docker('bounty-check', ['stop']); await docker('bounty-restore-check', ['stop']);
console.log(`容器验收完成：${checks.count}项检查通过。测试容器已停止，数据卷与备份保留。`);
