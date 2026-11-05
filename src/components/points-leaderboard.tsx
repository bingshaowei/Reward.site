'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { api } from '@/lib/client';
import type { PointsLeader } from '@/lib/types';

export function PointsLeaderboard({ initial, userId, demo }: { initial: PointsLeader[]; userId: string; demo: boolean }) {
  const [leaders, setLeaders] = useState(initial);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const displayedLeaders = demo ? initial : leaders;

  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    let refreshing = false;
    async function refresh() {
      if (document.hidden || refreshing) return;
      refreshing = true;
      try {
        const result = await api<{ leaders: PointsLeader[] }>('points-leaderboard', { signal: controller.signal, cache: 'no-store' });
        if (!controller.signal.aborted) {
          setLeaders(result.leaders);
          setRefreshFailed(false);
        }
      } catch {
        if (!controller.signal.aborted) setRefreshFailed(true);
      } finally {
        refreshing = false;
      }
    }
    void refresh();
    const interval = window.setInterval(refresh, 10_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [demo]);

  return <section className="paper points-leaderboard" aria-labelledby="points-leaderboard-title">
    <header className="leaderboard-header">
      <span className="leaderboard-icon"><Trophy size={23} aria-hidden="true" /></span>
      <div>
        <h2 id="points-leaderboard-title">{demo ? '示例积分榜' : '实时积分榜'}</h2>
        {demo
          ? <p className="muted">本地示例 · 10 位虚拟成员 · <Link className="leaderboard-live-link" href="/tasks">查看实时榜</Link></p>
          : <p className="muted">按悬赏验收所得积分排名 · 前 10 名 · 每 10 秒更新</p>}
      </div>
    </header>
    {displayedLeaders.length > 0 ? <ol role="list">
      {displayedLeaders.map(leader => <li key={leader.id} value={leader.rank} className={!demo && leader.id === userId ? 'leaderboard-self' : undefined}>
        <span className="leaderboard-rank" data-rank={leader.rank} aria-label={`第 ${leader.rank} 名`}>{leader.rank}</span>
        <span className="leaderboard-name">{leader.name}{!demo && leader.id === userId && <small className="leaderboard-you">我</small>}</span>
        <strong>{leader.points.toLocaleString('zh-CN')} <small>分</small></strong>
      </li>)}
    </ol> : <p className="muted leaderboard-note">暂无积分奖励，成果验收通过后即可上榜。</p>}
    {refreshFailed && <p className="muted leaderboard-note" role="status">暂时无法更新，稍后会自动重试。</p>}
  </section>;
}
