import { requireUser } from '@/lib/server';
import { getPool } from '@/lib/db';
import { listTasks, getOverview } from '@/lib/tasks';
import { serializable } from '@/lib/client';
import { Board } from '@/components/board';
export default async function TasksPage() { const user = await requireUser(); const pool = getPool(); const [tasks, overview] = await Promise.all([listTasks(pool), getOverview(pool, user)]); return <Board user={user} tasks={serializable(tasks)} overview={overview} />; }
