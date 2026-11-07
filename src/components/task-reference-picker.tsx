'use client';
import { useState } from 'react';
import { Search } from 'lucide-react';
import { api } from '@/lib/client';
import type { TaskReference } from '@/lib/types';

export function TaskReferencePicker({ selected, onChange }: { selected: TaskReference[]; onChange: (value: TaskReference[]) => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<TaskReference[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function search() {
    if (busy) return;
    setBusy(true);
    setError('');
    setResults(null);
    try {
      const result = await api<{ references: TaskReference[] }>(`tasks/reference-search?q=${encodeURIComponent(query.trim())}`);
      setResults(result.references);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return <section className="paper form-section">
    <h2><span>02</span>类似工作 <small>可选</small></h2>
    <p className="hint">关联最多 5 份已完成的悬赏，供承接人查看参考。</p>
    <div className="tag-controls">
      <label>搜索已完成的工作<input type="search" value={query} maxLength={100} placeholder="输入标题、工作内容或标签"
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void search(); } }} /></label>
      <button type="button" className="btn secondary" disabled={busy} onClick={() => void search()}><Search size={16} />{busy ? '搜索中…' : '搜索'}</button>
    </div>
    {error && <p className="hint danger-text" role="alert">{error}</p>}
    {results && (results.length ? <div className="recipient-results reference-results" role="group" aria-label="已完成的工作">
      {results.map(result => {
        const added = selected.some(reference => reference.id === result.id);
        return <button type="button" className="recipient-option" key={result.id} aria-pressed={added}
          disabled={!added && selected.length >= 5}
          onClick={() => onChange(added ? selected.filter(reference => reference.id !== result.id) : [...selected, result])}>
          <span>{result.title}</span><span aria-hidden="true">{added ? '已关联' : '关联'}</span>
        </button>;
      })}
    </div> : <p className="hint" role="status">没有找到匹配的已完成悬赏。</p>)}
    {selected.length > 0 && <div className="task-tags reference-results">{selected.map(reference =>
      <button type="button" key={reference.id} className="tag neutral" aria-label={`移除参考 ${reference.title}`}
        onClick={() => onChange(selected.filter(item => item.id !== reference.id))}>{reference.title} ×</button>)}</div>}
  </section>;
}
