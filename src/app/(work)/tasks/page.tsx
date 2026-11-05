import { requireUser } from '@/lib/server';
import { getPool } from '@/lib/db';
import { listTasks, getOverview, listPointsLeaders, listTags } from '@/lib/tasks';
import { serializable } from '@/lib/client';
import { Board } from '@/components/board';
const demoNames = ['林小满', '许青禾', '陈向阳', '周云舟', '程知夏', '梁未央', '沈初白', '唐溪月', '陆南星', '叶听雨'];

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ leaderboard?: string | string[] }> }) {
  const user = await requireUser();
  const pool = getPool();
  const leaderboardDemo = process.env.BOUNTY_LOCAL_LEADERBOARD_PREVIEW === '1' && (await searchParams).leaderboard === 'demo';
  const [tasks, overview, leaders, tags] = await Promise.all([
    listTasks(pool, { userId: user.id }), getOverview(pool, user),
    leaderboardDemo
      ? demoNames.map((name, index) => ({
        id: `demo-${index}`, name, rank: index + 1,
        points: 160 + (demoNames.length - index - 1) * 100 + Math.floor(Math.random() * 100),
      }))
      : listPointsLeaders(pool),
    listTags(pool),
  ]);
  return <Board user={user} tasks={serializable(tasks)} overview={overview} leaders={leaders} tags={tags} leaderboardDemo={leaderboardDemo} />;
}
