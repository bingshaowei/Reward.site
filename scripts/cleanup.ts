import { getPool } from '../src/lib/db';
import { cleanupExpired } from '../src/lib/files';
import { settleWallets } from '../src/lib/wallet';
const pool = getPool(); let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });
try {
  do {
    try { const result = await cleanupExpired(pool); console.log(new Date().toISOString(), '附件清理', result); }
    catch (error) { console.error('附件清理失败，将在下一轮重试', error instanceof Error ? error.message : 'unknown'); }
    try { await settleWallets(pool); }
    catch (error) { console.error('积分钱包结算失败，将在下一轮重试', error instanceof Error ? error.message : 'unknown'); }
    if (process.argv.includes('--once')) break;
    // 分段等待，以便容器能够及时响应停止信号。
    for (let second = 0; second < 3600 && !stopping; second++) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping);
} finally { await pool.end(); }
