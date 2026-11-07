import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { rows, type Db } from './db';
import { ensure } from './rules';
import type { User } from './types';

export async function updateAvatar(db: Db, user: User, value: unknown) {
  const { image } = z.object({ image: z.string().max(700000) }).parse(value);
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
  ensure(match, '请上传 JPG、PNG 或 WebP 图片');
  const type = match[1], data = Buffer.from(match[2], 'base64');
  ensure(data.length > 0 && data.length <= 512 * 1024, '头像处理后不能超过512KB');
  const valid = type === 'image/png' ? data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
    : type === 'image/jpeg' ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP';
  ensure(valid, '图片格式无效，请重新选择');
  const version = randomUUID();
  const result = await db.query('UPDATE users SET avatar_data=$2,avatar_type=$3,avatar_version=$4 WHERE id=$1 AND active AND removed_at IS NULL', [user.id, data, type, version]);
  ensure(result.rowCount, '账号已失效，请重新登录', 401);
  return version;
}

export async function readAvatar(db: Db, userId: string) {
  const [avatar] = await rows<{ data: Buffer; type: string }>(db, 'SELECT avatar_data AS data,avatar_type AS type FROM users WHERE id=$1 AND active AND avatar_data IS NOT NULL', [userId]);
  return avatar ?? null;
}
