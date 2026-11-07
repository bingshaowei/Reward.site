import { describe, expect, it } from 'vitest';
import { toUnits, validateAllocation, expiryAt, assertOrigin, canReadAttachment, parseTaskDeadline } from '../src/lib/rules';

describe('手填悬赏截止时间', () => {
  const fields = (year = '', month = '', day = '', time = '') => ({ year, month, day, time });
  it('留空时不限时，日期和时刻按北京时间解释', () => {
    expect(parseTaskDeadline(fields())).toBeNull();
    expect(parseTaskDeadline(fields('2026', '11', '5', '08:30'))).toBe('2026-11-05T00:30:00.000Z');
    expect(parseTaskDeadline(fields('２０２６', '１１', '５', '１８：００'))).toBe('2026-11-05T10:00:00.000Z');
    expect(parseTaskDeadline(fields('2028', '2', '29'))).toBe('2028-02-29T15:59:59.999Z');
    expect(parseTaskDeadline(fields('2026', '12'))).toBe('2026-11-30T16:00:00.000Z');
    expect(parseTaskDeadline(fields('2027', '1'))).toBe('2026-12-31T16:00:00.000Z');
  });

  it('拒绝无效日期或时刻，避免自动滚动到其他日期', () => {
    for (const value of [fields('2026', '2', '29'), fields('2026', '4', '31'), fields('2026', '11', '5', '24:00'), fields('2026', '11', '5', '09:60'), fields('2026', '11', '', '18:00'), fields('2026')]) {
      expect(() => parseTaskDeadline(value)).toThrow();
    }
  });
});

describe('奖励与访问规则', () => {
  it('金额精确转换为分，不接受超过两位小数、负数和指数写法', () => {
    expect(toUnits('19.99', 'money')).toBe(1999);
    expect(toUnits('0.01', 'money')).toBe(1);
    for (const v of ['1.001', '-1', '1e3', 'NaN', '0']) expect(() => toUnits(v, 'money')).toThrow();
    expect(() => toUnits('1.5', 'points')).toThrow();
    expect(toUnits('28', 'points')).toBe(28);
  });
  it('团队分配恰好覆盖全部成员且总和等于总奖励', () => {
    expect(validateAllocation({ a: 600, b: 400 }, ['a', 'b'], 1000)).toEqual({ a: 600, b: 400 });
    const invalid: Record<string, number>[] = [{ a: 1000 }, { a: 600, b: 401 }, { a: -1, b: 1001 }, { a: 1.5, b: 998.5 }, { a: 500, b: 500, c: 0 }];
    for (const v of invalid)
      expect(() => validateAllocation(v, ['a', 'b'], 1000)).toThrow();
  });
  it('任务未结束时附件不过期，结束后准确保留15天', () => {
    expect(expiryAt(null)).toBeNull();
    expect(expiryAt(new Date('2026-11-01T00:00:00Z'))?.toISOString()).toBe('2026-11-16T00:00:00.000Z');
  });
  it('拒绝跨站写请求和缺少来源的请求', () => {
    expect(() => assertOrigin('https://inside.example', 'https://inside.example')).not.toThrow();
    expect(() => assertOrigin('https://evil.example', 'https://inside.example')).toThrow();
    expect(() => assertOrigin(null, 'https://inside.example')).toThrow();
  });
  it('业务附件有独立权限，管理员和所属参与者可读', () => {
    const attachment = { owner_id: 'owner', submission_id: 's', participant_ids: ['worker'], publisher_id: 'publisher' };
    expect(canReadAttachment({ id: 'other', role: 'member' }, attachment)).toBe(false);
    expect(canReadAttachment({ id: 'worker', role: 'member' }, attachment)).toBe(true);
    expect(canReadAttachment({ id: 'publisher', role: 'member' }, attachment)).toBe(true);
    expect(canReadAttachment({ id: 'admin', role: 'admin' }, attachment)).toBe(true);
    expect(canReadAttachment({ id: 'other', role: 'member' }, { ...attachment, submission_id: null })).toBe(true);
  });
});
