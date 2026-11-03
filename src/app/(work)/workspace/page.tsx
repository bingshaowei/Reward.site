import { requireUser } from '@/lib/server';
import { getPool } from '@/lib/db';
import { listTasks, listRewards, getOverview } from '@/lib/tasks';
import { serializable } from '@/lib/client';
import { Workspace } from '@/components/workspace';
import { getWallet } from '@/lib/wallet';
export default async function WorkspacePage() {
  const user = await requireUser(), pool = getPool();
  const [published, claimed, rewards, managedRewards, overview, wallet] = await Promise.all([listTasks(pool, { mine: 'published', userId: user.id }), listTasks(pool, { mine: 'claimed', userId: user.id }), listRewards(pool, user), listRewards(pool, user, true), getOverview(pool, user), getWallet(pool, user.id)]);
  return <Workspace user={user} published={serializable(published)} claimed={serializable(claimed)} initialRewards={serializable(rewards)} initialManagedRewards={serializable(managedRewards)} initialOverview={overview} wallet={serializable(wallet)} />;
}
