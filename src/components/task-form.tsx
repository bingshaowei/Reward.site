'use client';
import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, ArrowUpRight, Coins, CircleDollarSign, UserRound, Users, Info } from 'lucide-react';
import type { Task } from '@/lib/types';
import { api, formBody } from '@/lib/client';
import { FilePicker } from './ui';
export function TaskForm({ initial, canPublishMoney, availableTags, walletBalance }: { initial?: Task; canPublishMoney: boolean; availableTags: string[]; walletBalance: number }) {
  const [mode, setMode] = useState(initial?.mode ?? 'independent'), [rewardType, setRewardType] = useState(canPublishMoney ? initial?.reward_type ?? 'money' : 'points'), [reward, setReward] = useState(initial && (canPublishMoney || initial.reward_type === 'points') ? String(initial.reward_units / (initial.reward_type === 'money' ? 100 : 1)) : ''), [capacity, setCapacity] = useState(initial?.capacity ?? 1), [files, setFiles] = useState<File[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [tags, setTags] = useState(initial?.tags ?? []);
  const [tagInput, setTagInput] = useState('');
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
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget), deadline = String(form.get('deadline') ?? '');
    const data = { title: form.get('title'), description: form.get('description'), criteria: form.get('criteria'), mode, reward_type: rewardType, reward, capacity, tags, deadline: deadline ? new Date(`${deadline}:00+08:00`).toISOString() : null };
    try {
      if (initial) { await api(`tasks/${initial.id}`, { method: 'PATCH', body: JSON.stringify(data) }); window.location.assign(`/tasks/${initial.id}`); }
      else { const result = await api<{ task: Task }>('tasks', { method: 'POST', body: formBody(data, files) }); window.location.assign(`/tasks/${result.task.id}`); }
    } catch (e) { setError((e as Error).message); setBusy(false); }
  }
  const total = Number(reward || 0) * (mode === 'independent' ? capacity : 1);
  return <><header className="page-top"><div className="breadcrumb">工作空间 <span>/</span> {initial ? '编辑悬赏' : '发布悬赏'}</div></header><Link href={initial ? `/tasks/${initial.id}` : '/tasks'} className="back-link"><ArrowLeft size={16} />{initial ? '返回任务详情' : '返回悬赏大厅'}</Link><div className="page-heading"><h1>{initial ? '编辑这份悬赏' : '发布一份新悬赏'}</h1><p>描述要做的事、交付要求和奖励，让合适的人找到你。</p></div><form className="form-layout" onSubmit={submit}><div className="form-main"><section className="paper form-section"><h2><span>01</span>把工作说明白</h2><label>悬赏标题<input name="title" required minLength={2} maxLength={100} defaultValue={initial?.title} placeholder="例如：整理产品使用手册与常见问题" /></label><label>工作内容<textarea name="description" rows={6} required minLength={2} maxLength={20000} defaultValue={initial?.description} placeholder="需要完成什么？有哪些背景、范围或参考资料？" /></label><label>验收标准<textarea name="criteria" rows={4} required minLength={2} maxLength={10000} defaultValue={initial?.criteria} placeholder="列出成果应包含的内容，以及验收通过的条件。" /></label></section>
      <section className="paper form-section"><h2><span>02</span>选择协作方式</h2><div className="choice-grid">{[{ value: 'independent' as const, title: '独立完成', description: '每人独立交付，各自验收和获奖', Icon: UserRound }, { value: 'team' as const, title: '团队协作', description: '共同交付成果，验收时分配总奖励', Icon: Users }].map(({ value, title, description, Icon }) => <button key={value} type="button" className={`choice ${mode === value ? 'selected' : ''}`} onClick={() => setMode(value)} aria-pressed={mode === value}><Icon size={23} /><strong>{title}</strong><span>{description}</span></button>)}</div><div className="form-row"><label>{mode === 'team' ? '最多参与人数' : '领取名额'}<input type="number" min={1} max={100} value={capacity} onChange={e => setCapacity(Number(e.target.value))} required /></label><label>截止日期（可选，北京时间）<input name="deadline" type="datetime-local" defaultValue={initial?.deadline ? new Date(initial.deadline).toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 16).replace(' ', 'T') : ''} /></label></div><p className="hint">{mode === 'team' ? '团队第一次提交成果后，成员将锁定。未满员也可提交。' : '名额为1时是单人任务；多人时，每人独立获得设置的奖励。'} 截止后每逾期满24小时扣承接人10积分，首次交付后停止累计。</p></section>
      <section className="paper form-section"><h2><span>03</span>设置悬赏奖励</h2><div className="segmented">{canPublishMoney && <button type="button" className={rewardType === 'money' ? 'selected' : ''} onClick={() => { setRewardType('money'); setReward(''); }}><CircleDollarSign size={18} />金额奖励</button>}<button type="button" className={rewardType === 'points' ? 'selected' : ''} onClick={() => { setRewardType('points'); setReward(''); }}><Coins size={18} />积分奖励</button></div><label>{mode === 'team' ? '团队总奖励' : '每人奖励'}<div className="amount-input"><span>{rewardType === 'money' ? '¥' : '积分'}</span><input type="number" min={rewardType === 'money' ? 0.01 : 1} max={rewardType === 'money' ? 1000000 : 100000000} step={rewardType === 'money' ? 0.01 : 1} value={reward} required onChange={e => setReward(e.target.value)} placeholder="0" /></div></label>{!canPublishMoney && <p className="hint">任务内容和积分量须经管理员审核，通过后才可领取。</p>}{rewardType === "points" && <p className="hint">发布者钱包可用 {walletBalance.toLocaleString("zh-CN")} 积分{Number(initial?.points_reserved) > 0 && `，本任务已预留 ${Number(initial?.points_reserved).toLocaleString("zh-CN")} 积分`}。</p>}<div className="budget-summary"><span>{mode === 'team' ? '团队总奖励' : '最高奖励总额'}</span><strong>{rewardType === 'money' ? `¥${total.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : `${total.toLocaleString('zh-CN')} 积分`}</strong></div><p className="hint">{rewardType === 'money' ? '网站记录金额及结算状态，款项由发布者在线下支付。' : '提交时从钱包预留奖励。验收后发放给承接人，任务结束时退回未发出的积分。'}</p></section>
      <section className="paper form-section">
        <h2>任务标签</h2>
        <div className="tag-controls">
          <label>选择已有标签<select value="" onChange={event => addTag(event.target.value)}><option value="">请选择</option>{availableTags.filter(tag => !tags.includes(tag)).map(tag => <option key={tag}>{tag}</option>)}</select></label>
          <label>自定义标签<input value={tagInput} maxLength={24} onChange={event => setTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addTag(tagInput); } }} /></label>
          <button type="button" className="btn secondary" onClick={() => addTag(tagInput)}>添加标签</button>
        </div>
        <div className="task-tags">{tags.map(tag => <button className="tag neutral" type="button" aria-label={'移除标签 ' + tag} key={tag} onClick={() => setTags(tags.filter(name => name !== tag))}>{tag} ×</button>)}</div>
        <p className="hint">每个任务最多8个标签。保存后，自定义标签可在其他任务中重复使用。</p>
      </section>
      {!initial && <section className="paper form-section"><h2><span>04</span>添加参考附件 <small>可选</small></h2><FilePicker files={files} onChange={setFiles} reference /><p className="hint">任务说明附件对所有登录成员可见。任务结束后保留15天，到期自动清理。</p></section>}
    </div><aside className="form-side"><div className="paper publish-summary"><span className="eyebrow">发布前确认</span><h2>一份清楚的悬赏，<br />是好协作的开始。</h2><ul><li>工作范围与验收标准明确</li><li>{mode === 'team' ? '团队共同完成，验收时分配奖励' : `最多 ${capacity || 0} 人，各自独立交付`}</li><li>奖励设置与预期工作量相符</li></ul><div className="notice"><Info size={18} /><span>首次被领取后，工作要求、奖励和协作方式会锁定。</span></div>{error && <p role="alert" className="notice danger">{error}</p>}<button className="btn primary full" disabled={busy}>{busy ? '正在保存…' : initial ? '保存修改' : canPublishMoney ? '确认发布悬赏' : '提交管理员审核'}<ArrowUpRight size={18} /></button></div></aside></form></>;
}
