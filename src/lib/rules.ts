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
export type DeadlineFields = { year: string; month: string; day: string; time: string };
export function parseTaskDeadline(fields: DeadlineFields): string | null {
  const [year, month, day, time] = [fields.year, fields.month, fields.day, fields.time]
    .map(value => value.normalize('NFKC').trim());
  if (!year && !month && !day && !time) return null;
  ensure(/^\d{4}$/.test(year) && year !== '0000' && /^\d{1,2}$/.test(month) && Number(month) >= 1 && Number(month) <= 12, '请输入四位年份和有效月份');
  ensure(!time || day, '填写时间时也需要填写日期');
  ensure(!day || /^\d{1,2}$/.test(day), '请输入有效的日期');
  const date = `${year}-${month.padStart(2, '0')}-${(day || '1').padStart(2, '0')}`;
  const midnight = new Date(`${date}T00:00:00Z`);
  ensure(Number.isFinite(+midnight) && midnight.toISOString().slice(0, 10) === date, '请输入有效的日期');
  ensure(!time || /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time), '请输入有效的时间');
  const clock = time ? `${time}:00` : day ? '23:59:59.999' : '00:00:00';
  return new Date(`${date}T${clock}+08:00`).toISOString();
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
