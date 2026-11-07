'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, KeyRound } from 'lucide-react';
import { api } from '@/lib/client';
import type { User } from '@/lib/types';
export function AccountForm({ user }: { user: User }) {
  const router = useRouter();
  const [avatar, setAvatar] = useState(''), [avatarVersion, setAvatarVersion] = useState(user.avatar_version);
  const [avatarBusy, setAvatarBusy] = useState(false), [avatarError, setAvatarError] = useState(''), [avatarSaved, setAvatarSaved] = useState(false);
  async function selectAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatarError(''); setAvatarSaved(false); setAvatar('');
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setAvatarError('请选择不超过5MB的 JPG、PNG 或 WebP 图片。'); event.target.value = ''; return;
    }
    setAvatarBusy(true);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('浏览器暂时无法处理图片，请重试。');
        const side = Math.min(bitmap.width, bitmap.height);
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 256, 256);
        setAvatar(canvas.toDataURL('image/png'));
      } finally { bitmap.close(); }
    } catch { setAvatarError('无法读取这张图片，请选择其他图片。'); }
    finally { setAvatarBusy(false); }
  }
  async function saveAvatar(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!avatar || avatarBusy) return;
    setAvatarBusy(true); setAvatarError(''); setAvatarSaved(false);
    try {
      const result = await api<{ version: string }>('me/avatar', { method: 'POST', body: JSON.stringify({ image: avatar }) });
      setAvatarVersion(result.version); setAvatar(''); setAvatarSaved(true); router.refresh();
    } catch (error) { setAvatarError((error as Error).message); }
    finally { setAvatarBusy(false); }
  }
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); const f = new FormData(e.currentTarget); setError('');
    if (f.get('newPassword') !== f.get('confirmPassword')) { setError('两次输入的新密码不一致'); return; }
    setBusy(true);
    try { await api('me/password', { method: 'POST', body: JSON.stringify({ oldPassword: f.get('oldPassword'), newPassword: f.get('newPassword') }) }); window.location.assign('/login?changed=1'); }
    catch (e) { setError((e as Error).message); setBusy(false); }
  }
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 账号设置</div></header><div className="page-heading"><span className="eyebrow">管理个人账号</span><h1>账号设置</h1><p>{user.name} · {user.username}</p></div><section className="paper form-section narrow account-avatar-form"><h2><Camera size={20} />更换头像</h2><form onSubmit={saveAvatar}><div className="avatar-editor"><span className="avatar avatar-large">{avatar || avatarVersion ? <img src={avatar || `/api/me/avatar?v=${avatarVersion}`} alt="头像预览" /> : user.name.slice(0, 1)}</span><div className="avatar-controls"><label>选择头像图片<input type="file" accept="image/jpeg,image/png,image/webp" disabled={avatarBusy} onChange={selectAvatar} /></label><p className="hint">支持 JPG、PNG、WebP，最大5MB。图片居中裁成方形，保存前可预览。</p></div></div>{avatarError && <p role="alert" className="notice danger">{avatarError}</p>}{avatarSaved && <p role="status" className="notice success">头像已更新</p>}<div className="button-row"><button className="btn primary" disabled={!avatar || avatarBusy}>{avatarBusy ? '正在处理…' : '保存头像'}</button></div></form></section><section className="paper form-section narrow"><h2><KeyRound size={20} />{user.must_change_password ? '设置你的新密码' : '修改登录密码'}</h2><p className="muted">密码至少12位。修改后所有登录会话失效，需要重新登录。</p><form onSubmit={submit}><label>原密码<input name="oldPassword" type="password" required maxLength={128} autoComplete="current-password" /></label><label>新密码<input name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label><label>确认新密码<input name="confirmPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" /></label>{error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary" disabled={busy}>{busy ? '正在保存…' : '更新密码并重新登录'}</button></form></section></>;
}
