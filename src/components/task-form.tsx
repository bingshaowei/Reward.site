'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Coins, CircleDollarSign, UserRound, Users, Info } from 'lucide-react';
import type { AssignmentMode, RecipientOption, Task, TaskRecipient, TaskReference } from '@/lib/types';
import { api, formBody } from '@/lib/client';
import { parseTaskDeadline, type DeadlineFields } from '@/lib/rules';
import { FilePicker } from './ui';
import { TaskReferencePicker } from './task-reference-picker';
const assignmentLabels: Record<AssignmentMode, string> = { public: '公开领取', recommended: '推荐人选', assigned: '指定对象' };
const deadlineMinutes = Array.from({ length: 60 }, (_, minute) => String(minute).padStart(2, '0'));
const deadlineHours = deadlineMinutes.slice(0, 24);

export function TaskForm({ initial, canPublishMoney, availableTags, walletBalance, platformFunded, recipientOptions, initialRecipients = [], initialReferences = [] }: {
  initial?: Task; canPublishMoney: boolean; availableTags: string[]; walletBalance: number; platformFunded: boolean;
  recipientOptions: RecipientOption[]; initialRecipients?: TaskRecipient[];
  initialReferences?: TaskReference[];
}) {
  const [mode, setMode] = useState(initial?.mode ?? 'independent'), [rewardType, setRewardType] = useState(canPublishMoney ? initial?.reward_type ?? 'money' : 'points'), [reward, setReward] = useState(initial && (canPublishMoney || initial.reward_type === 'points') ? String(initial.reward_units / (initial.reward_type === 'money' ? 100 : 1)) : ''), [capacity, setCapacity] = useState(initial?.mode === 'team' ? Math.max(2, initial.capacity) : 1), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [tags, setTags] = useState(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
  const [deadlineError, setDeadlineError] = useState('');
  const [references, setReferences] = useState(initialReferences);
  const [initialDate, initialTime = ''] = initial?.deadline
    ? new Date(initial.deadline).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16).split(' ')
    : [''];
  const [year = '', month = '', day = ''] = initialDate.split('-');
  const [initialHour = '', initialMinute = ''] = initialTime.split(':');
  const initialDeadline: DeadlineFields = { year, month, day, time: initialTime };
  const [assignmentMode, setAssignmentMode] = useState<AssignmentMode>(initial?.assignment_mode ?? 'public');
  const [recipients, setRecipients] = useState(initialRecipients);
  const [recipientSearch, setRecipientSearch] = useState('');
  const search = recipientSearch.trim().toLowerCase();
  const matchingRecipients = recipientOptions.filter(member => member.name.toLowerCase().includes(search) || member.username.toLowerCase().includes(search));
  const availableRecipientIds = new Set(recipientOptions.map(member => member.id));
  const selectedRecipientIds = new Set(recipients.map(member => member.id));
  function toggleRecipient(member: TaskRecipient) {
    setRecipients(current => current.some(selected => selected.id === member.id)
      ? current.filter(selected => selected.id !== member.id)
      : [...current, member]);
    setError('');
  }
  function toggleTag(tag: string) {
    if (tags.includes(tag)) {
      setTags(current => current.filter(name => name !== tag));
      setError('');
    } else {
      addTag(tag);
    }
  }
  function addTag(value: string) {
    const tag = value.normalize('NFKC').trim().toLowerCase();
    if (!tag || tags.includes(tag)) return;
    if (tag.length > 24 || /[\p{C}]/u.test(tag) || tags.length >= 8) {
      setError('最多添加8个标签，每个标签1至24个可见字符');
      return;
    }
    setTags([...tags, tag]);
    setTagInput('');
    setError('');
  }
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setDeadlineError('');
    const form = new FormData(event.currentTarget);
    const hour = String(form.get('deadline-hour') ?? '');
    const minute = String(form.get('deadline-minute') ?? '');
    if (Boolean(hour) !== Boolean(minute)) {
      setDeadlineError('请选择小时和分钟，或将两项都留空。');
      event.currentTarget.querySelector<HTMLSelectElement>(hour ? '[name="deadline-minute"]' : '[name="deadline-hour"]')?.focus();
      return;
    }
    const deadlineFields: DeadlineFields = {
      year: String(form.get('deadline-year') ?? '').trim(),
      month: String(form.get('deadline-month') ?? '').trim(),
      day: String(form.get('deadline-day') ?? '').trim(),
      time: hour ? `${hour}:${minute}` : '',
    };
    let deadline: string | null;
    try {
      deadline = JSON.stringify(deadlineFields) === JSON.stringify(initialDeadline) ? initial?.deadline ?? null : parseTaskDeadline(deadlineFields);
    } catch (error) {
      setDeadlineError((error as Error).message);
      event.currentTarget.querySelector<HTMLInputElement>('input[name="deadline-year"]')?.focus();
      return;
    }
    if (assignmentMode !== 'public' && (!recipients.length || recipients.some(member => !availableRecipientIds.has(member.id)))) {
      setError('请选择启用中的成员，并移除已停用的成员');
      return;
    }
    if (assignmentMode === 'assigned' && capacity > recipients.length) {
      setError('领取名额不能超过指定人数');
      return;
    }
    setBusy(true);
    const assignment = { mode: assignmentMode, memberIds: assignmentMode === 'public' ? [] : recipients.map(member => member.id) };
    const data = { title: form.get('title'), description: form.get('description'), criteria: form.get('criteria'), mode, reward_type: rewardType, reward, capacity, tags, assignment, deadline, referenceIds: references.map(reference => reference.id) };
    try {
      if (initial) { await api(`tasks/${initial.id}`, { method: 'PATCH', body: JSON.stringify(data) }); window.location.assign(`/tasks/${initial.id}`); }
      else { const result = await api<{ task: Task }>('tasks', { method: 'POST', body: formBody(data, files) }); window.location.assign(`/tasks/${result.task.id}`); }
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const total = Number(reward || 0) * (mode === 'independent' ? capacity : 1);
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> {initial ? '编辑悬赏' : '发布悬赏'}</div></header><Link href={initial ? `/tasks/${initial.id}` : '/tasks'} className="back-link"><ArrowLeft size={16} />{initial ? '返回任务详情' : '返回悬赏大厅'}</Link><div className="page-heading"><h1>{initial ? '编辑这份悬赏' : '发布一份新悬赏'}</h1><p>描述要做的事、交付要求和奖励，让合适的人找到你。</p></div><form className="form-layout" onSubmit={submit}><div className="form-main"><section className="paper form-section"><h2><span>01</span>把工作说明白</h2><p className="hint">标有 <span className="required-mark">*</span> 的项目为必填项。</p><label><span>悬赏标题 <span className="required-mark">*</span></span><input name="title" required minLength={2} maxLength={100} defaultValue={initial?.title} placeholder="例如：整理产品使用手册与常见问题" /></label><label><span>工作内容 <span className="required-mark">*</span></span><textarea name="description" rows={6} required minLength={2} maxLength={20000} defaultValue={initial?.description} placeholder="需要完成什么？有哪些背景、范围或参考资料？" /></label><label><span>验收标准 <span className="required-mark">*</span></span><textarea name="criteria" rows={4} required minLength={2} maxLength={10000} defaultValue={initial?.criteria} placeholder="列出成果应包含的内容，以及验收通过的条件。" /></label></section>
      <TaskReferencePicker selected={references} onChange={setReferences} />
      <section className="paper form-section">
        <h2><span>03</span>选择协作方式</h2>
        <div className="choice-grid">{[{ value: 'independent' as const, title: '独立完成', description: '单人领取，独立交付并获得奖励', Icon: UserRound }, { value: 'team' as const, title: '团队协作', description: '共同交付成果，验收时分配总奖励', Icon: Users }].map(({ value, title, description, Icon }) => <button key={value} type="button" className={`choice ${mode === value ? 'selected' : ''}`} onClick={() => { setMode(value); setCapacity(value === 'team' ? Math.max(2, capacity) : 1); }} aria-pressed={mode === value}><Icon size={23} /><strong>{title}</strong><span>{description}</span></button>)}</div>
        <div className="form-row">
          {mode === 'team' && <label><span>最多参与人数 <span className="required-mark">*</span></span><input aria-label="最多参与人数" type="number" min={2} max={100} value={capacity || ''} onChange={e => setCapacity(Number(e.target.value))} required /><small className="hint">团队至少设置 2 个名额。</small></label>}
          <div className="deadline-field" role="group" aria-labelledby="deadline-title" aria-describedby={deadlineError ? 'deadline-hint deadline-error' : 'deadline-hint'}>
            <strong id="deadline-title">截止时间（可选，北京时间）</strong>
            <div className="deadline-parts">
              {([['year', '年', '2026', 4], ['month', '月', '12', 2], ['day', '日', '1', 2]] as const).map(([key, unit, placeholder, length]) => (
                <label key={key}><input aria-label={unit} name={`deadline-${key}`} type="text" inputMode="numeric" maxLength={length}
                  placeholder={placeholder} defaultValue={initialDeadline[key]} aria-invalid={!!deadlineError} onChange={() => setDeadlineError('')} />{unit}</label>
              ))}
              <div className="deadline-time" role="group" aria-label="时间（可选）">
                <select aria-label="小时" name="deadline-hour" defaultValue={initialHour} aria-invalid={!!deadlineError} onChange={() => setDeadlineError('')}>
                  <option value="">时</option>
                  {deadlineHours.map(hour => <option key={hour} value={hour}>{hour} 时</option>)}
                </select>
                <select aria-label="分钟" name="deadline-minute" defaultValue={initialMinute} aria-invalid={!!deadlineError} onChange={() => setDeadlineError('')}>
                  <option value="">分</option>
                  {deadlineMinutes.map(minute => <option key={minute} value={minute}>{minute} 分</option>)}
                </select>
              </div>
            </div>
            <p className="hint" id="deadline-hint">只填年月时，以该月开始为截止（如 2026 年 12 月对应 11 月 30 日 24:00）。填到日但不填时间时，以当天结束为截止。全留空则不限时。</p>
            {deadlineError && <p className="hint danger-text" id="deadline-error" role="alert">{deadlineError}</p>}
          </div>
        </div>
        <p className="hint">截止后每逾期满24小时扣承接人10积分，首次交付后停止累计。</p>
      </section>
      <section className="paper form-section" aria-labelledby="assignment-title">
        <h2 id="assignment-title"><span>04</span>谁可以领取</h2>
        <div className="segmented assignment-modes" role="group" aria-label="领取方式">
          {(['public', 'recommended', 'assigned'] as const).map(value => (
            <button key={value} type="button" className={assignmentMode === value ? 'selected' : ''} aria-pressed={assignmentMode === value}
              onClick={() => { setAssignmentMode(value); setError(''); }}>{assignmentLabels[value]}</button>
          ))}
        </div>
        <p className="hint">{assignmentMode === 'assigned' ? '仅所选成员可以领取，按设置的名额先到先得。' : assignmentMode === 'recommended' ? '在任务详情展示推荐名单，其他成员也可以领取。' : '所有符合条件的成员都可以领取。'}</p>
        {assignmentMode !== 'public' && <div className="recipient-picker"><p className="hint">领取成员 <span className="required-mark">*</span>（至少选择一人）</p>
          <label>搜索成员<input type="search" placeholder="输入姓名或账号" value={recipientSearch}
            onChange={event => setRecipientSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') event.preventDefault(); }} /></label>
          <div className="recipient-results" role="group" aria-label="候选成员">
            {matchingRecipients.map(member => (
              <button key={member.id} type="button" className="recipient-option" aria-pressed={selectedRecipientIds.has(member.id)}
                disabled={recipients.length >= 100 && !selectedRecipientIds.has(member.id)} onClick={() => toggleRecipient(member)}>
                <span>{member.name} <small>@{member.username}</small></span>
                <span aria-hidden="true">{selectedRecipientIds.has(member.id) ? '已选' : '选择'}</span>
              </button>
            ))}
            {matchingRecipients.length === 0 && <p className="hint">没有找到可选成员。</p>}
          </div>
          <p className="hint">已选 {recipients.length} 人</p>
          <div className="task-tags">{recipients.map(member => (
            <button type="button" key={member.id} className="tag neutral" aria-label={`移除成员 ${member.name}`}
              onClick={() => toggleRecipient(member)}>{member.name}{!availableRecipientIds.has(member.id) && '（已停用）'} ×</button>
          ))}</div>
        </div>}
      </section>
      <section className="paper form-section">
        <h2><span>05</span>设置悬赏奖励</h2>
        <div className="segmented">
          {canPublishMoney && <button type="button" className={rewardType === 'money' ? 'selected' : ''} onClick={() => { setRewardType('money'); setReward(''); }}><CircleDollarSign size={18} />金额奖励</button>}
          <button type="button" className={rewardType === 'points' ? 'selected' : ''} onClick={() => { setRewardType('points'); setReward(''); }}><Coins size={18} />积分奖励</button>
        </div>
        <label><span>{mode === 'team' ? '团队总奖励' : '悬赏奖励'} <span className="required-mark">*</span></span><div className="amount-input"><span>{rewardType === 'money' ? '¥' : '积分'}</span><input type="number" min={rewardType === 'money' ? 0.01 : 1} max={rewardType === 'money' ? 1000000 : 100000000} step={rewardType === 'money' ? 0.01 : 1} value={reward} required onChange={e => setReward(e.target.value)} placeholder="0" /></div></label>
        {!canPublishMoney && <p className="hint">任务内容和积分量须经管理员审核，通过后才可领取。</p>}
        {rewardType === 'points' && <p className="hint">{platformFunded ? '由平台出资，验收后发放给承接人。' : `发布者钱包可用 ${walletBalance.toLocaleString('zh-CN')} 积分。`}
          {Number(initial?.points_reserved) > 0 && ` 本任务已预留 ${Number(initial?.points_reserved).toLocaleString('zh-CN')} 积分。`}
        </p>}
        <div className="budget-summary"><span>{mode === 'team' ? '团队总奖励' : '最高奖励总额'}</span><strong>{rewardType === 'money' ? `¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : `${total.toLocaleString('zh-CN')} 积分`}</strong></div>
        {rewardType === 'money' ? <p className="hint">网站记录金额及结算状态，款项由发布者在线下支付。</p> : !platformFunded && <p className="hint">提交时从钱包预留奖励。验收后发放给承接人，任务结束时退回未发出的积分。</p>}
      </section>
      <section className="paper form-section">
        <h2><span>06</span>任务标签</h2>
        <div className="tag-picker" role="group" aria-label="选择任务标签">
          {[...new Set([...availableTags, ...tags])].map(tag => (
            <button type="button" className="tag-choice" aria-pressed={tags.includes(tag)} key={tag} onClick={() => toggleTag(tag)}>{tag}</button>
          ))}
          {!availableTags.length && !tags.length && <p className="hint">还没有可选标签，可以添加自定义标签。</p>}
        </div>
        <div className="tag-controls">
          <label>自定义标签<input value={tagInput} maxLength={24} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagInput); } }} /></label>
          <button type="button" className="btn secondary" onClick={() => addTag(tagInput)}>添加标签</button>
        </div>
        <p className="hint">每个任务最多8个标签。保存后，自定义标签可在其他任务中重复使用。</p>
      </section>
      {!initial && <section className="paper form-section"><h2><span>07</span>添加参考附件 <small>可选</small></h2><FilePicker files={files} onChange={setFiles} reference /><p className="hint">任务说明附件对所有登录成员可见。任务结束后保留15天，到期自动清理。</p></section>}
    </div><aside className="form-side"><div className="paper publish-summary"><span className="eyebrow">发布前确认</span><h2>一份清楚的悬赏，<br />是好协作的开始。</h2><ul><li>必须明确工作范围与验收标准</li><li>必须匹配奖励设置与预期工作量</li></ul><div className="notice"><Info size={18} /><span>首次被领取后，工作要求、奖励、协作方式和领取对象会锁定。</span></div>{error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary full" disabled={busy}>{busy ? '正在保存…' : initial ? '保存修改' : canPublishMoney ? '确认发布悬赏' : '提交管理员审核'}<ArrowUpRight size={18} /></button></div></aside></form></>;
}
