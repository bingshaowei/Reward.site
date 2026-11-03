'use client';
import { useState } from 'react';
import { ArrowRight, LockKeyhole, Users, Coins } from 'lucide-react';
import { api } from '@/lib/client';
import type { User } from '@/lib/types';
export function LoginForm() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    try { const result = await api<{ user: User }>('auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); window.location.assign(result.user.must_change_password ? '/account' : '/tasks'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-brand"><span className="seal">赏</span><strong>内部悬赏令</strong><span className="brand-sub">CCP 团队工作协作平台</span></div>
    <section className="login-content">
      <div className="login-story"><span className="eyebrow">好工作，值得一起完成</span><h1>把工作写下来，<br />让本事<span>有回报。</span></h1><p>发布一份悬赏，找到合适的伙伴。<br />从领取到交付，让每一份付出都有记录。</p><div className="login-features"><span><Users size={18} /> 单人承接 / 团队协作</span><span><Coins size={18} /> 金额悬赏 / 积分奖励</span></div><div className="poster-stamp" aria-hidden="true"><span>内部协作</span><strong>悬赏令</strong><span>有能者 · 一起来</span></div></div>
      <div className="login-card paper"><div className="card-tape" aria-hidden="true" /><span className="eyebrow">欢迎回来</span><h2>登录工作台</h2><p className="muted">使用管理员分配的内部账号登录。</p>
        <form onSubmit={submit}><label>账号<input name="username" required autoComplete="username" placeholder="请输入账号" maxLength={32} /></label><label>密码<input name="password" type="password" required autoComplete="current-password" placeholder="请输入密码" maxLength={128} /></label>{error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary full" disabled={busy}>{busy ? '正在登录…' : '登录'}<ArrowRight size={18} /></button></form>
        <p className="login-note"><LockKeyhole size={15} /> 仅供内部成员使用 · 账号问题请联系管理员</p>
      </div>
    </section><footer className="login-footer">内部悬赏令 <span>把事情做好，让付出被看见。</span></footer>
  </main>;
}
