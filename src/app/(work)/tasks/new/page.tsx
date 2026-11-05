import { requireUser } from '@/lib/server';
import { TaskForm } from '@/components/task-form';
import { getPool } from '@/lib/db';
import { listRecipientOptions, listTags } from '@/lib/tasks';
import { getWallet } from '@/lib/wallet';
export default async function NewTask() {
  const user = await requireUser();
  const pool = getPool();
  const [tags, wallet, recipientOptions] = await Promise.all([
    listTags(pool), getWallet(pool, user.id), listRecipientOptions(pool, user.id),
  ]);
  return <TaskForm canPublishMoney={user.role === 'admin'} availableTags={tags} walletBalance={wallet.balance} platformFunded={wallet.unlimited} recipientOptions={recipientOptions} />;
}
