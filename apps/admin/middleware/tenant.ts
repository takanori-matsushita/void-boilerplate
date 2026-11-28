import { runInTenantTransaction } from '@club/db';
import { defineMiddleware } from 'void';
import { db } from 'void/db';
import { getOrganizationId } from '../src/organization';
import { isTenantScopedPath } from '../src/tenant-paths';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

declare module 'void' {
  interface CloudContextVariables {
    /** テナントのトランザクション。**ハンドラは `c.get('tx')` だけを使い、`void/db` の `db` を直接使わない**（`max: 1` のプールで詰まる） */
    tx: Tx;
    tenantId: string;
  }
}

/**
 * 1 リクエスト = 1 テナントトランザクション（全 API 共通。ここ 1 箇所）。
 * 組織 → tenant_id の引き当て・`set_config`・commit / rollback は、`@club/db` の `runInTenantTransaction`（実 Postgres で検証済み）。
 * Hono はハンドラの例外を握りつぶして 500 を返すので、`next()` の後に `c.error` / `status >= 500` を見て、明示的にロールバックする。
 */
export default defineMiddleware(async (c, next) => {
  if (!isTenantScopedPath(c.req.path)) return next();

  const organizationId = getOrganizationId();
  if (!organizationId) return c.json({ error: 'unauthorized' }, 401);

  const result = await runInTenantTransaction(db, organizationId, async (tx, tenantId) => {
    c.set('tx', tx);
    c.set('tenantId', tenantId);
    await next();
    return { value: c.res, rollback: Boolean(c.error) || c.res.status >= 500 };
  });

  if (!result.ok) return c.json({ error: 'tenant_not_found' }, 403);
  c.res = result.value;
});
