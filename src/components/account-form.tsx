'use client';
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { api } from '@/lib/client';
import type { User } from '@/lib/types';
export function AccountForm({ user }: { user: User }) {
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setError('');
    if (f.get('newPassword') !== f.get('confirmPassword')) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try { await api('me/password', { method: 'POST', body: JSON.stringify({ oldPassword: f.get('oldPassword'), newPassword: f.get('newPassword') }) }); window.location.assign('/login?changed=1'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 账号设置</div></header><div className="page-heading"><span className="eyebrow">管理个人账号</span><h1>账号设置</h1><p>{user.name} · {user.username}</p></div><section className="paper form-section narrow"><h2><KeyRound size={20} />{user.must_change_password ? '设置你的新密码' : '修改登录密码'}</h2><p className="muted">密码至少12位。修改后所有登录会话失效，需要重新登录。</p><form onSubmit={submit}><label>原密码<input name="oldPassword" type="password" required maxLength={128} autoComplete="current-password" /></label><label>新密码<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label><label>确认新密码<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>{error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary" disabled={busy}>{busy ? '正在保存…' : '更新密码并重新登录'}</button></form></section></>;
}
