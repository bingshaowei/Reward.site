import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { rows, transaction, type Db } from './db';
import { ensure, toUnits, validateAllocation } from './rules';
import { saveAttachment, validateFiles, uploadTransaction } from './files';
import { adjustReserve, chargeOverdue, chargeWithdrawal, lockWallet, recordPoints } from './wallet';
import type { User, Task, TaskDetail, Claim, Submission, Reward, Attachment, Overview } from './types';

const taskInput = z.object({
  title: z.string().trim().min(2, '标题至少两个字').max(100),
  description: z.string().trim().min(2).max(20000), criteria: z.string().trim().min(2).max(10000),
  mode: z.enum(['independent', 'team']), reward_type: z.enum(['money', 'points']), reward: z.string(),
  capacity: z.number().int().min(1).max(100), deadline: z.string().datetime({ offset: true }).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).default([]),
});
function rewardReserve(data: z.infer<typeof taskInput>, amount: number) {
  return data.reward_type === 'points' ? amount * (data.mode === 'team' ? 1 : data.capacity) : 0;
}
export async function listTags(db: Db) {
  return (await rows<{ name: string }>(db, 'SELECT name FROM tags ORDER BY name')).map(tag => tag.name);
}
async function saveTags(db: Db, taskId: string, names: string[]) {
  const tags = [...new Set(names.map(name => name.normalize('NFKC').trim().toLowerCase()))];
  ensure(tags.every(name => name.length > 0 && name.length <= 24 && !/[\p{C}]/u.test(name)), '标签须为1至24个可见字符');
  await db.query('INSERT INTO tags(name) SELECT unnest($1::text[]) ON CONFLICT DO NOTHING', [tags]);
  await db.query('DELETE FROM task_tags WHERE task_id=$1', [taskId]);
  await db.query('INSERT INTO task_tags(task_id,tag_name) SELECT $1,unnest($2::text[])', [taskId, tags]);
}
export async function audit(db: Db, userId: string, action: string, targetId: string) {
  await db.query('INSERT INTO audit_log(actor_id,action,target_id) VALUES($1,$2,$3)', [userId, action, targetId]);
}
async function lockTask(db: PoolClient, id: string) {
  const [task] = await rows<Task>(db, 'SELECT * FROM tasks WHERE id=$1 FOR UPDATE', [id]);
  ensure(task, '任务不存在', 404); return task;
}
function owner(task: Task, user: User) { ensure(user.id === task.publisher_id || user.role === 'admin', '仅发布者或管理员可以操作', 403); }
function open(task: Task) { ensure(task.status === 'open', '该任务已经结束'); }

export async function createTask(pool: Pool, user: User, value: unknown, files: File[] = []) {
  const data = taskInput.parse(value), amount = toUnits(data.reward, data.reward_type);
  ensure(user.role === 'admin' || data.reward_type === 'points', '普通成员只能发布积分悬赏', 403);
  await validateFiles(files, true);
  return uploadTransaction(pool, async (db, created) => {
    await lockWallet(db);
    const [task] = await rows<Task>(db, `INSERT INTO tasks(id,publisher_id,title,description,criteria,mode,reward_type,reward_units,capacity,deadline,publication_status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [randomUUID(), user.id, data.title, data.description, data.criteria, data.mode, data.reward_type, amount, data.capacity, data.deadline ?? null, user.role === 'admin' ? 'approved' : 'pending']);
    await adjustReserve(db, task, rewardReserve(data, amount), 'create');
    for (const file of files) await saveAttachment(db, user, task.id, null, file, created);
    await saveTags(db, task.id, data.tags);
    await audit(db, user.id, 'task.create', task.id); return task;
  });
}
export async function editTask(pool: Pool, user: User, id: string, value: unknown) {
  const data = taskInput.parse(value), amount = toUnits(data.reward, data.reward_type);
  ensure(user.role === 'admin' || data.reward_type === 'points', '普通成员只能发布积分悬赏', 403);
  return transaction(pool, async db => {
    await lockWallet(db);
    const task = await lockTask(db, id); owner(task, user); open(task);
    ensure(!task.first_claimed_at, '任务已被领取，工作要求和奖励已锁定');
    ensure(task.publication_status === 'approved' || data.reward_type === 'points', '待审悬赏只能使用积分', 403);
    const publicationStatus = user.role === 'admin' && task.publication_status === 'approved' ? 'approved' : 'pending';
    await adjustReserve(db, task, rewardReserve(data, amount), `edit:${task.publication_version}`);
    await db.query(`UPDATE tasks SET title=$2,description=$3,criteria=$4,mode=$5,reward_type=$6,reward_units=$7,capacity=$8,deadline=$9,publication_status=$10,publication_note=NULL,publication_version=publication_version+1 WHERE id=$1`,
      [id, data.title, data.description, data.criteria, data.mode, data.reward_type, amount, data.capacity, data.deadline ?? null, publicationStatus]);
    await saveTags(db, id, data.tags);
    await audit(db, user.id, 'task.edit', id);
  });
}
export async function reviewPublication(pool: Pool, user: User, id: string, value: unknown) {
  ensure(user.role === 'admin', '仅管理员可以审核悬赏', 403);
  const input = z.object({ approve: z.boolean(), note: z.string().trim().max(2000).optional(), version: z.number().int().positive() }).parse(value);
  ensure(input.approve || input.note, '请填写退回原因');
  await transaction(pool, async db => {
    await lockWallet(db);
    const task = await lockTask(db, id);
    open(task);
    ensure(task.publication_status === 'pending' && task.reward_type === 'points', '该悬赏没有待处理的积分审核');
    ensure(task.publication_version === input.version, '发布者已修改任务，请刷新后重新审核', 409);
    if (!input.approve) await adjustReserve(db, task, 0, `reject:${task.publication_version}`);
    await db.query('UPDATE tasks SET publication_status=$2,publication_note=$3 WHERE id=$1',
      [id, input.approve ? 'approved' : 'rejected', input.note ?? null]);
    await audit(db, user.id, input.approve ? 'publication.approve' : 'publication.reject', id);
  });
}
export async function claimTask(pool: Pool, user: User, id: string) {
  return transaction(pool, async db => {
    const task = await lockTask(db, id); open(task);
    ensure(task.publisher_id !== user.id, '不能领取自己发布的任务');
    ensure(task.publication_status === 'approved', '该悬赏尚未通过审核', 403);
    ensure(!task.team_locked, '团队已经提交成果，成员已锁定');
    const [existing] = await rows(db, 'SELECT * FROM claims WHERE task_id=$1 AND user_id=$2', [id, user.id]);
    ensure(!existing || existing.status === 'withdrawn', '你已领取过这个任务');
    const [{ count }] = await rows(db, "SELECT count(*)::int AS count FROM claims WHERE task_id=$1 AND status NOT IN ('withdrawn','cancelled')", [id]);
    ensure(count < task.capacity, '任务名额已满');
    const [claim] = await rows<Claim>(db, `INSERT INTO claims(id,task_id,user_id) VALUES($1,$2,$3)
      ON CONFLICT(task_id,user_id) DO UPDATE SET status='working',created_at=now(),overdue_days_charged=0 RETURNING *`, [randomUUID(), id, user.id]);
    await db.query('UPDATE tasks SET first_claimed_at=coalesce(first_claimed_at,now()) WHERE id=$1', [id]);
    await audit(db, user.id, 'task.claim', id); return claim;
  });
}
export async function withdrawTask(pool: Pool, user: User, id: string) {
  return transaction(pool, async db => {
    await lockWallet(db);
    const task = await lockTask(db, id); open(task); ensure(!task.team_locked, '团队成员已锁定，不能退出');
    const [claim] = await rows<Claim>(db, 'SELECT * FROM claims WHERE task_id=$1 AND user_id=$2', [id, user.id]);
    ensure(claim && claim.status === 'working' && !claim.submitted_before, '仅首次提交前可以退出任务');
    await chargeWithdrawal(db, task, claim);
    await db.query("UPDATE claims SET status='withdrawn' WHERE id=$1", [claim.id]);
    await audit(db, user.id, 'task.withdraw', id);
  });
}
export async function submitWork(pool: Pool, user: User, id: string, value: unknown, files: File[] = []) {
  const data = z.object({ content: z.string().trim().min(1, '请填写交付说明').max(20000) }).parse(value);
  await validateFiles(files);
  return uploadTransaction(pool, async (db, created) => {
    await lockWallet(db);
    const task = await lockTask(db, id); open(task);
    const [claim] = await rows<Claim>(db, 'SELECT * FROM claims WHERE task_id=$1 AND user_id=$2', [id, user.id]);
    ensure(claim && ['working', 'revision'].includes(claim.status), '当前不能提交，请确认已领取任务或等待验收');
    const [submission] = await rows<Submission>(db, 'INSERT INTO submissions(id,task_id,claim_id,submitter_id,content) VALUES($1,$2,$3,$4,$5) RETURNING *',
      [randomUUID(), id, task.mode === 'team' ? null : claim.id, user.id, data.content]);
    if (task.mode === 'team') {
      const members = await rows<Claim>(db, "SELECT * FROM claims WHERE task_id=$1 AND status='working'", [id]);
      for (const member of members) await chargeOverdue(db, task, member);
      await db.query('UPDATE tasks SET team_locked=true WHERE id=$1', [id]);
      await db.query("UPDATE claims SET status='submitted',submitted_before=true WHERE task_id=$1 AND status IN ('working','revision')", [id]);
    } else {
      await chargeOverdue(db, task, claim);
      await db.query("UPDATE claims SET status='submitted',submitted_before=true WHERE id=$1", [claim.id]);
    }
    for (const file of files) await saveAttachment(db, user, id, submission.id, file, created);
    await audit(db, user.id, 'work.submit', submission.id); return submission;
  });
}
export async function reviewWork(pool: Pool, user: User, submissionId: string, value: unknown) {
  const data = z.object({ approve: z.boolean(), note: z.string().trim().max(2000).optional(), allocations: z.record(z.string(), z.number()).optional() }).parse(value);
  ensure(data.approve || data.note, '退回修改时请填写原因');
  return transaction(pool, async db => {
    await lockWallet(db);
    const [ref] = await rows(db, 'SELECT task_id FROM submissions WHERE id=$1', [submissionId]); ensure(ref, '成果不存在', 404);
    const task = await lockTask(db, ref.task_id); owner(task, user); open(task);
    const [submission] = await rows<Submission>(db, 'SELECT * FROM submissions WHERE id=$1 FOR UPDATE', [submissionId]);
    ensure(submission.status === 'pending', '该成果已经验收，请刷新页面');
    const claims = await rows<Claim>(db, "SELECT * FROM claims WHERE task_id=$1 AND status='submitted' AND ($2::text IS NULL OR id=$2)", [task.id, submission.claim_id]);
    ensure(claims.length, '没有可验收的参与记录');
    const allocations = data.approve && task.mode === 'team' ? validateAllocation(data.allocations ?? {}, claims.map(c => c.user_id), task.reward_units) : null;
    if (data.approve) {
      let paidPoints = 0;
      for (const c of claims) {
        const units = allocations ? allocations[c.user_id] : task.reward_units;
        await db.query('INSERT INTO rewards(id,task_id,claim_id,user_id,reward_type,units) VALUES($1,$2,$3,$4,$5,$6)',
          [randomUUID(), task.id, c.id, c.user_id, task.reward_type, units]);
        if (task.reward_type === 'points') {
          await recordPoints(db, c.user_id, `reward:${c.id}`, 'reward', units, task.id);
          paidPoints += units;
        }
      }
      const reserved = Number(task.points_reserved);
      if (paidPoints && reserved > 0) {
        ensure(reserved >= paidPoints, '悬赏预留积分不足', 409);
        await db.query('UPDATE tasks SET points_reserved=points_reserved-$2 WHERE id=$1', [task.id, paidPoints]);
        task.points_reserved = String(reserved - paidPoints);
      }
    }
    await db.query('UPDATE submissions SET status=$2,review_note=$3,reviewer_id=$4,reviewed_at=now() WHERE id=$1',
      [submissionId, data.approve ? 'approved' : 'revision', data.note ?? null, user.id]);
    await db.query('UPDATE claims SET status=$2 WHERE id=ANY($1::text[])', [claims.map(c => c.id), data.approve ? 'accepted' : 'revision']);
    const [{ count }] = await rows(db, "SELECT count(*)::int AS count FROM claims WHERE task_id=$1 AND status='accepted'", [task.id]);
    if (data.approve && (task.mode === 'team' || count === task.capacity)) {
      await adjustReserve(db, task, 0, 'completed');
      await db.query("UPDATE tasks SET status='completed',ended_at=now() WHERE id=$1", [task.id]);
    }
    await audit(db, user.id, data.approve ? 'work.approve' : 'work.return', submissionId);
  });
}
export async function finishTask(pool: Pool, user: User, id: string, action: 'complete' | 'cancel') {
  return transaction(pool, async db => {
    await lockWallet(db);
    const task = await lockTask(db, id); owner(task, user); open(task);
    if (action === 'complete') {
      ensure(task.publication_status === 'approved', '该悬赏尚未通过审核', 403);
      const [{ count }] = await rows(db, "SELECT count(*)::int AS count FROM claims WHERE task_id=$1 AND status IN ('working','submitted','revision')", [id]);
      ensure(count === 0, '还有成员正在处理，请先完成验收或取消任务');
    } else {
      const members = await rows<Claim>(db, "SELECT * FROM claims WHERE task_id=$1 AND status='working'", [id]);
      for (const member of members) await chargeOverdue(db, task, member);
      await db.query("UPDATE claims SET status='cancelled' WHERE task_id=$1 AND status IN ('working','submitted','revision')", [id]);
      await db.query("UPDATE submissions SET status='revision',review_note='任务已取消，保留成果记录',reviewer_id=$2,reviewed_at=now() WHERE task_id=$1 AND status='pending'", [id, user.id]);
    }
    await adjustReserve(db, task, 0, action);
    await db.query('UPDATE tasks SET status=$2,ended_at=now() WHERE id=$1', [id, action === 'complete' ? 'completed' : 'cancelled']);
    await audit(db, user.id, `task.${action}`, id);
  });
}
export async function settleReward(pool: Pool, user: User, id: string) {
  return transaction(pool, async db => {
    const [reward] = await rows(db, 'SELECT r.*,t.publisher_id FROM rewards r JOIN tasks t ON t.id=r.task_id WHERE r.id=$1 FOR UPDATE OF r', [id]);
    ensure(reward, '结算记录不存在', 404); owner(reward as Task, user); ensure(reward.reward_type === 'money', '积分奖励不需要线下结算');
    if (!reward.paid_at) {
      await db.query('UPDATE rewards SET paid_at=now(),paid_by=$2 WHERE id=$1', [id, user.id]);
      await audit(db, user.id, 'reward.settle', id);
    }
  });
}
const taskSelect = `SELECT t.*,u.name AS publisher_name,
 ARRAY(SELECT tag_name FROM task_tags WHERE task_id=t.id ORDER BY tag_name) AS tags,
 (SELECT count(*)::int FROM claims c WHERE c.task_id=t.id AND c.status NOT IN ('withdrawn','cancelled')) AS claimed_count,
 (SELECT count(*)::int FROM claims c WHERE c.task_id=t.id AND c.status='accepted') AS accepted_count,
 (SELECT count(*)::int FROM submissions s WHERE s.task_id=t.id AND s.status='pending') AS pending_count
 FROM tasks t JOIN users u ON u.id=t.publisher_id`;
export async function listTasks(db: Db, options: { q?: string; status?: string; reward?: string; mine?: string; userId?: string; publicationQueue?: boolean } = {}) {
  return rows<Task>(db, `${taskSelect} WHERE ($1='' OR t.title ILIKE '%'||$1||'%' OR t.description ILIKE '%'||$1||'%' OR EXISTS (SELECT 1 FROM task_tags WHERE task_id=t.id AND tag_name ILIKE '%'||$1||'%'))
    AND ($2='' OR t.status=$2) AND ($3='' OR t.reward_type=$3)
    AND ($4='' OR ($4='published' AND t.publisher_id=$5) OR ($4='claimed' AND EXISTS(SELECT 1 FROM claims c WHERE c.task_id=t.id AND c.user_id=$5 AND c.status<>'withdrawn')) OR ($4='review' AND t.publisher_id=$5 AND EXISTS(SELECT 1 FROM submissions s WHERE s.task_id=t.id AND s.status='pending')))
    AND (CASE WHEN $6::boolean THEN t.publication_status='pending' AND t.status='open'
      ELSE t.publication_status='approved' OR ($4='published' AND t.publisher_id=$5) END)
    ORDER BY t.created_at DESC LIMIT 500`, [options.q?.slice(0, 100) ?? '', options.status ?? '', options.reward ?? '', options.mine ?? '', options.userId ?? '', options.publicationQueue ?? false]);
}
export async function getTaskDetail(db: Db, user: User, id: string): Promise<TaskDetail> {
  const [task] = await rows<Task>(db, `${taskSelect} WHERE t.id=$1`, [id]); ensure(task, '任务不存在', 404);
  ensure(task.publication_status === 'approved' || task.publisher_id === user.id || user.role === 'admin', '任务不存在', 404);
  const claims = await rows<Claim>(db, 'SELECT c.*,u.name FROM claims c JOIN users u ON u.id=c.user_id WHERE c.task_id=$1 ORDER BY c.created_at', [id]);
  const managing = task.publisher_id === user.id || user.role === 'admin';
  const member = claims.some(c => c.user_id === user.id && c.status !== 'withdrawn');
  const submissions = await rows<Submission>(db, `SELECT s.*,u.name AS submitter_name FROM submissions s JOIN users u ON u.id=s.submitter_id
    WHERE s.task_id=$1 AND ($2 OR s.submitter_id=$3 OR (s.claim_id IS NULL AND $4)) ORDER BY s.created_at DESC`, [id, managing, user.id, member]);
  const attachments = await rows<Attachment>(db, `SELECT a.id,a.task_id,a.submission_id,a.name,a.size,a.expired_at,t.ended_at+interval '15 days' AS expires_at
    FROM attachments a JOIN tasks t ON t.id=a.task_id WHERE a.task_id=$1 AND (a.submission_id IS NULL OR a.submission_id=ANY($2::text[])) ORDER BY a.created_at`, [id, submissions.map(s => s.id)]);
  const rewards = await rows<Reward>(db, `SELECT r.*,t.title,t.publisher_id,u.name FROM rewards r JOIN tasks t ON t.id=r.task_id JOIN users u ON u.id=r.user_id WHERE r.task_id=$1 AND ($2 OR r.user_id=$3) ORDER BY r.created_at DESC`, [id, managing, user.id]);
  return { task, claims, submissions, attachments, rewards };
}
export async function listRewards(db: Db, user: User, managed = false) {
  return rows<Reward>(db, `SELECT r.*,t.title,t.publisher_id,u.name FROM rewards r JOIN tasks t ON t.id=r.task_id JOIN users u ON u.id=r.user_id
    WHERE (NOT $2 AND r.user_id=$1) OR ($2 AND (t.publisher_id=$1 OR $3)) ORDER BY r.created_at DESC LIMIT 1000`, [user.id, managed, user.role === 'admin']);
}
export async function getOverview(db: Db, user: User): Promise<Overview> {
  const [overview] = await rows<Overview>(db, `SELECT
    (SELECT count(*)::int FROM tasks WHERE status='open' AND publication_status='approved') AS open_tasks,
    (SELECT count(*)::int FROM tasks WHERE status='completed') AS completed_tasks,
    (SELECT count(*)::int FROM submissions s JOIN tasks t ON t.id=s.task_id WHERE t.publisher_id=$1 AND s.status='pending') AS pending_reviews,
    coalesce(sum(units) FILTER(WHERE reward_type='points'),0)::float8 AS points,
    coalesce(sum(units) FILTER(WHERE reward_type='money'),0)::float8 AS total_money,
    coalesce(sum(units) FILTER(WHERE reward_type='money' AND paid_at IS NULL),0)::float8 AS pending_money
    FROM rewards WHERE user_id=$1`, [user.id]);
  return overview;
}
