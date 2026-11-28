import * as v from 'valibot';

/**
 * 権限カタログ（`リソース:操作`）。設計は docs/design/permissions.md。
 * カスタムロールが選べる権限は、これだけ（`permissionSchema` で検証する）。
 * 新しい機能を足すときは、ここに足して、標準ロールの割り当てを決める。
 */
export const PERMISSION_CATALOG = {
  /** 会員（子ども）。`view_pii` は、生年月日・保護者の連絡先 */
  member: ['view', 'view_pii', 'create', 'update', 'change_status'],
  /** 請求。`record_payment` は入金消込、`void` は取消、`refund` は返金 */
  invoice: ['view', 'create', 'record_payment', 'void', 'refund'],
  /** 入金先（決済の受け取り）。Stripe など、方式に依存しない名前 */
  payment_account: ['view', 'manage'],
  /** メッセージ（配信・返信スレッド） */
  message: ['view', 'send', 'reply'],
  /** スケジュール（日程・出欠・振替） */
  schedule: ['view', 'manage', 'attendance'],
  /** 大会・エントリー */
  event: ['view', 'manage'],
  /** マスタ（会場・クラス・料金・種目・コーチ） */
  master: ['view', 'manage'],
  /** スタッフ（メンバー・ロール・拠点の割り当て） */
  staff: ['view', 'manage'],
} as const;

type Catalog = typeof PERMISSION_CATALOG;
type Resource = keyof Catalog;

export type Permission = { [R in Resource]: `${R}:${Catalog[R][number]}` }[Resource];

export const PERMISSIONS = (Object.keys(PERMISSION_CATALOG) as Resource[]).flatMap((resource) =>
  PERMISSION_CATALOG[resource].map((action) => `${resource}:${action}` as Permission),
);

export const permissionSchema = v.picklist(PERMISSIONS);

/** 標準ロールのキー。コードで定義し、削除・編集できない（コピーして使う） */
export const STANDARD_ROLE_KEYS = ['admin', 'office', 'coach'] as const;
export type StandardRoleKey = (typeof STANDARD_ROLE_KEYS)[number];

const COACH: readonly Permission[] = [
  'member:view',
  'member:view_pii',
  'message:view',
  'message:send',
  'message:reply',
  'schedule:view',
  'schedule:manage',
  'schedule:attendance',
  'master:view',
];

const OFFICE: readonly Permission[] = [
  ...COACH,
  'member:create',
  'member:update',
  'member:change_status',
  'invoice:view',
  'invoice:create',
  'invoice:record_payment',
  'invoice:void',
  'invoice:refund',
  'payment_account:view',
  'event:view',
  'event:manage',
];

/**
 * 標準ロールの権限。運営者 = すべて、事務 = 日常の運用（入金先の変更・マスタの編集・メンバー管理は不可）、
 * コーチ = 会員・配信・日程・出欠（請求・入金先・イベント・メンバー管理は不可）。
 * 「コーチは担当拠点だけ」は、権限ではなく、メンバーごとの拠点の設定（`AuthContext.sites`）で決まる。
 */
export const STANDARD_ROLES: Readonly<Record<StandardRoleKey, readonly Permission[]>> = {
  admin: PERMISSIONS,
  office: OFFICE,
  coach: COACH,
};
