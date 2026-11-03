export type User = { id: string; username: string; name: string; role: 'admin' | 'member'; active: boolean; must_change_password: boolean };
export type Task = {
 id: string; publisher_id: string; publisher_name: string; title: string; description: string; criteria: string;
 mode: 'independent' | 'team'; reward_type: 'money' | 'points'; reward_units: number; capacity: number;
 status: 'open' | 'completed' | 'cancelled'; deadline: string | null; first_claimed_at: string | null;
 publication_status: 'pending' | 'approved' | 'rejected'; publication_note: string | null; publication_version: number;
 team_locked: boolean; ended_at: string | null; created_at: string; is_demo: boolean;
 claimed_count: number; accepted_count: number; pending_count: number;
 tags: string[];
 points_reserved: string;
};
export type Claim = { id: string; task_id: string; user_id: string; name: string; status: 'working' | 'submitted' | 'revision' | 'accepted' | 'withdrawn' | 'cancelled'; submitted_before: boolean; created_at: string; overdue_days_charged: number };
export type Submission = { id: string; task_id: string; claim_id: string | null; submitter_id: string; submitter_name: string; content: string; status: 'pending' | 'approved' | 'revision'; review_note: string | null; created_at: string };
export type Attachment = { id: string; task_id: string; submission_id: string | null; name: string; size: number; expired_at: string | null; expires_at: string | null };
export type Reward = { id: string; task_id: string; title: string; user_id: string; name: string; reward_type: 'money' | 'points'; units: number; paid_at: string | null; created_at: string; publisher_id: string };
export type TaskDetail = { task: Task; claims: Claim[]; submissions: Submission[]; attachments: Attachment[]; rewards: Reward[] };
export type Overview = { open_tasks: number; completed_tasks: number; pending_reviews: number; points: number; total_money: number; pending_money: number };
