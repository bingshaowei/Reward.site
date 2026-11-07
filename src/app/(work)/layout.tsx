import { requireUser } from '@/lib/server';
import { Shell } from '@/components/shell';
import { getPool } from '@/lib/db';
import { getPendingReviews } from '@/lib/tasks';
export const dynamic = 'force-dynamic';
export default async function WorkLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser(true);
  const pending = user.role === 'admin' && !user.must_change_password ? await getPendingReviews(getPool()) : null;
  return <Shell user={user} initialPending={pending}>{children}</Shell>;
}
