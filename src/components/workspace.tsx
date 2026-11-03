'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Coins, CircleDollarSign, FileCheck2, Plus } from 'lucide-react';
import type { User, Task, Reward, Overview } from '@/lib/types';
import { displayReward } from '@/lib/rules';
import { api } from '@/lib/client';
import { Empty } from './ui';
import { TeamClock } from './team-clock';
import { PointsWallet } from './points-wallet';
import type { getWallet } from '@/lib/wallet';
import { TaskCard } from './board';
import { RewardTable } from './task-detail';
export function Workspace({ user, published, claimed, initialRewards, initialManagedRewards, initialOverview, wallet }: { user: User; published: Task[]; claimed: Task[]; initialRewards: Reward[]; initialManagedRewards: Reward[]; initialOverview: Overview; wallet: Awaited<ReturnType<typeof getWallet>> }) {
  const [tab, setTab] = useState('claimed'), [rewards, setRewards] = useState(initialRewards), [managedRewards, setManagedRewards] = useState(initialManagedRewards), [overview, setOverview] = useState(initialOverview), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mine = rewards, points = overview.points, money = overview.total_money, pending = published.filter(t => t.pending_count > 0);
  const tasks = tab === 'published' ? published : tab === 'review' ? pending : claimed;
  async function settle(id: string) { if (!window.confirm('确认已在线下付款？网站只登记结算状态，不会转账。')) return; setBusy(true); setError(''); try { await api(`rewards/${id}/settle`, { method: 'POST' }); const [own, managed, summary] = await Promise.all([api<{ rewards: Reward[] }>('rewards'), api<{ rewards: Reward[] }>('rewards?managed=true'), api<{ overview: Overview }>('overview')]); setRewards(own.rewards); setManagedRewards(managed.rewards); setOverview(summary.overview); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 我的工作台</div><TeamClock /></header><div className="page-heading heading-row"><div><h1>{user.name}的工作台</h1><p>跟进手上的工作，也看看努力带来的回报。</p></div><Link href="/tasks/new" className="btn primary"><Plus size={17} />发布悬赏</Link></div><PointsWallet wallet={wallet} /><section className="workspace-stats"><div className="paper balance-card"><Coins size={23} /><span>累计获得积分</span><strong>{points.toLocaleString('zh-CN')}<small>积分</small></strong><p>验收通过后自动累计</p></div><div className="paper balance-card"><CircleDollarSign size={23} /><span>累计金额奖励</span><strong>{displayReward(money, 'money')}</strong><p>其中 {displayReward(overview.pending_money, 'money')} 待线下结算</p></div><div className="paper balance-card"><FileCheck2 size={23} /><span>等我验收的交付</span><strong>{overview.pending_reviews}<small>份</small></strong><p>及时反馈，让工作继续向前</p></div></section><div className="tabs workspace-tabs">{[['claimed', `我承接的 (${claimed.length})`], ['published', `我发布的 (${published.length})`], ['review', `待我验收 (${pending.length})`], ['rewards', '我的奖励明细'], ['settlements', '结算管理']].map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{label}</button>)}</div>{error && <p role="alert" className="notice danger">{error}</p>}{['rewards', 'settlements'].includes(tab) ? <section className="paper detail-section"><h2>{tab === 'rewards' ? '我的奖励明细' : '我负责的结算记录'}</h2><RewardTable user={user} busy={busy} onSettle={settle} rewards={tab === 'rewards' ? mine : managedRewards} /></section> : tasks.length ? <div className="task-grid">{tasks.map(task => <TaskCard task={task} key={task.id} />)}</div> : <Empty title={tab === 'review' ? '当前没有待验收的成果' : '这里还没有悬赏记录'} description={tab === 'review' ? '成员提交后，会在这里提醒你。' : '去悬赏大厅看看，或发布一份新的工作。'}><Link href="/tasks" className="btn secondary">去悬赏大厅</Link></Empty>}</>;
}
