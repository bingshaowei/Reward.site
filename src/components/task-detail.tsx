'use client';
import Link from 'next/link';
import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, Users, Clock3, Check, FileCheck2, Pencil, Send, Info, Trash2 } from 'lucide-react';
import type { TaskDetail, User, Submission, Reward } from '@/lib/types';
import { api, formBody, date, pendingReviewsChanged } from '@/lib/client';
import { toUnits, displayReward } from '@/lib/rules';
import { TaskMembers } from './task-members';
import { Status, publicationDisplayStatus, Attachments, FilePicker, Empty } from './ui';

export function RewardTable({ rewards, user, onSettle, busy }: { rewards: Reward[]; user: User; onSettle: (id: string) => void; busy: boolean }) {
  return rewards.length ? <div className="table-scroll"><table><thead><tr><th>悬赏 / 成员</th><th>奖励</th><th>结算情况</th><th>操作</th></tr></thead><tbody>{rewards.map(r => <tr key={r.id}><td>{r.task_removed ? <>{r.title}<small>悬赏已删除</small></> : <Link href={`/tasks/${r.task_id}`}>{r.title}</Link>}<small>{r.name} · {date(r.created_at)}</small></td><td className="reward-cell">{displayReward(r.units, r.reward_type)}</td><td>{r.reward_type === 'points' ? <span className="badge status-accepted">已计入积分</span> : r.paid_at ? <><span className="badge status-accepted">已线下结算</span><small>{date(r.paid_at, true)}</small></> : <span className="badge status-submitted">待线下结算</span>}</td><td>{r.reward_type === 'money' && !r.paid_at && (r.publisher_id === user.id || user.role === 'admin') ? <button className="btn secondary compact" disabled={busy} onClick={() => onSettle(r.id)}>登记已付款</button> : <span className="muted">—</span>}</td></tr>)}</tbody></table></div> : <Empty title="暂无奖励记录" description="成果验收通过后，奖励会显示在这里。" />;
}
export function TaskDetailView({ user, initial }: { user: User; initial: TaskDetail }) {
  const [data, setData] = useState(initial), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [files, setFiles] = useState<File[]>([]);
  const { task: t, claims, submissions, attachments, rewards, recipients, references } = data;
  const managing = t.publisher_id === user.id || user.role === 'admin', mine = claims.find(c => c.user_id === user.id && c.status !== 'withdrawn');
  const members = claims.filter(c => !['withdrawn', 'cancelled', 'removed'].includes(c.status));
  const eligible = t.assignment_mode !== 'assigned' || t.selected_for_viewer;
  const available = t.publication_status === 'approved' && t.status === 'open' && !t.team_locked && t.claimed_count < t.capacity && !mine && t.publisher_id !== user.id && eligible;
  async function action(url: string, body?: unknown, success = '操作成功') {
    setBusy(true); setError(''); setMessage('');
    try {
      await api(url, { method: 'POST', body: body instanceof FormData ? body : JSON.stringify(body ?? {}) });
      if (url.endsWith('/publication-review')) window.dispatchEvent(new Event(pendingReviewsChanged));
      setData(await api<TaskDetail>(`tasks/${t.id}`));
      setMessage(success);
      return true;
    }
    catch (e) { setError((e as Error).message); return false; } finally { setBusy(false); }
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget, body = new FormData(form);
    if (await action(`tasks/${t.id}/submit`, formBody({ content: body.get('content') }, files), '成果已提交，等待发布者验收')) { form.reset(); setFiles([]); }
  }
  async function review(event: React.FormEvent<HTMLFormElement>, s: Submission) {
    event.preventDefault(); const values = new FormData(event.currentTarget), approve = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'approve';
    const allocation: Record<string, number> = {};
    if (approve && t.mode === 'team') {
      try { for (const c of members) { const value = String(values.get(`allocation-${c.user_id}`) ?? '').trim(); allocation[c.user_id] = /^0+(\.0{1,2})?$/.test(value) ? 0 : toUnits(value, t.reward_type); } }
      catch (e) { setError((e as Error).message); return; }
    }
    await action(`submissions/${s.id}/review`, { approve, note: values.get('note'), ...(t.mode === 'team' ? { allocations: allocation } : {}) }, approve ? '验收通过，奖励已生成' : '已退回修改，承接人可以重新提交');
  }
  async function finish(type: 'complete' | 'cancel') {
    if (!window.confirm(type === 'cancel' ? '确定取消这份悬赏？未完成的工作将停止，已获得的奖励会保留。附件将在任务结束15天后清理。' : '确定提前结束？剩余空名额将关闭，附件将在15天后清理。')) return;
    await action(`tasks/${t.id}/finish`, { action: type }, type === 'cancel' ? '任务已取消' : '任务已结束');
  }
  async function removeCompleted() {
    if (!window.confirm('确定删除这份已完成的悬赏？任务将从列表和搜索中移除，已发放的积分及结算记录会保留。')) return;
    setBusy(true);
    setError('');
    try {
      await api(`tasks/${t.id}`, { method: 'DELETE' });
      window.location.assign('/tasks');
    } catch (error) {
      setError((error as Error).message);
      setBusy(false);
    }
  }
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> 悬赏详情</div></header><Link href="/tasks" className="back-link"><ArrowLeft size={16} />返回悬赏大厅</Link>
    <div className="detail-heading"><div><div className="task-tags"><Status value={publicationDisplayStatus(t)} />{t.tags.map(tag => <span className="tag neutral" key={tag}>{tag}</span>)}<span className="tag neutral">{t.mode === 'team' ? '团队协作' : '独立完成'}</span>{t.is_demo && <span className="tag neutral">本地示例</span>}</div><h1>{t.title}</h1><p><span className="tiny-avatar">{t.publisher_name.slice(0, 1)}</span>{t.publisher_name} 发布 <span className="dot-separator">·</span>{date(t.created_at, true)}</p></div>{managing && t.status === 'open' && !t.first_claimed_at && <Link className="btn secondary" href={`/tasks/${t.id}/edit`}><Pencil size={16} />编辑悬赏</Link>}</div>
    <div aria-live="polite">{error && <p role="alert" className="notice danger">{error}</p>}{message && <p className="notice success">{message}</p>}</div>
    {t.publication_note && <p className="notice">发布审核意见：{t.publication_note}</p>}
    {user.role === 'admin' && t.status === 'open' && t.publication_status === 'pending' && <section className="paper detail-section">
      <h2>审核任务发布</h2>
      <p>请核对下方的工作内容、验收标准和积分量。通过后，任务会出现在悬赏大厅。</p>
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        const approve = ((event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement)?.value === 'approve';
        void action('tasks/' + t.id + '/publication-review', { approve, note: String(form.get('note') ?? ''), version: t.publication_version }, approve ? '悬赏已审核通过并发布' : '悬赏已退回修改');
      }}>
        <label>审核意见（退回时必填）<textarea name="note" rows={2} maxLength={2000} /></label>
        <div className="button-row"><button className="btn primary" value="approve" disabled={busy}>通过并发布</button><button className="btn secondary" value="reject" disabled={busy}>退回修改</button></div>
      </form>
    </section>}
    <div className="detail-layout"><div className="detail-main"><section className="paper detail-section"><h2>工作内容</h2><div className="prose">{t.description}</div><div className="section-divider" /><h2><FileCheck2 size={19} />验收标准</h2><div className="prose">{t.criteria}</div>{attachments.some(a => !a.submission_id) && <><div className="section-divider" /><h2>参考附件</h2><Attachments files={attachments.filter(a => !a.submission_id)} /></>}</section>
      {references.length > 0 && <section className="paper detail-section task-references"><h2>类似工作</h2>
        <p className="muted">发布者标记了这些已完成的悬赏，供承接时参考。</p>
        <ul>{references.map(reference => <li key={reference.id}><Link href={`/tasks/${reference.id}`}>{reference.title}<ArrowUpRight size={15} aria-hidden="true" /></Link></li>)}</ul>
      </section>}
      <TaskMembers data={data} user={user} busy={busy} error={error} clearError={() => setError('')} action={action} />
      {mine && ['working', 'revision'].includes(mine.status) && t.status === 'open' && <section className="paper detail-section"><h2><Send size={19} />{mine.status === 'revision' ? '修改并重新提交' : t.mode === 'team' ? '提交团队成果' : '提交我的成果'}</h2><p className="muted">说明完成了哪些工作，可以在正文附上网盘或代码仓库链接。</p><form onSubmit={submit}><label>交付说明<textarea required name="content" rows={5} maxLength={20000} placeholder="填写成果说明、参考链接，以及需要发布者确认的内容…" /></label><FilePicker files={files} onChange={setFiles} /><p className="hint">{t.mode === 'team' ? '团队共同交付，提交后成员将锁定。' : ''}成果附件仅相关参与者、发布者和管理员可见。</p><button className="btn primary" disabled={busy}><Send size={16} />{busy ? '正在提交…' : '提交成果，等待验收'}</button></form></section>}
      <section className="paper detail-section"><div className="section-title"><h2>交付与验收记录 <span>{submissions.length}</span></h2></div>{submissions.length ? <div className="submission-list">{submissions.map((s, i) => <article key={s.id} className="submission"><div className="submission-header"><div><strong>{s.submitter_name}</strong><small>{date(s.created_at, true)}{i === 0 && ' · 最新提交'}</small></div><Status value={s.status} /></div><div className="prose">{s.content}</div><Attachments files={attachments.filter(a => a.submission_id === s.id)} />{s.status === 'voided' && <p className="notice warning">这次交付已终止验收，记录和附件保留，不再用于发放奖励。</p>}{s.review_note && <div className={`review-note ${s.status === 'revision' ? 'warning' : ''}`}><strong>{s.status === 'revision' ? '修改意见' : '验收意见'}</strong><p>{s.review_note}</p></div>}
        {managing && s.status === 'pending' && t.status === 'open' && <form className="review-form" onSubmit={e => review(e, s)}>{t.mode === 'team' && <fieldset className="allocation-fieldset" key={members.map(member => member.id).sort().join(':')}><legend>分配团队奖励 <span>合计须为 {displayReward(t.reward_units, t.reward_type)}</span></legend>{members.map((c, index) => { const units = Math.floor(t.reward_units / members.length) + (index < t.reward_units % members.length ? 1 : 0); return <label className="allocation-row" key={c.id}><span>{c.name}</span><input aria-label={`${c.name}的奖励`} name={`allocation-${c.user_id}`} type="number" min={0} step={t.reward_type === 'money' ? 0.01 : 1} defaultValue={units / (t.reward_type === 'money' ? 100 : 1)} /><span>{t.reward_type === 'money' ? '元' : '积分'}</span></label>; })}</fieldset>}<label>验收意见（退回修改时必填）<textarea name="note" rows={2} maxLength={2000} placeholder="填写验收意见或具体修改要求" /></label><div className="button-row"><button className="btn primary" type="submit" value="approve" disabled={busy}><Check size={16} />通过并发放奖励</button><button className="btn secondary" type="submit" value="return" disabled={busy}>退回修改</button></div></form>}</article>)}</div> : <Empty title="尚无交付记录" description={managing ? '成员提交成果后，可以在这里验收。' : '相关成果提交后会显示在这里。'} />}</section>
      {rewards.length > 0 && <section className="paper detail-section"><h2>奖励与结算</h2><RewardTable user={user} rewards={rewards} busy={busy} onSettle={id => { if (window.confirm('确认已经在线下完成付款？此操作只登记付款，不会转账。')) void action(`rewards/${id}/settle`, {}, '已登记线下付款'); }} /></section>}
    </div><aside className="detail-side"><section className="paper bounty-summary"><span className={`tag ${t.reward_type}`}>{t.reward_type === 'money' ? '金额悬赏' : '积分悬赏'}</span><p>{t.mode === 'team' ? '团队总奖励' : '每人奖励'}</p><strong className="big-reward">{displayReward(t.reward_units, t.reward_type)}</strong>{t.mode === 'independent' && t.capacity > 1 && <p className="hint">最高奖励总额 {displayReward(t.reward_units * t.capacity, t.reward_type)}</p>}<div className="section-divider" /><div className="summary-row"><span><Users size={16} />领取名额</span><strong>{t.claimed_count} / {t.capacity}</strong></div><div className="capacity-track"><span style={{ width: `${Math.min(100, t.claimed_count / t.capacity * 100)}%` }} /></div><div className="summary-row"><span><Clock3 size={16} />截止日期</span><strong>{t.deadline ? date(t.deadline, true) : '未设置'}</strong></div>{t.deadline && new Date(t.deadline).getTime() < Date.now() && t.status === 'open' && <p className="overdue hint">已超过截止时间，仍可交付。首次交付前，每逾期满24小时扣10积分。</p>}
      {t.low_votes !== null && t.high_votes !== null && t.publication_status === 'approved' && <p className="hint">奖励反馈 · 偏低 {t.low_votes} · 偏高 {t.high_votes}</p>}
      {t.assignment_mode !== 'public' && <div className="task-recipient-summary">
        <strong>{t.assignment_mode === 'recommended' ? '推荐人选' : t.selected_for_viewer ? '指定给我' : '指定领取'}</strong>
        {recipients.length > 0 && <p>{recipients.map(member => member.name).join('、')}</p>}
        <p className="hint">{t.assignment_mode === 'recommended' ? '其他符合条件的成员也可以领取。' : '仅指定成员可以领取。'}</p>
      </div>}
      {available && <button className="btn primary full" disabled={busy} onClick={() => action(`tasks/${t.id}/claim`, {}, '领取成功，可以开始工作了')}>领取这份悬赏<ArrowUpRight size={18} /></button>}
      {mine && <div className="my-status"><span>我的承接状态</span><Status value={mine.status} /></div>}
      {mine && mine.status === 'working' && !mine.submitted_before && !t.team_locked && t.status === 'open' && <button className="text-btn" disabled={busy} onClick={() => { if (window.confirm('确定退出并释放名额？每满24小时扣5积分，另结算已产生的逾期扣分。')) void action(`tasks/${t.id}/withdraw`, {}, '已退出，名额已释放'); }}>退出任务并释放名额</button>}
      {!available && !mine && eligible && t.publisher_id !== user.id && <p className="hint">{t.status !== 'open' ? '这份悬赏已结束。' : t.publication_status !== 'approved' ? '这份悬赏尚未通过发布审核。' : t.team_locked ? '团队已提交，成员已锁定。' : '当前名额已满。'}</p>}
      <p className="hint">{t.reward_type === 'money' ? '验收通过后，由发布者在线下支付并登记结算。' : '验收通过后，积分自动计入个人记录。'}</p></section>
      {managing && t.status === 'open' && <section className="paper side-section"><h3>发布者操作</h3><p>没有进行中的工作时，可以提前结束招募。</p>{t.publication_status === 'approved' && <button className="btn secondary full" disabled={busy} onClick={() => finish('complete')}>提前结束悬赏</button>}<button className="text-btn danger-text" disabled={busy} onClick={() => finish('cancel')}>取消悬赏</button></section>}{user.role === 'admin' && t.status === 'completed' && <section className="paper side-section"><h3>管理员操作</h3><p>删除后保留积分与结算记录。</p><button type="button" className="btn secondary full danger-text" disabled={busy} onClick={() => void removeCompleted()}><Trash2 size={16} />删除已完成悬赏</button></section>}<div className="notice retention-note"><Info size={18} /><div><strong>附件保留规则</strong><p>{t.ended_at ? `任务已于 ${date(t.ended_at)} 结束，附件保留至 ${date(new Date(new Date(t.ended_at).getTime() + 15 * 86400000).toISOString(), true)}。` : '任务进行期间保留附件；任务完成或取消15天后自动清理，历史记录继续保留。'}</p></div></div></aside></div></>;
}
