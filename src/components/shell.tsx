'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, LayoutDashboard, Plus, UsersRound, LogOut, ArrowUpRight, UserRound, Menu, X } from 'lucide-react';
import { useState } from 'react';
import { api } from '@/lib/client';
import type { User } from '@/lib/types';
export function Shell({ user, children }: { user: User; children: React.ReactNode }) {
  const pathname = usePathname(), [expanded, setExpanded] = useState(false), [error, setError] = useState('');
  const links = [{ href: '/tasks/new', title: '发布悬赏', icon: Plus }, { href: '/tasks', title: '悬赏大厅', icon: Compass }, { href: '/workspace', title: '我的工作台', icon: LayoutDashboard }, ...(user.role === 'admin' ? [{ href: '/admin', title: '成员管理', icon: UsersRound }] : [])];
  async function signOut() { try { await api('auth/logout', { method: 'POST' }); window.location.assign('/login'); } catch (e) { setError((e as Error).message); } }
  return <div className="app-shell"><div className="mobile-bar"><Link href="/tasks"><span className="seal small">赏</span>内部悬赏令</Link><button className="icon-btn" aria-label={expanded ? '收起菜单' : '展开菜单'} onClick={() => setExpanded(!expanded)}>{expanded ? <X /> : <Menu />}</button></div>
    <aside className={`sidebar ${expanded ? 'expanded' : ''}`}><Link className="brand" href="/tasks"><span className="seal">赏</span><div><strong>内部悬赏令</strong><span>让付出，有回报</span></div></Link><nav aria-label="主导航">{links.map(({ href, title, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${href === "/tasks/new" ? "publish-nav" : ""} ${(href === '/tasks' ? pathname === href || (pathname.startsWith('/tasks/') && pathname !== '/tasks/new') : pathname === href) ? 'active' : ''}`} onClick={() => setExpanded(false)}><Icon size={19} />{title}{href === '/tasks/new' && <ArrowUpRight size={15} className="nav-end" />}</Link>)}</nav>
      <div className="sidebar-note"><span className="note-pin" /><strong>每一份本事，都有用武之地</strong></div>
      <div className="profile"><Link href="/account" className="profile-info"><span className="avatar">{user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><span>{user.role === 'admin' ? '管理员' : '团队成员'}</span></div><UserRound size={16} /></Link><button className="logout" onClick={signOut}><LogOut size={15} />退出登录</button>{error && <p role="alert" className="error-text">{error}</p>}</div>
    </aside><main className="main-content">{user.must_change_password && <div className="notice warning">首次登录请先在“账号设置”中修改初始密码。</div>}{children}</main></div>;
}
