'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, ArrowUpRight, Users, Clock3, LayoutGrid, List, ScrollText, CheckCheck, CircleDollarSign, Coins, SlidersHorizontal } from 'lucide-react';
import type { User, Task, Overview } from '@/lib/types';
import { displayReward } from '@/lib/rules';
import { date } from '@/lib/client';
import { TeamClock } from './team-clock';
import { Status, Empty, publicationDisplayStatus } from './ui';

export function TaskCard({ task: t }: { task: Task }) {
  const remaining = t.capacity - t.claimed_count, overdue = t.status === 'open' && t.deadline && new Date(t.deadline).getTime() < Date.now();
  return <Link href={`/tasks/${t.id}`} className={`task-card paper ${t.reward_type === 'points' ? 'points-card' : ''}`}><div className="task-tags card-labels"><span className={`tag ${t.reward_type}`}>{t.reward_type === 'money' ? '金额悬赏' : '积分悬赏'}</span><span className="tag neutral">{t.mode === 'team' ? '团队协作' : t.capacity === 1 ? '单人任务' : '多人独立'}</span>{t.is_demo && <span className="tag neutral">示例</span>}{t.tags.map(tag => <span className="tag neutral" key={tag}>{tag}</span>)}<Status value={publicationDisplayStatus(t)} /></div><h3>{t.title}</h3><p className="task-excerpt">{t.description}</p><div className="reward-line"><strong>{t.reward_type === 'money' ? <><small>¥</small>{(t.reward_units / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</> : <>{t.reward_units.toLocaleString('zh-CN')}<small>积分</small></>}</strong><span>{t.mode === 'team' ? '团队总奖励' : '每人奖励'}</span><ArrowUpRight size={21} /></div><div className="task-card-footer"><span><Users size={14} />{t.status === 'open' ? t.team_locked ? '成员已锁定' : remaining > 0 ? `剩余 ${remaining} / ${t.capacity} 名额` : '名额已满' : `${t.accepted_count} 人已通过`}</span><span className={overdue ? 'overdue' : ''}><Clock3 size={13} />{t.deadline ? `${date(t.deadline)}${overdue ? ' · 已逾期' : ' 截止'}` : '不限截止日期'}</span></div><div className="task-publisher"><span className="tiny-avatar">{t.publisher_name.slice(0, 1)}</span>{t.publisher_name}<span>{date(t.created_at)} 发布</span></div></Link>;
}
export function Board({ user, tasks, overview }: { user: User; tasks: Task[]; overview: Overview }) {
  const [q, setQ] = useState(''), [status, setStatus] = useState('open'), [reward, setReward] = useState(''), [mode, setMode] = useState(''), [listView, setListView] = useState(false);
  const [tag, setTag] = useState(''), [sort, setSort] = useState<'recent' | 'points' | 'money'>('recent');
  const tags = [...new Set(tasks.flatMap(task => task.tags))].sort();
  const visible = useMemo(() => tasks.filter(t => (!q || `${t.title} ${t.description} ${t.tags.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase())) && (!status || t.status === status) && (!reward || t.reward_type === reward) && (!mode || t.mode === mode) && (!tag || t.tags.includes(tag))).sort((a, b) => {
    if (sort !== 'recent') {
      if (a.reward_type !== b.reward_type) return a.reward_type === sort ? -1 : 1;
      if (a.reward_type === sort && a.reward_units !== b.reward_units) return b.reward_units - a.reward_units;
    }
    return Date.parse(b.created_at) - Date.parse(a.created_at);
  }), [tasks, q, status, reward, mode, tag, sort]);
  const open = { length: overview.open_tasks }, pending = overview.pending_reviews, points = overview.points;
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 悬赏大厅</div><TeamClock /></header><section className="board-hero"><div><h1>让本事，<span>找到好任务。</span></h1><p>发现任务，领取悬赏，和团队一起把事情做好。</p><Link href="/tasks/new" className="btn primary"><Plus size={18} />发布一份悬赏<ArrowUpRight size={17} /></Link></div><div className="hero-stamp" aria-hidden="true"><span>团队协作 · 有能者来</span><strong>悬赏<br />招募中</strong><span>{open.length} 份进行中的悬赏</span></div></section>
    <section className="stats-grid" aria-label="悬赏概况"><div className="stat"><span className="stat-icon terracotta"><ScrollText size={20} /></span><div><span>进行中的悬赏</span><strong>{open.length}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon sage"><CheckCheck size={20} /></span><div><span>已完成的悬赏</span><strong>{overview.completed_tasks}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon ochre"><Clock3 size={20} /></span><div><span>待我验收</span><strong>{pending}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon brown"><Coins size={20} /></span><div><span>我的累计积分</span><strong>{points.toLocaleString('zh-CN')}<small>分</small></strong></div></div></section>
    <section className="board-list"><div className="section-title"><h2>寻找悬赏<span>{visible.length}</span></h2><div className="view-switch" aria-label="显示方式"><button aria-label="卡片显示" aria-pressed={!listView} className={!listView ? 'selected' : ''} onClick={() => setListView(false)}><LayoutGrid size={17} /></button><button aria-label="列表显示" aria-pressed={listView} className={listView ? 'selected' : ''} onClick={() => setListView(true)}><List size={17} /></button></div></div>
      <div className="filter-bar"><div className="search-input"><Search size={18} /><input aria-label="搜索悬赏" placeholder="搜索任务名称、工作内容…" value={q} onChange={e => setQ(e.target.value)} /></div><label className="filter-select"><SlidersHorizontal size={15} /><select aria-label="奖励类型" value={reward} onChange={e => setReward(e.target.value)}><option value="">全部奖励</option><option value="money">金额悬赏</option><option value="points">积分悬赏</option></select></label><label className="filter-select"><Users size={15} /><select aria-label="任务模式" value={mode} onChange={e => setMode(e.target.value)}><option value="">全部模式</option><option value="independent">独立完成</option><option value="team">团队协作</option></select></label></div>
      <div className="board-options">
        <label className="filter-select">任务标签<select aria-label="任务标签" value={tag} onChange={event => setTag(event.target.value)}><option value="">全部标签</option>{tags.map(name => <option key={name}>{name}</option>)}</select></label>
        <label className="filter-select board-sort">排序<select aria-label="排序" value={sort} onChange={event => setSort(event.target.value as typeof sort)}><option value="recent">最新发布</option><option value="points">积分从高到低</option><option value="money">金额从高到低</option></select></label>
      </div>
      <div className="tabs">{[['open', '进行中'], ['', '全部悬赏'], ['completed', '已完成'], ['cancelled', '已取消']].map(([v, label]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{label}</button>)}</div>
      {visible.length ? <div className={`task-grid ${listView ? 'list-view' : ''}`}>{visible.map(t => <TaskCard key={t.id} task={t} />)}</div> : <Empty title={q || reward || mode ? '没有找到匹配的悬赏' : '还没有这类悬赏'} description="试试调整筛选条件，或发布团队的第一份悬赏。"><Link href="/tasks/new" className="btn secondary"><Plus size={16} />发布悬赏</Link></Empty>}
      <p className="footnote">金额奖励在线下结算，积分在验收通过后自动累计。{tasks.some(t => t.is_demo) && '标记“示例”的内容仅用于本地演示。'}{tasks.length === 500 && '当前展示最新500份悬赏。'}</p></section></>;
}
