import type { Task } from './types';

export function taskDisplayStatus(task: Pick<Task, 'status' | 'publication_status' | 'claimed_count' | 'capacity'>) {
  if (task.status !== 'open') return task.status;
  if (task.publication_status !== 'approved') return `publication-${task.publication_status}`;
  return task.claimed_count < task.capacity ? 'awaiting-claim' : 'in-progress';
}
