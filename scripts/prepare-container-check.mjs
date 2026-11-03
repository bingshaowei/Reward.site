import { mkdir, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await mkdir('.data', { recursive: true });
await writeFile('.data/container-check.env', `POSTGRES_PASSWORD=${randomBytes(24).toString('hex')}\nADMIN_USERNAME=admin\nADMIN_PASSWORD=${randomBytes(12).toString('hex')}\nAPP_ORIGIN=http://localhost:18080\nSITE_ADDRESS=:80\nCOOKIE_SECURE=false\n`, { mode: 0o600, flag: 'wx' });
console.log('已生成仅本机容器验收用的随机配置。');
