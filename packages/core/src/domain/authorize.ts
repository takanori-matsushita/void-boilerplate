import type { Permission } from '@club/shared';

/**
 * 認可の判断（純粋関数。I/O なし）。設計は docs/design/permissions.md。
 * 最外周が、セッション（Better Auth のロールと、メンバーごとの拠点の設定）から `AuthContext` を作って渡す。
 */
export interface AuthContext {
  /** ロールから決まる、機能の権限 */
  readonly permissions: ReadonlySet<Permission>;
  /** 見られる拠点。`'all'` = 全拠点（新しい拠点も自動で見える）、Set = 列挙した拠点だけ（0 件なら何も見えない） */
  readonly sites: 'all' | ReadonlySet<string>;
}

export type AuthResult = 'ok' | 'forbidden' | 'not_found';

/**
 * 機能の権限 → 拠点の範囲の順に判断する。
 * - 機能の権限がない → `forbidden`（403）
 * - 権限はあるが、リソースの拠点が範囲外 → `not_found`（404。存在を漏らさない）
 */
export function authorize(ctx: AuthContext, permission: Permission, target?: { siteId: string }): AuthResult {
  if (!ctx.permissions.has(permission)) return 'forbidden';
  if (target && ctx.sites !== 'all' && !ctx.sites.has(target.siteId)) return 'not_found';
  return 'ok';
}

export type SiteScope = { all: true } | { all: false; siteIds: string[] };

/** クエリの絞り込みの条件。`siteIds` が空なら、何も見えない（安全側） */
export function siteScope(ctx: AuthContext): SiteScope {
  return ctx.sites === 'all' ? { all: true } : { all: false, siteIds: [...ctx.sites] };
}

export type DefineRoleResult = { ok: true } | { ok: false; reason: 'missing_staff_manage' | 'exceeds_actor' };

/**
 * ロールを作る・編集するときの、権限の昇格の防止。
 * ①ロールの管理（`staff:manage`）を持つこと ②自分が持たない権限を含むロールは作れない（自分の範囲まで）。
 */
export function canDefineRole(actor: AuthContext, rolePermissions: readonly Permission[]): DefineRoleResult {
  if (!actor.permissions.has('staff:manage')) return { ok: false, reason: 'missing_staff_manage' };
  if (!rolePermissions.every((p) => actor.permissions.has(p))) return { ok: false, reason: 'exceeds_actor' };
  return { ok: true };
}

export interface StaffRef {
  readonly id: string;
  /** 標準ロールのキー（`admin` = 運営者）またはカスタムロールの名前 */
  readonly role: string;
}

export type StaffChange = { type: 'remove'; id: string } | { type: 'set_role'; id: string; role: string };

const ADMIN_ROLE = 'admin';

/** 変更したあとも、運営者が 1 人以上残るか。残らない変更（最後の運営者の削除・降格）は `false` */
export function leavesAtLeastOneAdmin(members: readonly StaffRef[], change: StaffChange): boolean {
  const after = members.flatMap((m) => {
    if (m.id !== change.id) return [m];
    return change.type === 'remove' ? [] : [{ ...m, role: change.role }];
  });
  return after.some((m) => m.role === ADMIN_ROLE);
}
