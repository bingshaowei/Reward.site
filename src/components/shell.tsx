'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Compass, LayoutDashboard, Plus, UsersRound, LogOut, ArrowUpRight, UserRound, Menu, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, pendingReviewsChanged } from '@/lib/client';
import type { PendingReviews, User } from '@/lib/types';
export function Shell({ user, children, initialPending }: { user: User; children: React.ReactNode; initialPending: PendingReviews | null }) {
  const pathname = usePathname(), [expanded, setExpanded] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState(initialPending);
  const canSeePending = initialPending !== null;
  useEffect(() => {
    if (!canSeePending) return;
    let controller: AbortController | undefined;
    async function refresh() {
      if (document.hidden) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      try {
        const result = await api<PendingReviews>('admin/pending-reviews', { signal: request.signal, cache: 'no-store' });
        if (!request.signal.aborted) setPending(result);
      } catch { /* Keep the last count until the next refresh. */ }
    }
    void refresh();
    const interval = window.setInterval(refresh, 15_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(pendingReviewsChanged, refresh);
    return () => {
      controller?.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(pendingReviewsChanged, refresh);
    };
  }, [canSeePending, pathname]);
  const count = canSeePending && pending ? pending.tasks + pending.registrations : 0;
  const countText = count > 99 ? '99+' : count;
  const links = [{ href: '/tasks/new', title: '发布悬赏', icon: Plus }, { href: '/tasks', title: '悬赏大厅', icon: Compass }, { href: '/workspace', title: '我的工作台', icon: LayoutDashboard }, ...(user.role === 'admin' ? [{ href: '/admin', title: '成员管理', icon: UsersRound }] : [])];
  async function signOut() { try { await api('auth/logout', { method: 'POST' }); window.location.assign('/login'); } catch (e) { setError((e as Error).message); } }
  return <div className="app-shell"><div className="mobile-bar"><Link href="/tasks"><span className="seal small">赏</span>CCP悬赏令</Link><button className="icon-btn review-menu" aria-label={`${expanded ? '收起菜单' : '展开菜单'}${count ? `，${count} 项待审核` : ''}`} onClick={() => setExpanded(!expanded)}>{expanded ? <X /> : <Menu />}{count > 0 && <span className="review-count" aria-hidden="true">{countText}</span>}</button></div>
    <aside className={`sidebar ${expanded ? 'expanded' : ''}`}><Link className="brand" href="/tasks"><span className="seal">赏</span><div><strong>CCP悬赏令</strong><span>让付出，有回报</span></div></Link><nav aria-label="主导航">{links.map(({ href, title, icon: Icon }) => <Link key={href} href={href} className={`nav-link ${href === "/tasks/new" ? "publish-nav" : ""} ${(href === '/tasks' ? pathname === href || (pathname.startsWith('/tasks/') && pathname !== '/tasks/new') : pathname === href) ? 'active' : ''}`} onClick={() => setExpanded(false)}><Icon size={19} />{title}{href === '/tasks/new' && <ArrowUpRight size={15} className="nav-end" />}{href === '/admin' && count > 0 && pending && <span className="review-count" aria-label={`${count} 项待审核`} title={`${pending.tasks} 份悬赏、${pending.registrations} 份注册待审核`}>{countText}</span>}</Link>)}</nav>
      <div className="sidebar-note"><span className="note-pin" /><strong>每一份本事，都有用武之地</strong></div>
      <div className="profile"><Link href="/account" className="profile-info"><span className="avatar">{user.avatar_version ? <img src={`/api/me/avatar?v=${user.avatar_version}`} alt={`${user.name}的头像`} /> : user.name.slice(0, 1)}</span><div><strong>{user.name}</strong><span>{user.role === 'admin' ? '管理员' : '团队成员'}</span></div><UserRound size={16} /></Link><button className="logout" onClick={signOut}><LogOut size={15} />退出登录</button>{error && <p role="alert" className="error-text">{error}</p>}</div>
    </aside><main className="main-content">{user.must_change_password && <div className="notice warning">首次登录请先在“账号设置”中修改初始密码。</div>}{children}</main></div>;
}
