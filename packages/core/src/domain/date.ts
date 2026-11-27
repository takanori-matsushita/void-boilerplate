import { type CalendarDate, fromDate, toCalendarDate } from '@internationalized/date';

/** 表示と日付境界の計算は Asia/Tokyo（CLAUDE.md のデータ規約）。日本に夏時間はない */
export const TIME_ZONE = 'Asia/Tokyo';

/** 時刻（UTC で保存した `timestamptz`）を、日本の日付にする */
export function jstDateOf(instant: Date): CalendarDate {
  return toCalendarDate(fromDate(instant, TIME_ZONE));
}

/** 日本の日付の 0 時の時刻（その日の始まり）。日付の範囲検索の下限に使う */
export function jstStartOf(date: CalendarDate): Date {
  return date.toDate(TIME_ZONE);
}
