import { requireUser } from '@/lib/server';
import { Shell } from '@/components/shell';
export const dynamic = 'force-dynamic';
export default async function WorkLayout({ children }: { children: React.ReactNode }) { const user = await requireUser(true); return <Shell user={user}>{children}</Shell>; }
