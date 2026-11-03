import { describe, expect, it } from 'vitest';
import { toUnits, validateAllocation, expiryAt, assertOrigin, canReadAttachment } from '../src/lib/rules';

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
