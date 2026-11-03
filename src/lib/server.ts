import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { getPool } from './db';
import { userForToken } from './auth';
export const SESSION_COOKIE = 'bounty_session';
export async function currentUser() {
  return userForToken(getPool(), (await cookies()).get(SESSION_COOKIE)?.value);
}
export async function requireUser(allowPasswordChange = false) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.must_change_password && !allowPasswordChange) redirect('/account');
  return user;
}
