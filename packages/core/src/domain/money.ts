/** 金額は円の整数。浮動小数点は使わない（CLAUDE.md のデータ規約） */
export type Yen = number & { readonly __brand: 'Yen' };

export function assertYen(value: number): Yen {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`金額は整数（円）で指定してください: ${value}`);
  }
  return value as Yen;
}

export function addYen(...values: number[]): Yen {
  return assertYen(values.reduce((sum, v) => sum + assertYen(v), 0));
}
