import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/server';
import { LoginForm } from '@/components/login-form';
export const dynamic = 'force-dynamic';
export default async function Login() { if (await currentUser()) redirect('/tasks'); return <LoginForm />; }
