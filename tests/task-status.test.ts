import { describe, expect, it } from 'vitest';
import { taskDisplayStatus } from '../src/lib/task-status';

describe('悬赏领取进度状态', () => {
  const open = { status: 'open' as const, publication_status: 'approved' as const, capacity: 3, claimed_count: 0 };
  it('无人领取或人数不足时显示待领取', () => {
    expect(taskDisplayStatus(open)).toBe('awaiting-claim');
    expect(taskDisplayStatus({ ...open, claimed_count: 2 })).toBe('awaiting-claim');
  });
  it('名额已满但未完成时显示进行中，单人任务同样适用', () => {
    expect(taskDisplayStatus({ ...open, claimed_count: 3 })).toBe('in-progress');
    expect(taskDisplayStatus({ ...open, capacity: 1, claimed_count: 1 })).toBe('in-progress');
  });
  it('退出或被移除后按实际有效人数重新判断', () => {
    const task = { ...open, claimed_count: 3 };
    expect(taskDisplayStatus(task)).toBe('in-progress');
    task.claimed_count = 2;
    expect(taskDisplayStatus(task)).toBe('awaiting-claim');
  });
  it('审核状态和已结束状态优先，不被领取人数覆盖', () => {
    expect(taskDisplayStatus({ ...open, publication_status: 'pending' })).toBe('publication-pending');
    expect(taskDisplayStatus({ ...open, publication_status: 'rejected' })).toBe('publication-rejected');
    expect(taskDisplayStatus({ ...open, status: 'completed' })).toBe('completed');
    expect(taskDisplayStatus({ ...open, status: 'cancelled' })).toBe('cancelled');
  });
});
