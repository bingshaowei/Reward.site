import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: { default: '内部悬赏令', template: '%s · 内部悬赏令' }, description: '发布工作，汇聚团队力量，让每一份付出都有回报。', robots: { index: false, follow: false } };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
