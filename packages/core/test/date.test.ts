import { CalendarDate } from '@internationalized/date';
import fc from 'fast-check';
import { describe, expect, it } from 'vite-plus/test';
import { jstDateOf, jstStartOf } from '../src/index.ts';

describe('jstDateOf（UTC の時刻 → 日本の日付）', () => {
  it('UTC 15:00 を境に、日本では翌日になる', () => {
    expect(jstDateOf(new Date('2026-03-31T14:59:59.999Z')).toString()).toBe('2026-03-31');
    expect(jstDateOf(new Date('2026-03-31T15:00:00.000Z')).toString()).toBe('2026-04-01');
  });

  it('年またぎ・うるう日も日本の暦で数える', () => {
    expect(jstDateOf(new Date('2025-12-31T15:00:00Z')).toString()).toBe('2026-01-01');
    expect(jstDateOf(new Date('2028-02-28T15:00:00Z')).toString()).toBe('2028-02-29');
  });
});

describe('jstStartOf（日本の日付 → その日の 0 時の時刻）', () => {
  it('日本の 0 時は、前日の UTC 15:00', () => {
    expect(jstStartOf(new CalendarDate(2026, 4, 1)).toISOString()).toBe('2026-03-31T15:00:00.000Z');
  });
});

describe('日付境界の性質', () => {
  it('どの時刻も、その日の 0 時以上で、翌日の 0 時より前になる', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2000-01-01T00:00:00Z'), max: new Date('2100-01-01T00:00:00Z'), noInvalidDate: true }),
        (instant) => {
          const date = jstDateOf(instant);

          expect(jstStartOf(date).getTime()).toBeLessThanOrEqual(instant.getTime());
          expect(instant.getTime()).toBeLessThan(jstStartOf(date.add({ days: 1 })).getTime());
        },
      ),
    );
  });
});
