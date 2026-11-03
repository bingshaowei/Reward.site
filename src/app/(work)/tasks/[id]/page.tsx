import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/server';
import { getPool } from '@/lib/db';
import { getTaskDetail } from '@/lib/tasks';
import { AppError } from '@/lib/rules';
import { serializable } from '@/lib/client';
import { TaskDetailView } from '@/components/task-detail';
export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(), { id } = await params;
  try { return <TaskDetailView user={user} initial={serializable(await getTaskDetail(getPool(), user, id))} />; }
  catch (error) { if (error instanceof AppError && error.status === 404) notFound(); throw error; }
}
