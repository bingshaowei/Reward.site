import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, unlink, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Pool, PoolClient } from 'pg';
import { rows, transaction, type Db } from './db';
import { ensure, expiryAt, canReadAttachment, AppError } from './rules';
import type { User } from './types';

const maxSize = 20 * 1024 * 1024;
const referenceLimit = 100 * 1024 * 1024;
const archives: Record<string, string> = { '.zip': 'application/zip', '.7z': 'application/x-7z-compressed', '.rar': 'application/vnd.rar' };
const types: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.zip': 'application/zip', '.txt': 'text/plain; charset=utf-8', '.csv': 'text/csv; charset=utf-8' };
export function uploadPath(storageName: string) {
  ensure(/^[a-f0-9-]{36}\.blob$/.test(storageName), '附件路径无效');
  return path.join(/* turbopackIgnore: true */ path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? 'data/uploads'), storageName);
}
async function validateFile(file: File, reference = false) {
  ensure(file && file.size > 0 && file.size <= (reference ? referenceLimit : maxSize), reference ? '参考附件不能为空或超过100MB' : '附件不能为空，且每个文件不得超过20MB');
  ensure(file.name.length <= 200 && !/[\x00-\x1f\\/]/.test(file.name), '文件名过长或包含不支持的字符');
  const ext = path.extname(file.name).toLowerCase();
  const mime = (reference ? archives : types)[ext];
  ensure(mime, reference ? '参考附件仅支持 ZIP、7Z 和 RAR 压缩包' : '仅支持 JPG、PNG、WebP、PDF、DOCX、XLSX、PPTX、TXT、CSV 和 ZIP');
  const data = Buffer.from(await (['.txt', '.csv'].includes(ext) ? file : file.slice(0, 12)).arrayBuffer());
  const hex = data.toString('hex');
  let valid = true;
  if (ext === '.png') valid = hex.startsWith('89504e470d0a1a0a');
  else if (['.jpg', '.jpeg'].includes(ext)) valid = hex.startsWith('ffd8ff');
  else if (ext === '.webp') valid = data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  else if (ext === '.pdf') valid = data.toString('ascii', 0, 5) === '%PDF-';
  else if (ext === '.7z') valid = hex.startsWith('377abcaf271c');
  else if (ext === '.rar') valid = hex.startsWith('526172211a0700') || hex.startsWith('526172211a070100');
  else if (['.zip', '.docx', '.xlsx', '.pptx'].includes(ext)) valid = hex.startsWith('504b0304') || (ext === '.zip' && hex.startsWith('504b0506'));
  else valid = !data.includes(0) && !hex.startsWith('4d5a');
  ensure(valid, '文件内容与扩展名不符，请检查附件');
  return mime;
}
export async function validateFiles(files: File[], reference = false) {
  ensure(files.length <= 5, '每次最多上传5个附件');
  if (reference) ensure(files.reduce((total, file) => total + file.size, 0) <= referenceLimit, '参考附件合计不得超过100MB');
  for (const file of files) await validateFile(file, reference);
}
export async function uploadTransaction<T>(pool: Pool, fn: (db: PoolClient, created: string[]) => Promise<T>): Promise<T> {
  const created: string[] = [];
  try { return await transaction(pool, db => fn(db, created)); }
  catch (error) {
    for (const storage of created) {
      try {
        // COMMIT的响应可能因网络中断丢失，必须先确认没有已提交的元数据。
        if (!(await rows(pool, 'SELECT id FROM attachments WHERE storage_name=$1', [storage])).length) await unlink(uploadPath(storage)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      } catch { console.error('上传回滚回收未完成，等待后续文件对账', storage); }
    }
    throw error;
  }
}
export async function saveAttachment(db: Db, user: User, taskId: string, submissionId: string | null, file: File, created?: string[]) {
  const [task] = await rows(db, 'SELECT * FROM tasks WHERE id=$1', [taskId]); ensure(task, '任务不存在', 404);
  ensure(task.status === 'open', '任务已经结束，不能上传附件');
  if (!submissionId) ensure(task.publisher_id === user.id && !task.first_claimed_at, '仅发布者可在首次领取前上传任务附件', 403);
  else {
    const [s] = await rows(db, "SELECT * FROM submissions WHERE id=$1 AND task_id=$2 AND submitter_id=$3 AND status='pending'", [submissionId, taskId, user.id]);
    ensure(s, '不能为这个成果添加附件', 403);
  }
  const mime = await validateFile(file, !submissionId);
  const id = randomUUID(), storage = `${randomUUID()}.blob`, location = uploadPath(storage);
  await mkdir(path.dirname(location), { recursive: true });
  created?.push(storage);
  try {
    await writeFile(location, Buffer.from(await file.arrayBuffer()), { flag: 'wx', mode: 0o600 });
    const [attachment] = await rows(db, 'INSERT INTO attachments(id,task_id,submission_id,owner_id,name,storage_name,size,mime) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', [id, taskId, submissionId, user.id, file.name, storage, file.size, mime]);
    return attachment;
  } catch (error) { await unlink(location).catch(() => {}); throw error; }
}
export async function downloadAttachment(db: Db, user: User, id: string) {
  const [a] = await rows(db, `SELECT a.*,t.publisher_id,t.ended_at,t.publication_status,
    coalesce((SELECT array_agg(c.user_id) FROM claims c JOIN submissions s ON s.task_id=c.task_id
    WHERE s.id=a.submission_id AND (s.claim_id IS NULL OR c.id=s.claim_id) AND c.status<>'withdrawn'),ARRAY[]::text[]) AS participant_ids
    FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.id=$1`, [id]);
  ensure(a, '附件不存在', 404); ensure(canReadAttachment(user, a as Parameters<typeof canReadAttachment>[1]), '没有权限下载这个附件', 403);
  ensure(a.publication_status === 'approved' || a.publisher_id === user.id || user.role === 'admin', '附件不存在', 404);
  const expiry = expiryAt(a.ended_at);
  ensure(!a.expired_at && (!expiry || expiry.getTime() > Date.now()), '附件保留期已结束，文件已过期', 410);
  try { return { data: await readFile(/* turbopackIgnore: true */ uploadPath(a.storage_name)), name: a.name as string, mime: a.mime as string }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new AppError('附件文件暂不可用，请联系管理员', 404); throw error; }
}
export async function cleanupExpired(pool: Pool, now = new Date(), remove: (location: string) => Promise<unknown> = unlink) {
  let cleaned = 0, failed = 0, orphaned = 0;
  // 锁定元数据行，避免多个清理实例同时处理同一个附件。
  await transaction(pool, async db => {
    const candidates = await rows(db, `SELECT a.id,a.storage_name FROM attachments a JOIN tasks t ON t.id=a.task_id
      WHERE a.expired_at IS NULL AND t.ended_at IS NOT NULL AND t.ended_at+interval '15 days'<=$1
      ORDER BY t.ended_at LIMIT 200 FOR UPDATE OF a SKIP LOCKED`, [now]);
    for (const a of candidates) {
      try {
        try { await remove(uploadPath(a.storage_name)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await db.query('UPDATE attachments SET expired_at=$2 WHERE id=$1', [a.id, now]); cleaned++;
      } catch { failed++; }
    }
    await db.query('DELETE FROM sessions WHERE expires_at<$1', [now]);
    await db.query("DELETE FROM login_attempts WHERE started_at<$1::timestamptz-interval '1 day'", [now]);
  });
  // 上传事务中断可能留下无元数据的文件。只回收本程序命名、超过24小时且
  // 确认没有数据库引用的文件；任何数据库/文件错误均保留到下一轮重试。
  const directory = path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? 'data/uploads');
  const names = await readdir(/* turbopackIgnore: true */ directory).catch(error => { if (error.code === 'ENOENT') return [] as string[]; throw error; });
  for (const name of names) {
    if (!/^[a-f0-9-]{36}\.blob$/.test(name)) continue;
    try {
      const info = await stat(/* turbopackIgnore: true */ uploadPath(name));
      if (!info.isFile() || info.mtimeMs > now.getTime() - 86400000) continue;
      if ((await rows(pool, 'SELECT id FROM attachments WHERE storage_name=$1', [name])).length) continue;
      await remove(uploadPath(name)); orphaned++;
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') failed++; }
  }
  return { cleaned, failed, orphaned };
}
