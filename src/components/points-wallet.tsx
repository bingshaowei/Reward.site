import { date } from '@/lib/client';
import { WalletChest } from './wallet-pig';
import type { getWallet } from '@/lib/wallet';

const labels: Record<string, string> = {
  monthly: '每月发放', interest: '余额利息', legacy: '历史奖励转入', reward: '验收奖励',
  reserve: '预留任务奖励', refund: '退回预留积分', overdue: '任务逾期扣分', withdrawal: '主动退出扣分',
};

export function PointsWallet({ wallet }: { wallet: Awaited<ReturnType<typeof getWallet>> }) {
  return <section className="paper points-wallet" aria-labelledby="wallet-title">
    <div className="wallet-summary">
      <div>
        <h2 id="wallet-title">我的积分钱包</h2>
        <p className="wallet-balance"><strong>{wallet.balance.toLocaleString('zh-CN')}</strong> 可用积分</p>
        <p>已预留 {wallet.reserved.toLocaleString('zh-CN')} 积分</p>
        <p className="hint">每月发放 100 积分。月息 1%，按月初可用正余额计算，向下取整。</p>
        {wallet.balance < 0 && <p className="hint overdue">后续积分到账会先抵扣欠额。</p>}
      </div>
      <WalletChest balance={wallet.balance} />
    </div>
    <details className="wallet-history">
      <summary>查看积分明细</summary>
      {wallet.entries.length ? <ul>{wallet.entries.map(entry => <li key={entry.id}>
        <span>{labels[entry.kind] ?? entry.kind}{entry.title && <small>{entry.title}</small>}<small>{date(entry.effective_at, true)}</small></span>
        <strong className={entry.amount < 0 ? 'overdue' : 'success'}>{entry.amount > 0 ? '+' : ''}{entry.amount.toLocaleString('zh-CN')}</strong>
      </li>)}</ul> : <p className="hint">暂无积分记录。</p>}
    </details>
  </section>;
}
