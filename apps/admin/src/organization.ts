/**
 * リクエストの、アクティブな組織 ID（Better Auth のセッションの `activeOrganizationId`）。
 *
 * **フェーズ 3（管理者認証）で、セッションから取り出す実装に置き換える**。いまは認証がないので、常に決まらない（`null`）。
 * このため、テナントのトランザクションの対象のパス（`isTenantScopedPath`）は、現状すべて 401 になる（安全側）。
 * 検証用の `x-tenant-id` ヘッダによる上書きは、本実装に持ち込まない（CLAUDE.md「認証」）。
 */
export function getOrganizationId(): string | null {
  return null;
}
