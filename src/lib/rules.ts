export class AppError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function ensure(condition: unknown, message: string, status = 400): asserts condition {
  if (!condition) throw new AppError(message, status);
}
export function toUnits(value: string, type: 'money' | 'points'): number {
  ensure(typeof value === 'string' && (type === 'money' ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(value), '请输入有效奖励，金额最多两位小数，积分必须为整数');
  const [whole, fraction = ''] = value.split('.');
  const amount = type === 'money' ? Number(whole) * 100 + Number(fraction.padEnd(2, '0')) : Number(whole);
  ensure(Number.isSafeInteger(amount) && amount > 0 && amount <= 100_000_000, '奖励必须大于零且不能超过系统上限');
  return amount;
}
export function validateAllocation(value: Record<string, number>, members: string[], total: number) {
  ensure(value && typeof value === 'object' && !Array.isArray(value), '请填写奖励分配');
  ensure(Object.keys(value).length === members.length && members.every(id => Object.hasOwn(value, id)), '请为每位团队成员分配奖励');
  const values = Object.values(value);
  ensure(values.every(n => Number.isSafeInteger(n) && n >= 0) && values.reduce((a, b) => a + b, 0) === total, '分配总和必须等于总奖励，且不能为负数或包含多余小数');
  return value;
}
export function expiryAt(endedAt: Date | string | null): Date | null {
  return endedAt ? new Date(new Date(endedAt).getTime() + 15 * 86400000) : null;
}
export function parseTaskDeadline(value: string): string | null {
  const text = value.normalize('NFKC').trim();
  if (!text) return null;
  const normalized = text.replace(/年|月/g, '-').replace('日', ' ').trim();
  const match = /^(\d{4})([-/])(\d{1,2})\2(\d{1,2})(?:[ T]+(\d{1,2}):([0-5]\d))?$/.exec(normalized);
  ensure(match, '请输入有效日期和时间，例如 2026-11-05 18:00');
  const [, year, , month, day, hour, minute] = match;
  const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const midnight = new Date(`${date}T00:00:00Z`);
  ensure(year !== '0000' && Number.isFinite(+midnight) && midnight.toISOString().slice(0, 10) === date, '请输入有效的日期');
  ensure(hour === undefined || Number(hour) < 24, '小时须为 0 至 23');
  const time = hour === undefined ? '23:59:59.999' : `${hour.padStart(2, '0')}:${minute}:00`;
  return new Date(`${date}T${time}+08:00`).toISOString();
}
export function assertOrigin(origin: string | null, expected: string) {
  ensure(origin && new URL(origin).origin === new URL(expected).origin, '请求来源无效，请从本站重新操作', 403);
}
export function canReadAttachment(user: { id: string; role: string }, a: { owner_id: string; submission_id: string | null; participant_ids: string[]; publisher_id: string }) {
  return !a.submission_id || user.role === 'admin' || user.id === a.owner_id || user.id === a.publisher_id || a.participant_ids.includes(user.id);
}
export function displayReward(units: number, type: string) {
  return type === 'money' ? `¥${(units / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `${units.toLocaleString('zh-CN')} 积分`;
}
