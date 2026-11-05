'use client';
import { useState } from 'react';
import { UserPlus, KeyRound, ShieldCheck, Eye, EyeOff } from 'lucide-react';
import { api } from '@/lib/client';
import Link from 'next/link';
import type { RegistrationRequest, Task, User } from '@/lib/types';
export function Admin({ user, initial, pendingTasks, registrationRequests }: { user: User; initial: User[]; pendingTasks: Task[]; registrationRequests: RegistrationRequest[] }) {
  const [applications, setApplications] = useState(registrationRequests);
  const [users, setUsers] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [visible, setVisible] = useState(false);
  async function run(fn: () => Promise<unknown>, success: string) { setBusy(true); setError(''); setMessage(''); try { await fn(); setUsers((await api<{ users: User[] }>('users')).users); setMessage(success); return true; } catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); } }
  async function create(e: React.FormEvent<HTMLFormElement>) { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); if (await run(() => api('users', { method: 'POST', body: JSON.stringify(Object.fromEntries(f)) }), '账号已创建，请将账号和初始密码安全地交给成员；首次登录需修改密码。')) form.reset(); }
  async function reset(e: React.FormEvent<HTMLFormElement>, id: string) { e.preventDefault(); const form = e.currentTarget, f = new FormData(form); if (await run(() => api(`users/${id}`, { method: 'PATCH', body: JSON.stringify({ password: f.get('password') }) }), '密码已重置，原有会话已失效。')) form.reset(); }
  async function changeRole(member: User) {
    const role = member.role === 'admin' ? 'member' : 'admin';
    const label = role === 'admin' ? '管理员' : '普通成员';
    if (!window.confirm(`将 ${member.name}（${member.username}）设为${label}？该成员需要重新登录。`)) return;
    await run(() => api(`users/${member.id}`, { method: 'PATCH', body: JSON.stringify({ role }) }), `${member.name}已设为${label}。`);
  }
  async function review(application: RegistrationRequest, approve: boolean) {
    if (!window.confirm(`${approve ? '通过' : '拒绝'} ${application.name}（${application.username}）的注册申请？`)) return;
    await run(async () => {
      await api(`registration-requests/${application.id}/review`, { method: 'POST', body: JSON.stringify({ approve }) });
      setApplications(current => current.filter(item => item.id !== application.id));
    }, approve ? '注册申请已通过，成员现在可以登录。' : '注册申请已拒绝。');
  }
  const registrationQueue = <section className="paper detail-section">
    <h2>注册申请（{applications.length}）</h2>
    {applications.length ? <div className="table-scroll"><table>
      <thead><tr><th>申请人</th><th>登录账号</th><th>审核</th></tr></thead>
      <tbody>{applications.map(application => <tr key={application.id}>
        <td>{application.name}</td><td>{application.username}</td>
        <td><div className="account-actions">
          <button className="text-btn" disabled={busy} onClick={() => void review(application, true)}>通过</button>
          <button className="text-btn danger-text" disabled={busy} onClick={() => void review(application, false)}>拒绝</button>
        </div></td>
      </tr>)}</tbody>
    </table></div> : <p>暂无待审核的注册申请。</p>}
  </section>;
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 成员管理</div><span className="tag neutral"><ShieldCheck size={14} />管理员</span></header><div className="page-heading"><h1>管理团队成员</h1><p>创建内部账号，管理访问权限与登录密码。</p></div><div aria-live="polite">{error && <p role="alert" className="notice danger">{error}</p>}{message && <p className="notice success">{message}</p>}</div><section className="paper detail-section"><h2>悬赏发布审核（{pendingTasks.length}）</h2>{pendingTasks.length ? <ul>{pendingTasks.map(task => <li key={task.id}><Link href={`/tasks/${task.id}`}>{task.title} · {task.publisher_name} · {task.reward_units} 积分（{task.mode === "team" ? "团队总奖励" : "每人"}）</Link></li>)}</ul> : <p>暂无待审核的悬赏。</p>}</section>{registrationQueue}<div className="admin-layout"><section className="paper detail-section"><div className="section-title"><h2>团队成员 <span>{users.length}</span></h2></div><div className="table-scroll"><table><thead><tr><th>成员</th><th>角色</th><th>状态</th><th>账号操作</th></tr></thead><tbody>{users.map(u => <tr key={u.id}><td><strong>{u.name}{u.id === user.id && '（我）'}</strong><small>{u.username}</small></td><td>{u.role === 'admin' ? '管理员' : '成员'}</td><td><span className={`badge ${u.active ? 'status-accepted' : 'status-cancelled'}`}>{u.active ? '正常' : '已停用'}</span>{u.must_change_password && <small>待修改初始密码</small>}</td><td>{u.id !== user.id && <div className="account-actions">
      <button className="text-btn" disabled={busy} onClick={() => void changeRole(u)}>
        {u.role === 'admin' ? '降为普通成员' : '升为管理员'}
      </button>
      <button className={`text-btn ${u.active ? 'danger-text' : ''}`} disabled={busy} onClick={() => { if (window.confirm(u.active ? `停用 ${u.name} 的账号？已登录的会话将立即失效。` : `启用 ${u.name} 的账号？`)) void run(() => api(`users/${u.id}`, { method: 'PATCH', body: JSON.stringify({ active: !u.active }) }), u.active ? '账号已停用' : '账号已启用'); }}>{u.active ? '停用' : '启用'}</button><details className="reset-password"><summary><KeyRound size={14} />重置密码</summary><form onSubmit={e => reset(e, u.id)}><input name="password" type="password" placeholder="至少12位新密码" minLength={12} maxLength={128} required autoComplete="new-password" aria-label={`${u.name}的新密码`} /><button className="btn secondary compact" disabled={busy}>确认重置</button></form></details><button className="text-btn danger-text" disabled={busy} onClick={() => { if (window.confirm(`删除 ${u.name} 的账号？其登录将失效，历史任务和奖励记录会保留。`)) void run(() => api(`users/${u.id}`, { method: "DELETE" }), "账号已删除"); }}>删除账号</button></div>}</td></tr>)}</tbody></table></div></section><section className="paper form-section create-account"><h2><UserPlus size={20} />创建成员账号</h2><form onSubmit={create}><label>成员姓名<input name="name" required maxLength={40} placeholder="成员的显示名称" /></label><label>登录账号<input name="username" required pattern="[a-zA-Z0-9_.\-]{3,32}" minLength={3} maxLength={32} placeholder="3至32位字母、数字等" autoComplete="off" /></label><label>初始密码<div className="password-input"><input name="password" type={visible ? 'text' : 'password'} required minLength={12} maxLength={128} placeholder="至少12位" autoComplete="new-password" /><button type="button" className="icon-btn" aria-label={visible ? '隐藏密码' : '显示密码'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={16} /> : <Eye size={16} />}</button></div></label><label>账号角色<select name="role"><option value="member">普通成员</option><option value="admin">管理员</option></select></label><p className="hint">成员首次登录必须修改初始密码。请通过可靠方式交付账号信息。</p><button className="btn primary full" disabled={busy}><UserPlus size={17} />{busy ? '正在保存…' : '创建账号'}</button></form></section></div></>;
}
