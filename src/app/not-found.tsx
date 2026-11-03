import Link from 'next/link';
export default function NotFound() { return <main className="standalone"><div className="paper error-page"><h1>没有找到这份悬赏</h1><p>链接可能有误，请返回大厅查看。</p><Link href="/tasks" className="btn primary">返回悬赏大厅</Link></div></main>; }
