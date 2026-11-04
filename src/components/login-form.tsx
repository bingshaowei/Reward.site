'use client';
import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Users, Coins } from 'lucide-react';
import { api } from '@/lib/client';
import type { User } from '@/lib/types';
export function LoginForm() {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [registrationSent, setRegistrationSent] = useState(false);
  function toggleRegistration() {
    setRegistering(!registering);
    setShowPassword(false);
    setError('');
    setRegistrationSent(false);
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    if (registering) {
      try {
        await api('auth/register', { method: 'POST', body: JSON.stringify(Object.fromEntries(form)) });
        setRegistrationSent(true);
      } catch (e) { setError((e as Error).message); }
      finally { setBusy(false); }
      return;
    }
    try { const result = await api<{ user: User }>('auth/login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); window.location.assign(result.user.must_change_password ? '/account' : '/tasks'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <main className="login-page">
    <div className="login-brand"><span className="seal">赏</span><strong>内部悬赏令</strong><span className="brand-sub">CCP 团队工作协作平台</span></div>
    <section className="login-content">
      <div className="login-story"><span className="eyebrow">好工作，值得一起完成</span><h1>把工作写下来，<br />让本事<span>有回报。</span></h1><p>发布一份悬赏，找到合适的伙伴。<br />从领取到交付，让每一份付出都有记录。</p><div className="login-features"><span><Users size={18} /> 单人承接 / 团队协作</span><span><Coins size={18} /> 金额悬赏 / 积分奖励</span></div><div className="poster-stamp" aria-hidden="true"><span>内部协作</span><strong>悬赏令</strong><span>有能者 · 一起来</span></div></div>
      <div className="login-card paper"><div className="card-tape" aria-hidden="true" /><span className="eyebrow">{registering ? '加入团队' : '欢迎回来'}</span><h2>{registering ? '申请注册' : '登录工作台'}</h2><p className="muted">{registering ? '提交申请后，管理员审核通过即可登录。' : '使用你的内部账号登录。'}</p>
        {registrationSent ? <p role="status" className="notice success">申请已提交，请等待管理员审核。</p> : <form key={registering ? 'register' : 'login'} onSubmit={submit}>
          {registering && <label>姓名<input name="name" required autoComplete="name" maxLength={40} placeholder="请输入姓名" /></label>}
          <label>账号<input name="username" required autoComplete="username" placeholder={registering ? '3至32位字母、数字等' : '请输入账号'} minLength={registering ? 3 : undefined} maxLength={32} /></label>
          <label htmlFor="login-password">密码</label>
          <div className="password-input login-password">
            <input id="login-password" name="password" type={showPassword ? 'text' : 'password'} required autoComplete={registering ? 'new-password' : 'current-password'} placeholder={registering ? '至少12位密码' : '请输入密码'} minLength={registering ? 12 : undefined} maxLength={128} />
            <button type="button" className="icon-btn" aria-label={showPassword ? '隐藏密码' : '显示密码'} onClick={() => setShowPassword(visible => !visible)}>
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          {error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary full" disabled={busy}>{registering ? (busy ? '正在提交…' : '提交申请') : (busy ? '正在登录…' : '登录')}<ArrowRight size={18} /></button></form>}
        <button type="button" className="text-btn" disabled={busy} onClick={toggleRegistration}>{registering ? '返回登录' : '申请注册'}</button>
        <p className="login-note"><LockKeyhole size={15} /> 仅供内部成员使用 · 账号问题请联系管理员</p>
      </div>
    </section><footer className="login-footer">内部悬赏令 <span>把事情做好，让付出被看见。</span></footer>
  </main>;
}
