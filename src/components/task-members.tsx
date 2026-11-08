'use client';
import { useEffect, useRef, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import type { Claim, TaskDetail, User } from '@/lib/types';
import { date } from '@/lib/client';
import { Status } from './ui';

export function TaskMembers({ data, user, busy, error, clearError, action }: {
  data: TaskDetail; user: User; busy: boolean; error: string; clearError: () => void;
  action: (url: string, body: unknown, success: string) => Promise<boolean>;
}) {
  const { task, claims, replacementOptions } = data;
  const members = claims.filter(claim => !['withdrawn', 'cancelled', 'removed'].includes(claim.status));
  const removed = claims.filter(claim => claim.status === 'removed');
  const mine = removed.find(claim => claim.user_id === user.id);
  const [selected, setSelected] = useState<Claim | null>(null), [reason, setReason] = useState('');
  const [search, setSearch] = useState(''), [selectedIds, setSelectedIds] = useState<string[]>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && !dialog.current?.open) dialog.current?.showModal();
    if (!selected && dialog.current?.open) dialog.current.close();
  }, [selected]);
  const matches = replacementOptions?.filter(member => `${member.name} ${member.username}`.toLowerCase().includes(search.trim().toLowerCase()));
  async function remove(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selected || busy || !reason.trim()) return;
    if (await action(`tasks/${task.id}/claims/${selected.id}/remove`, { reason: reason.trim() }, `已移除 ${selected.name}，操作不会新增扣分`)) setSelected(null);
  }
  async function addRecipients(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy || !selectedIds.length) return;
    if (await action(`tasks/${task.id}/recipients/add`, { memberIds: selectedIds }, '已补充指定人选，成员可按原领取规则补位')) { setSelectedIds([]); setSearch(''); }
  }
  return <section className="paper detail-section">
    <div className="section-title"><h2>承接成员 <span>{members.length} / {task.capacity}</span></h2>{task.team_locked && <span className="tag neutral">成员已锁定</span>}</div>
    {mine && <div className="notice warning"><div><strong>你已被移除这份悬赏</strong><p>原因：{mine.removal_reason}</p><p>本次移除不扣分，已有扣分保留。你不能再次领取或继续提交，但可查看本人原有交付。</p></div></div>}
    {members.length ? <div className="members-list">{members.map(claim => <div key={claim.id} className="member-row">
      <span className="avatar">{claim.name.slice(0, 1)}</span><div><strong>{claim.name}{claim.user_id === user.id && <small>（我）</small>}</strong><small>{date(claim.created_at)} 领取</small></div>
      <div className="member-actions"><Status value={claim.status} />{user.role === 'admin' && task.status === 'open' && ['working', 'submitted', 'revision'].includes(claim.status) && <button type="button" className="btn secondary compact danger-text" aria-label={`移除成员 ${claim.name}`} disabled={busy} onClick={() => { clearError(); setReason(''); setSelected(claim); }}><UserMinus size={15} />移除成员</button>}</div>
    </div>)}</div> : <p className="muted">还没有成员领取，等待合适的伙伴加入。</p>}
    {removed.length > 0 && <details className="removed-members" open><summary>已移除成员（{removed.length}）</summary>{removed.map(claim => <article className="removed-member" key={claim.id}>
      <div className="removed-member-heading"><strong>{claim.name}{claim.user_id === user.id && '（我）'}</strong><Status value="removed" /></div>
      {claim.removal_reason !== undefined && <><p>移除原因：{claim.removal_reason}</p><small>操作人：{claim.removed_by_name} · {date(claim.removed_at, true)}</small></>}
    </article>)}</details>}
    {replacementOptions !== undefined && <div className="replacement-picker">
      <h3><UserPlus size={18} />补充指定人选</h3><p className="hint">保留原指定名单，仅增加补位人选；不改变任务要求、奖励或名额，被移除者不可重新加入。</p>
      <form onSubmit={addRecipients}><label>搜索补位成员<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="输入姓名或账号" /></label>
        <div className="recipient-results" role="group" aria-label="可补充的指定成员">{matches?.map(member => <button type="button" key={member.id} className="recipient-option" aria-pressed={selectedIds.includes(member.id)} disabled={busy} onClick={() => setSelectedIds(ids => ids.includes(member.id) ? ids.filter(id => id !== member.id) : [...ids, member.id])}><span>{member.name} <small>@{member.username}</small></span><span>{selectedIds.includes(member.id) ? '已选' : '选择'}</span></button>)}{matches?.length === 0 && <p className="hint">没有可补充的成员。</p>}</div>
        <button type="submit" className="btn secondary" disabled={busy || !selectedIds.length}>补充指定人选{selectedIds.length > 0 && `（${selectedIds.length}人）`}</button>
      </form>
    </div>}
    <dialog className="member-removal-dialog paper" ref={dialog} aria-labelledby="remove-member-title" onCancel={event => { if (busy) event.preventDefault(); else setSelected(null); }} onClose={() => setSelected(null)}>
      <form onSubmit={remove}><h2 id="remove-member-title">移除成员：{selected?.name}</h2>
        <p>该成员将无法再次领取这份悬赏或继续提交成果。操作不新增扣分，已有扣分保留，记录不会删除。</p>
        <p className="notice warning">{task.mode === 'team' && task.team_locked ? members.length > 1 ? '现有团队成果保留，不再补招。剩余成员继续验收，总奖励只向剩余成员分配。' : '团队将没有承接成员，原待验收成果终止验收；任务重新开放补招，新团队须重新交付。' : task.mode === 'team' ? '移除后释放名额，剩余成员可继续工作，其他符合条件的成员可以补位。' : '移除后释放名额。该成员待验收的成果将终止验收，正文和附件仍保留。'}</p>
        <label>移除原因 <span className="hint">（必填，仅管理员、发布者和被移除者可见）</span><textarea autoFocus required rows={4} maxLength={2000} value={reason} onChange={event => setReason(event.target.value)} placeholder="请写明调整成员的具体原因" /></label>
        <p className="hint">{reason.length} / 2000 字</p>{error && <p className="notice danger" role="alert">{error}</p>}
        <div className="button-row"><button type="button" className="btn secondary" disabled={busy} onClick={() => setSelected(null)}>暂不移除</button><button type="submit" className="btn primary" disabled={busy || !reason.trim()}>{busy ? '正在移除…' : '确认移除成员'}</button></div>
      </form>
    </dialog>
  </section>;
}
