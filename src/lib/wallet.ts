import type { Pool, PoolClient } from 'pg';
import { rows, transaction, type Db } from './db';
import { ensure } from './rules';
import type { Claim, Task } from './types';

const DAY = 86_400_000;
const MONTHLY_POINTS = 100;
const INTEREST_DIVISOR = 100;

export async function lockWallet(db: PoolClient) {
  // Keep wallet movements and task state changes in a consistent lock order.
  await db.query('SELECT pg_advisory_xact_lock(674824)');
}

async function activatedAt(db: Db): Promise<Date> {
  const [record] = await rows<{ applied_at: Date }>(db, "SELECT applied_at FROM schema_migrations WHERE version='004'");
  return record.applied_at;
}

export async function recordPoints(db: Db, userId: string, key: string, kind: string, amount: number, taskId: string | null = null, effectiveAt: Date | null = null) {
  if (amount === 0) return;
  await db.query(`INSERT INTO wallet_ledger(user_id,event_key,kind,amount,task_id,effective_at)
    VALUES($1,$2,$3,$4,$5,coalesce($6::timestamptz,now())) ON CONFLICT(user_id,event_key) DO NOTHING`,
  [userId, key, kind, amount, taskId, effectiveAt]);
}

async function balance(db: Db, userId: string, before: Date | null = null) {
  const [record] = await rows(db, `SELECT coalesce(sum(amount),0)::text AS balance FROM wallet_ledger
    WHERE user_id=$1 AND ($2::timestamptz IS NULL OR effective_at<$2)`, [userId, before]);
  return Number(record.balance);
}

export async function hasUnlimitedPoints(db: Db, userId: string) {
  const [user] = await rows<{ role: string }>(db, 'SELECT role FROM users WHERE id=$1', [userId]);
  return user?.role === 'admin';
}

async function creditMonths(db: Db, userId: string, now: Date) {
  const months = await rows<{ month: string; due_at: Date }>(db, `
    WITH eligible AS (
      SELECT greatest(u.created_at,m.applied_at) AS since FROM users u
      CROSS JOIN schema_migrations m WHERE u.id=$1 AND u.active AND m.version='004'
    )
    SELECT to_char(month_start,'YYYY-MM') AS month,
      greatest(since, month_start AT TIME ZONE 'Asia/Shanghai') AS due_at
    FROM eligible CROSS JOIN LATERAL generate_series(
      date_trunc('month', since AT TIME ZONE 'Asia/Shanghai'),
      date_trunc('month', $2::timestamptz AT TIME ZONE 'Asia/Shanghai'), interval '1 month'
    ) AS month_start
    WHERE NOT EXISTS (SELECT 1 FROM wallet_ledger WHERE user_id=$1 AND event_key='monthly:'||to_char(month_start,'YYYY-MM'))
    ORDER BY month_start`, [userId, now]);
  for (const { month, due_at } of months) {
    const interest = Math.floor(Math.max(0, await balance(db, userId, due_at)) / INTEREST_DIVISOR);
    await recordPoints(db, userId, `interest:${month}`, 'interest', interest, null, due_at);
    await recordPoints(db, userId, `monthly:${month}`, 'monthly', MONTHLY_POINTS, null, due_at);
  }
}

type PenaltyClaim = Pick<Claim, 'id' | 'user_id' | 'created_at' | 'submitted_before' | 'status'> & { overdue_days_charged: number };
type PenaltyTask = Pick<Task, 'id' | 'deadline'>;

export async function chargeOverdue(db: Db, task: PenaltyTask, claim: PenaltyClaim, now = new Date()) {
  if (!task.deadline || claim.submitted_before || claim.status !== 'working') return;
  const start = Math.max(+new Date(task.deadline), +new Date(claim.created_at), +(await activatedAt(db)));
  const days = Math.floor((+now - start) / DAY);
  if (days <= claim.overdue_days_charged) return;
  await recordPoints(db, claim.user_id, `overdue:${claim.id}:${+new Date(claim.created_at)}:${days}`, 'overdue', -10 * (days - claim.overdue_days_charged), task.id);
  await db.query('UPDATE claims SET overdue_days_charged=$2 WHERE id=$1', [claim.id, days]);
}

export async function chargeWithdrawal(db: Db, task: PenaltyTask, claim: PenaltyClaim, now = new Date()) {
  await chargeOverdue(db, task, claim, now);
  const days = Math.max(0, Math.floor((+now - Math.max(+new Date(claim.created_at), +(await activatedAt(db)))) / DAY));
  await recordPoints(db, claim.user_id, `withdraw:${claim.id}:${+new Date(claim.created_at)}`, 'withdrawal', -5 * days, task.id);
}

async function syncOverdue(db: Db, now: Date, userId: string | null = null) {
  const claims = await rows<PenaltyClaim & { task_id: string; deadline: string }>(db, `SELECT c.*, t.deadline
    FROM claims c JOIN tasks t ON t.id=c.task_id
    WHERE t.status='open' AND c.status='working' AND NOT c.submitted_before
      AND t.deadline <= $1::timestamptz-interval '24 hours' AND ($2::text IS NULL OR c.user_id=$2)`, [now, userId]);
  for (const claim of claims) await chargeOverdue(db, { id: claim.task_id, deadline: claim.deadline }, claim, now);
}

export async function adjustReserve(db: Db, task: Pick<Task, 'id' | 'publisher_id' | 'points_reserved'>, amount: number, event: string) {
  const difference = amount - Number(task.points_reserved);
  if (difference === 0) return;
  if (difference > 0) {
    const now = new Date();
    await creditMonths(db, task.publisher_id, now);
    await syncOverdue(db, now, task.publisher_id);
    ensure(await balance(db, task.publisher_id) >= difference, '钱包积分不足，无法预留悬赏奖励', 409);
  }
  await recordPoints(db, task.publisher_id, `reserve:${task.id}:${event}`, difference > 0 ? 'reserve' : 'refund', -difference, task.id);
  await db.query('UPDATE tasks SET points_reserved=$2 WHERE id=$1', [task.id, amount]);
}

export async function settleWallets(pool: Pool, now = new Date()) {
  await transaction(pool, async db => {
    await lockWallet(db);
    const users = await rows<{ id: string }>(db, 'SELECT id FROM users WHERE active');
    for (const user of users) await creditMonths(db, user.id, now);
    await syncOverdue(db, now);
  });
}

export async function getWallet(pool: Pool, userId: string) {
  return transaction(pool, async db => {
    await lockWallet(db);
    const now = new Date();
    await creditMonths(db, userId, now);
    await syncOverdue(db, now, userId);
    const [reserved] = await rows(db, 'SELECT coalesce(sum(points_reserved),0)::text AS total FROM tasks WHERE publisher_id=$1', [userId]);
    const entries = await rows<{ id: string; kind: string; amount: number; title: string | null; effective_at: string }>(db, `
      SELECT l.id::text,l.kind,l.amount::float8 AS amount,t.title,l.effective_at
      FROM wallet_ledger l LEFT JOIN tasks t ON t.id=l.task_id WHERE l.user_id=$1
      ORDER BY l.effective_at DESC,l.id DESC LIMIT 50`, [userId]);
    return { balance: await balance(db, userId), reserved: Number(reserved.total), unlimited: await hasUnlimitedPoints(db, userId), entries };
  });
}
