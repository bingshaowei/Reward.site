'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Plus, ArrowUpRight, ArrowUp, ArrowDown, Users, Clock3, LayoutGrid, List, ScrollText, CheckCheck, Coins, SlidersHorizontal } from 'lucide-react';
import type { User, Task, Overview, PointsLeader, RewardVote } from '@/lib/types';
import { api, date } from '@/lib/client';
import { TeamClock } from './team-clock';
import { PointsLeaderboard } from './points-leaderboard';
import { Status, Empty, publicationDisplayStatus } from './ui';

function RewardFeedback({ task }: { task: Task }) {
  const [vote, setVote] = useState(task.reward_vote);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function selectVote(choice: RewardVote) {
    setBusy(true);
    setError('');
    try {
      const result = await api<{ vote: RewardVote | null }>(`tasks/${task.id}/reward-feedback`, {
        method: 'POST', body: JSON.stringify({ vote: vote === choice ? null : choice }),
      });
      setVote(result.vote);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <div className="reward-feedback" role="group" aria-label={`反馈悬赏奖励 ${task.title}`}>
    <button type="button" aria-pressed={vote === 'low'} disabled={busy} onClick={() => void selectVote('low')}><ArrowDown size={14} aria-hidden="true" />悬赏偏低</button>
    <button type="button" aria-pressed={vote === 'high'} disabled={busy} onClick={() => void selectVote('high')}><ArrowUp size={14} aria-hidden="true" />悬赏偏高</button>
    {error && <span className="danger-text" role="alert">{error}</span>}
  </div>;
}

export function TaskCard({ task: t, viewerId }: { task: Task; viewerId?: string }) {
  const remaining = t.capacity - t.claimed_count, overdue = t.status === 'open' && t.deadline && new Date(t.deadline).getTime() < Date.now();
  return <article className={`task-card paper ${t.reward_type === 'points' ? 'points-card' : ''}`}>
    <Link href={`/tasks/${t.id}`} className="task-card-link" aria-label={t.title} />
    <div className="task-tags card-labels"><span className={`tag ${t.reward_type}`}>{t.reward_type === 'money' ? '金额悬赏' : '积分悬赏'}</span><span className="tag neutral">{t.mode === 'team' ? '团队协作' : t.capacity === 1 ? '单人任务' : '多人独立'}</span>{t.assignment_mode !== 'public' && <span className={t.selected_for_viewer ? 'tag recipient-for-me' : 'tag neutral'}>{t.selected_for_viewer ? '指定给我' : t.assignment_mode === 'assigned' ? '指定领取' : '推荐人选'}</span>}{t.is_demo && <span className="tag neutral">示例</span>}{t.tags.map(tag => <span className="tag neutral" key={tag}>{tag}</span>)}<Status value={publicationDisplayStatus(t)} /></div>
    <h3>{t.title}</h3><p className="task-excerpt">{t.description}</p>
    <div className="reward-line"><strong>{t.reward_type === 'money' ? <><small>¥</small>{(t.reward_units / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}</> : <>{t.reward_units.toLocaleString('zh-CN')}<small>积分</small></>}</strong><span>{t.mode === 'team' ? '团队总奖励' : '每人奖励'}</span><ArrowUpRight size={21} /></div>
    <div className="task-card-footer"><span><Users size={14} />{t.status === 'open' ? t.team_locked ? '成员已锁定' : remaining > 0 ? `剩余 ${remaining} / ${t.capacity} 名额` : '名额已满' : `${t.accepted_count} 人已通过`}</span><span className={overdue ? 'overdue' : ''}><Clock3 size={13} />{t.deadline ? `${date(t.deadline, true)}${overdue ? ' · 已逾期' : ' 截止'}` : '不限截止日期'}</span></div>
    <div className="task-publisher"><span className="tiny-avatar">{t.publisher_name.slice(0, 1)}</span>{t.publisher_name}<span>{date(t.created_at)} 发布</span></div>
    {viewerId && viewerId !== t.publisher_id && t.status === 'open' && t.publication_status === 'approved' && <RewardFeedback task={t} />}
    {t.low_votes !== null && t.high_votes !== null && t.publication_status === 'approved' &&
      <p className="reward-feedback-summary hint">奖励反馈 · 偏低 {t.low_votes} · 偏高 {t.high_votes}</p>}
  </article>;
}
export function Board({ user, tasks, overview, leaders, tags, leaderboardDemo }: {
  user: User; tasks: Task[]; overview: Overview; leaders: PointsLeader[]; tags: string[]; leaderboardDemo: boolean;
}) {
  const [q, setQ] = useState(''), [status, setStatus] = useState('open'), [reward, setReward] = useState(''), [mode, setMode] = useState(''), [listView, setListView] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [sort, setSort] = useState<'recent' | 'points' | 'money'>('recent');
  const [ascending, setAscending] = useState(false);
  const visible = useMemo(() => {
    const query = q.trim().toLowerCase();
    const direction = ascending ? 1 : -1;
    return tasks.filter(task =>
      (!query || `${task.title} ${task.description} ${task.tags.join(' ')}`.toLowerCase().includes(query)) &&
      (!status || task.status === status) && (!reward || task.reward_type === reward) && (!mode || task.mode === mode) &&
      (!selectedTags.length || selectedTags.some(tag => task.tags.includes(tag)))
    ).sort((a, b) => {
      const dateDifference = Date.parse(a.created_at) - Date.parse(b.created_at);
      if (sort === 'recent') return direction * dateDifference;
      if (a.reward_type !== b.reward_type) return a.reward_type === sort ? -1 : 1;
      if (a.reward_type === sort && a.reward_units !== b.reward_units) return direction * (a.reward_units - b.reward_units);
      return -dateDifference;
    });
  }, [tasks, q, status, reward, mode, selectedTags, sort, ascending]);
  function toggleTag(tag: string) {
    setSelectedTags(current => current.includes(tag) ? current.filter(name => name !== tag) : [...current, tag]);
  }
  const open = { length: overview.open_tasks }, pending = overview.pending_reviews, points = overview.points;
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 悬赏大厅</div><TeamClock /></header><section className="board-hero"><div><h1>让本事，<span>找到好任务。</span></h1><p>发现任务，领取悬赏，和团队一起把事情做好。</p><Link href="/tasks/new" className="btn primary"><Plus size={18} />发布一份悬赏<ArrowUpRight size={17} /></Link></div><div className="hero-stamp" aria-hidden="true"><span>团队协作 · 有能者来</span><strong>悬赏<br />招募中</strong><span><b className="hero-stamp-count">{open.length}</b> 份进行中的悬赏</span></div></section>
    <div className="board-overview">
      <section className="stats-grid" aria-label="悬赏概况"><div className="stat"><span className="stat-icon terracotta"><ScrollText size={20} /></span><div><span>进行中的悬赏</span><strong>{open.length}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon sage"><CheckCheck size={20} /></span><div><span>已完成的悬赏</span><strong>{overview.completed_tasks}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon ochre"><Clock3 size={20} /></span><div><span>待我验收</span><strong>{pending}<small>份</small></strong></div></div><div className="stat"><span className="stat-icon brown"><Coins size={20} /></span><div><span>我的累计积分</span><strong>{points.toLocaleString('zh-CN')}<small>分</small></strong></div></div></section>
      <PointsLeaderboard key={leaderboardDemo ? 'demo' : 'live'} initial={leaders} userId={user.id} demo={leaderboardDemo} />
    </div>
    <section className="board-list"><div className="section-title"><h2>寻找悬赏<span>{visible.length}</span></h2><div className="view-switch" aria-label="显示方式"><button aria-label="卡片显示" aria-pressed={!listView} className={!listView ? 'selected' : ''} onClick={() => setListView(false)}><LayoutGrid size={17} /></button><button aria-label="列表显示" aria-pressed={listView} className={listView ? 'selected' : ''} onClick={() => setListView(true)}><List size={17} /></button></div></div>
      <div className="filter-bar">
        <div className="search-input"><Search size={18} /><input aria-label="搜索悬赏" placeholder="搜索任务名称、工作内容…" value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="filter-select"><SlidersHorizontal size={16} aria-hidden="true" /><select aria-label="奖励类型" value={reward} onChange={e => setReward(e.target.value)}><option value="">全部奖励</option><option value="money">金额悬赏</option><option value="points">积分悬赏</option></select></div>
        <div className="filter-select"><Users size={16} aria-hidden="true" /><select aria-label="任务模式" value={mode} onChange={e => setMode(e.target.value)}><option value="">全部模式</option><option value="independent">独立完成</option><option value="team">团队协作</option></select></div>
      </div>
      <div className="board-options">
        <div className="board-tags tag-picker" role="group" aria-label="按任务标签筛选">
          <span>任务标签</span>
          <button type="button" className="tag-choice" aria-pressed={!selectedTags.length} onClick={() => setSelectedTags([])}>全部标签</button>
          {tags.map(tag => <button type="button" className="tag-choice" aria-pressed={selectedTags.includes(tag)} key={tag} onClick={() => toggleTag(tag)}>{tag}</button>)}
        </div>
        <div className="board-sort">
          <label htmlFor="board-sort">排序</label>
          <select id="board-sort" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
            <option value="recent">发布时间</option><option value="points">积分奖励</option><option value="money">金额奖励</option>
          </select>
          <button type="button" className="sort-direction" onClick={() => setAscending(value => !value)}
            title={ascending ? '切换为降序' : '切换为升序'} aria-label={ascending ? '当前升序，切换为降序' : '当前降序，切换为升序'}>
            {ascending ? <ArrowUp size={15} /> : <ArrowDown size={15} />}
            {ascending ? '升序' : '降序'}
          </button>
        </div>
      </div>
      <div className="tabs">{[['open', '进行中'], ['', '全部悬赏'], ['completed', '已完成'], ['cancelled', '已取消']].map(([v, label]) => <button key={v} className={status === v ? 'active' : ''} onClick={() => setStatus(v)}>{label}</button>)}</div>
      {visible.length ? <div className={`task-grid ${listView ? 'list-view' : ''}`}>{visible.map(t => <TaskCard key={t.id} task={t} viewerId={user.id} />)}</div> : <Empty title={q || reward || mode || selectedTags.length ? '没有找到匹配的悬赏' : '还没有这类悬赏'} description="试试调整筛选条件，或发布团队的第一份悬赏。"><Link href="/tasks/new" className="btn secondary"><Plus size={16} />发布悬赏</Link></Empty>}
      <p className="footnote">金额奖励在线下结算，积分在验收通过后自动累计。{tasks.some(t => t.is_demo) && '标记“示例”的内容仅用于本地演示。'}{tasks.length === 500 && '当前展示最新500份悬赏。'}</p></section></>;
}
