import { requireUser } from '@/lib/server';
import { AccountForm } from '@/components/account-form';
export default async function AccountPage() { const user = await requireUser(true); return <AccountForm user={user} />; }
