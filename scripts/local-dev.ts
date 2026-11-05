import EmbeddedPostgres from 'embedded-postgres';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { spawn } from 'node:child_process';
import { getPool, migrate, rows } from '../src/lib/db';
import { hashPassword } from '../src/lib/auth';
import { createTask } from '../src/lib/tasks';
import { recordPoints } from '../src/lib/wallet';
import type { User } from '../src/lib/types';

await mkdir('.data', { recursive: true });
if (!existsSync('.env.local')) {
  const dbPassword = randomBytes(20).toString('hex'), adminPassword = randomBytes(12).toString('hex');
  await writeFile('.env.local', `DATABASE_URL=postgres://postgres:${dbPassword}@127.0.0.1:54329/bounty\nLOCAL_DATABASE_PASSWORD=${dbPassword}\nAPP_ORIGIN=http://127.0.0.1:3000\nCOOKIE_SECURE=false\nTRUST_PROXY=false\nUPLOAD_DIR=.data/uploads\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${adminPassword}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile('.data/初始管理员.txt', `仅用于本地开发\n地址：http://localhost:3000\n账号：admin\n初始密码：${adminPassword}\n首次登录后必须修改密码。请勿将本文件上传到服务器或提交到版本库。\n`, { mode: 0o600, flag: 'wx' });
}
loadEnvFile('.env.local');
const serve = process.argv.includes('--serve');
if (serve) {
  if (!existsSync('.next/standalone/server.js')) throw new Error('请先运行 npm run build，再启动本地生产预览。');
  await cp('.next/static', '.next/standalone/.next/static', { recursive: true });
  await cp('public', '.next/standalone/public', { recursive: true });
}
const url = new URL(process.env.DATABASE_URL!);
if (url.hostname !== '127.0.0.1' || url.port !== '54329' || !process.env.LOCAL_DATABASE_PASSWORD) throw new Error('dev:local 仅用于本地内嵌数据库。外部数据库请使用 npm run dev。');
const postgres = new EmbeddedPostgres({ databaseDir: '.data/local-postgres', user: 'postgres', password: process.env.LOCAL_DATABASE_PASSWORD, port: 54329, persistent: true, autoRehydrateSymlinks: true, postgresFlags: ['-h', '127.0.0.1'], onLog: () => {}, onError: message => console.error(message) });
if (!existsSync('.data/local-postgres/PG_VERSION')) await postgres.initialise();
await postgres.start();
const client = postgres.getPgClient(); await client.connect();
if (!(await client.query('SELECT 1 FROM pg_database WHERE datname=$1', ['bounty'])).rows.length) await postgres.createDatabase('bounty');
await client.end();
const pool = getPool(); await migrate(pool);
process.env.BOUNTY_IMPORT_ONLY = 'true'; const { initAdmin } = await import('./init-admin'); await initAdmin();
if (process.argv.includes('--demo') && !(await rows(pool, "SELECT id FROM users WHERE username='demo'")).length) {
  const password = randomBytes(12).toString('hex'), demoId = randomUUID(), ownerId = randomUUID();
  const hash = await hashPassword(password);
  const [demo] = await rows<User>(pool, "INSERT INTO users(id,username,name,password_hash,role,must_change_password) VALUES($1,'demo','演示管理员',$2,'admin',false) RETURNING *", [demoId, hash]);
  const [owner] = await rows<User>(pool, "INSERT INTO users(id,username,name,password_hash,role,must_change_password,active) VALUES($1,'sample.owner','演示发布者',$2,'admin',false,false) RETURNING *", [ownerId, await hashPassword(randomBytes(32).toString('hex'))]);
  await recordPoints(pool, owner.id, 'demo-seed', 'legacy', 3000);
  const examples = [
    { title: '整理产品使用手册与常见问题', description: '汇总现有的产品说明和客户反馈，整理一份结构清晰、方便检索的使用手册。这是用于体验流程的本地示例任务。', criteria: '交付一份包含操作步骤、截图和常见问题的文档；目录完整，内容准确。', reward_type: 'money', reward: '300', capacity: 1, mode: 'independent' },
    { title: '一起完善团队知识库', description: '把各自熟悉的工作流程整理成文档，帮助新伙伴更快上手。每人独立提交一篇。这是本地示例任务。', criteria: '文档包含适用场景、操作步骤与常见问题；可以按照说明独立完成操作。', reward_type: 'points', reward: '150', capacity: 5, mode: 'independent' },
    { title: '协作完成季度项目复盘', description: '组建一个小团队，梳理季度项目的成果、问题和后续行动，共同交付一份复盘报告。这是本地示例任务。', criteria: '报告包含数据依据、经验总结和可跟进的行动清单；团队共同确认成果。', reward_type: 'money', reward: '1200', capacity: 3, mode: 'team' },
    { title: '为内部工具提交一份改进建议', description: '体验团队日常使用的工具，提出一个具体的改进点，并说明预期效果。这是本地示例任务。', criteria: '建议描述清楚现有问题，附可复现步骤和可行的改进方案。', reward_type: 'points', reward: '80', capacity: 8, mode: 'independent' },
    { title: '整理一套新成员入职资料', description: '与伙伴共同整理入职须知、常用入口和第一周的工作指引。这是本地示例任务。', criteria: '所有资料链接有效，内容易读，能够帮助新成员完成第一周的准备。', reward_type: 'points', reward: '500', capacity: 3, mode: 'team' },
    { title: '检查并补齐项目资料归档', description: '检查项目目录中的文件是否完整，按约定的分类方式整理，补充索引说明。这是本地示例任务。', criteria: '完成文件分类、重复项检查，交付一份清晰的资料索引。', reward_type: 'money', reward: '200', capacity: 2, mode: 'independent' },
  ];
  for (const example of examples) { const task = await createTask(pool, owner, example); await pool.query('UPDATE tasks SET is_demo=true WHERE id=$1', [task.id]); }
  await writeFile('.data/演示账号.txt', `仅用于本地演示，不会进入Docker生产环境。\n账号：${demo.username}\n密码：${password}\n`, { mode: 0o600, flag: 'wx' });
}
await pool.end();
console.log('本地数据库已就绪。初始账号见 .data/初始管理员.txt；演示账号（如启用）见 .data/演示账号.txt。');
const serverArgs = serve ? ['.next/standalone/server.js'] : ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1'];
const serverEnv = { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3000', UPLOAD_DIR: resolve(process.env.UPLOAD_DIR ?? 'data/uploads') };
const child = spawn(process.execPath, serverArgs, { stdio: 'inherit', env: serverEnv });
const cleanup = spawn(process.execPath, ['--import', 'tsx', 'scripts/cleanup.ts'], { stdio: 'inherit', env: { ...process.env } });
let stopped = false;
async function stop() { if (stopped) return; stopped = true; child.kill(); cleanup.kill(); await postgres.stop(); }
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
child.on('exit', async () => { await stop(); });
