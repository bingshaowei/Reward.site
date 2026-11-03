import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { getPool, rows } from '@/lib/db';
import { login, logout, userForToken, createAccount, updateAccount, removeAccount, changePassword, publicUserFields } from '@/lib/auth';
import { createTask, editTask, listTasks, claimTask, withdrawTask, submitWork, reviewWork, reviewPublication, finishTask, settleReward, getTaskDetail, listRewards, getOverview } from '@/lib/tasks';
import { downloadAttachment } from '@/lib/files';
import { assertOrigin, ensure, AppError } from '@/lib/rules';
import { SESSION_COOKIE } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ path: string[] }> };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { 'Cache-Control': 'private, no-store' } });
function setSession(response: NextResponse, token: string, maxAge: number) {
  response.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.COOKIE_SECURE === 'true', path: '/', maxAge });
  return response;
}
async function readBody(req: NextRequest) {
  const multipart = req.headers.get('content-type')?.startsWith('multipart/form-data');
  const limit = multipart ? 101 * 1024 * 1024 : 1024 * 1024;
  ensure(Number(req.headers.get('content-length') ?? 0) <= limit, '请求过大，附件合计不得超过100MB', 413);
  const reader = req.body?.getReader(); const parts: Uint8Array[] = []; let length = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength;
      if (length > limit) { await reader.cancel(); throw new AppError('请求内容超过大小限制', 413); }
      parts.push(value);
    }
  }
  const buffer = Buffer.concat(parts);
  try {
    if (multipart) {
      const form = await new Response(buffer, { headers: { 'content-type': req.headers.get('content-type')! } }).formData();
      const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
      ensure(files.length <= 5, '每次最多上传5个附件');
      return { data: JSON.parse(String(form.get('data') ?? '{}')), files };
    }
    return { data: buffer.length ? JSON.parse(buffer.toString('utf8')) : {}, files: [] as File[] };
  } catch (error) { if (error instanceof AppError) throw error; throw new AppError('请求格式无效'); }
}
async function handle(req: NextRequest, context: Context) {
  try {
    const { path } = await context.params, route = path.join('/'), method = req.method;
    const pool = getPool();
    if (method === 'GET' && route === 'health') { await pool.query('SELECT 1'); return json({ ok: true }); }
    if (method !== 'GET') assertOrigin(req.headers.get('origin'), process.env.APP_ORIGIN ?? req.url);
    const token = req.cookies.get(SESSION_COOKIE)?.value;
    if (method === 'POST' && route === 'auth/login') {
      const { data } = await readBody(req);
      const input = z.object({ username: z.string(), password: z.string() }).parse(data);
      const ip = process.env.TRUST_PROXY === 'true' ? req.headers.get('x-real-ip') ?? 'unknown' : 'direct';
      const session = await login(pool, input.username, input.password, ip);
      return setSession(json({ user: session.user }), session.token, 7 * 86400);
    }
    const user = await userForToken(pool, token); ensure(user, '登录已失效，请重新登录', 401);
    if (method === 'POST' && route === 'auth/logout') { await logout(pool, token); return setSession(json({ ok: true }), '', 0); }
    if (method === 'GET' && route === 'me') return json({ user });
    if (method === 'POST' && route === 'me/password') {
      const { data } = await readBody(req);
      const input = z.object({ oldPassword: z.string(), newPassword: z.string() }).parse(data);
      await changePassword(pool, user, input.oldPassword, input.newPassword);
      return setSession(json({ ok: true }), '', 0);
    }
    ensure(!user.must_change_password, '请先修改初始密码', 403);
    if (method === 'GET' && route === 'overview') return json({ overview: await getOverview(pool, user) });
    if (method === 'GET' && route === 'tasks') {
      const p = req.nextUrl.searchParams;
      return json({ tasks: await listTasks(pool, { q: p.get('q') ?? '', status: p.get('status') ?? '', reward: p.get('reward') ?? '', mine: p.get('mine') ?? '', userId: user.id }) });
    }
    if (method === 'POST' && route === 'tasks') {
      const { data, files } = await readBody(req);
      return json({ task: await createTask(pool, user, data, files) }, 201);
    }
    if (path[0] === 'tasks' && path.length === 2) {
      if (method === 'GET') return json(await getTaskDetail(pool, user, path[1]));
      if (method === 'PATCH') { const { data } = await readBody(req); await editTask(pool, user, path[1], data); return json({ ok: true }); }
    }
    if (method === 'POST' && path[0] === 'tasks' && path.length === 3) {
      const id = path[1], action = path[2];
      if (action === 'publication-review') { const { data } = await readBody(req); await reviewPublication(pool, user, id, data); return json({ ok: true }); }
      if (action === 'claim') return json({ claim: await claimTask(pool, user, id) });
      if (action === 'withdraw') { await withdrawTask(pool, user, id); return json({ ok: true }); }
      if (action === 'submit') { const { data, files } = await readBody(req); return json({ submission: await submitWork(pool, user, id, data, files) }, 201); }
      if (action === 'finish') { const { data } = await readBody(req); const input = z.object({ action: z.enum(['complete', 'cancel']) }).parse(data); await finishTask(pool, user, id, input.action); return json({ ok: true }); }
    }
    if (method === 'POST' && path[0] === 'submissions' && path[2] === 'review' && path.length === 3) {
      const { data } = await readBody(req); await reviewWork(pool, user, path[1], data); return json({ ok: true });
    }
    if (method === 'GET' && route === 'rewards') return json({ rewards: await listRewards(pool, user, req.nextUrl.searchParams.get('managed') === 'true') });
    if (method === 'POST' && path[0] === 'rewards' && path[2] === 'settle' && path.length === 3) { await settleReward(pool, user, path[1]); return json({ ok: true }); }
    if (method === 'GET' && path[0] === 'attachments' && path.length === 2) {
      const attachment = await downloadAttachment(pool, user, path[1]);
      return new Response(new Uint8Array(attachment.data), { headers: {
        'Content-Type': attachment.mime,
        'Content-Disposition': `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(attachment.name)}`,
        'Content-Length': String(attachment.data.length), 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    }
    if (route === 'users' || path[0] === 'users') {
      ensure(user.role === 'admin', '仅管理员可以管理账号', 403);
      if (method === 'GET' && route === 'users') return json({ users: await rows(pool, `SELECT ${publicUserFields},created_at FROM users WHERE removed_at IS NULL ORDER BY created_at`) });
      if (method === 'POST' && route === 'users') { const { data } = await readBody(req); return json({ user: await createAccount(pool, user, data) }, 201); }
      if (method === 'PATCH' && path.length === 2) { const { data } = await readBody(req); await updateAccount(pool, user, path[1], data); return json({ ok: true }); }
      if (method === 'DELETE' && path.length === 2) { await removeAccount(pool, user, path[1]); return json({ ok: true }); }
    }
    throw new AppError('接口不存在', 404);
  } catch (error) {
    if (error instanceof AppError) return json({ error: error.message }, error.status);
    if (error instanceof ZodError) return json({ error: error.issues[0]?.message ?? '填写内容无效' }, 400);
    if ((error as { code?: string }).code === '23505') return json({ error: '记录已经存在，请刷新后重试' }, 409);
    console.error('请求处理失败', error instanceof Error ? error.message : 'unknown');
    return json({ error: '服务暂时不可用，请稍后重试或联系管理员' }, 500);
  }
}
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE };
