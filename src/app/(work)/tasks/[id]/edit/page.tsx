import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/server';
import { getPool } from '@/lib/db';
import { getTaskDetail, listTags } from '@/lib/tasks';
import { TaskForm } from '@/components/task-form';
import { serializable } from '@/lib/client';
import { getWallet } from '@/lib/wallet';
export default async function EditTask({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser(), { id } = await params;
  const detail = await getTaskDetail(getPool(), user, id);
  if ((user.id !== detail.task.publisher_id && user.role !== 'admin') || detail.task.first_claimed_at || detail.task.status !== 'open') notFound();
  const [tags, wallet] = await Promise.all([listTags(getPool()), getWallet(getPool(), detail.task.publisher_id)]);
  return <TaskForm initial={serializable(detail.task)} canPublishMoney={user.role === 'admin' && detail.task.publication_status === 'approved'} availableTags={tags} walletBalance={wallet.balance} />;
}
