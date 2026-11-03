'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="standalone"><div className="paper error-page"><span className="seal">赏</span><h1>暂时无法打开这一页</h1><p>请稍后重试。如果问题持续，请联系管理员检查服务状态。</p><button className="btn primary" onClick={reset}>重新加载</button></div></main>;
}
