import { describe, expect, it } from 'vite-plus/test';
import { addYen, assertYen } from '../src/index.ts';

describe('money', () => {
  it('整数の円だけ受け付ける', () => {
    expect(assertYen(12000)).toBe(12000);
    expect(() => assertYen(0.1)).toThrow(RangeError);
    expect(() => assertYen(Number.NaN)).toThrow(RangeError);
  });
  it('合計も整数（浮動小数点誤差が出ない）', () => {
    expect(addYen(8000, 3000, 500)).toBe(11500);
    expect(() => addYen(1, 0.5)).toThrow(RangeError);
  });
});
