import { notFound } from 'next/navigation';
import { requireUser } from '@/lib/server';
import { getPool, rows } from '@/lib/db';
import { listRegistrationRequests, publicUserFields } from '@/lib/auth';
import type { User } from '@/lib/types';
import { serializable } from '@/lib/client';
import { Admin } from '@/components/admin';
import { listTasks } from '@/lib/tasks';
export default async function AdminPage() {
  const user = await requireUser();
  if (user.role !== 'admin') notFound();
  const pool = getPool();
  const [users, pendingTasks, registrationRequests] = await Promise.all([
    rows<User>(pool, `SELECT ${publicUserFields},created_at FROM users WHERE removed_at IS NULL ORDER BY created_at`),
    listTasks(pool, { publicationQueue: true }),
    listRegistrationRequests(pool),
  ]);
  return <Admin user={user} initial={serializable(users)} pendingTasks={serializable(pendingTasks)} registrationRequests={registrationRequests} />;
}
