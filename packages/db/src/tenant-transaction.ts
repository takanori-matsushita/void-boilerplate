import { sql, type SQL } from 'drizzle-orm';

/** Drizzle のトランザクション（`tx`）から必要な部分だけ。`void/db` の `db` でも、`drizzle-orm/node-postgres` でも満たす */
export interface TenantExecutor {
  execute(query: SQL): PromiseLike<{ rows: readonly unknown[] }>;
}

export type TenantTransactionResult<R> =
  | { ok: true; value: R; rolledBack?: true }
  | { ok: false; reason: 'tenant_not_found' };

/** 処理の結果。`rollback: true` を返すと、値は返したまま、書き込みを取り消す（500 など） */
export interface TenantWork<R> {
  value: R;
  rollback?: boolean;
}

class RollbackSignal<R> extends Error {
  constructor(readonly value: R) {
    super('rollback');
  }
}

/**
 * 組織 ID（Better Auth）からテナントを引き、トランザクションに設定して、処理を実行する（テナントミドルウェアの中心）。
 * - `tenant_id_for_organization`（SECURITY DEFINER）で引く。引けなければ処理を呼ばず `tenant_not_found`（呼び出し側が 403 などにする）。
 * - 引き当てと `set_config('app.tenant_id', …, true)` は 1 つの文。トランザクション終了で、設定は消える（`SET LOCAL` 相当）。
 * - 処理が例外を投げる、または `rollback: true` を返したら、書き込みを取り消す（Hono はハンドラの例外を握りつぶすので、呼び出し側が判断する）。
 * 処理には `tx` と `tenantId` を渡す。**ハンドラは `tx` だけを使う**（`db` を直接使うと、`max: 1` のプールで詰まる）。
 * Void に依存しない: `db` は、`transaction` を持つ Drizzle のデータベースなら何でもよい。
 */
export async function runInTenantTransaction<Tx extends TenantExecutor, R>(
  db: { transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> },
  organizationId: string,
  work: (tx: Tx, tenantId: string) => Promise<TenantWork<R>>,
): Promise<TenantTransactionResult<R>> {
  try {
    return await db.transaction(async (tx): Promise<TenantTransactionResult<R>> => {
      const res = await tx.execute(
        sql`select set_config('app.tenant_id', coalesce(tenant_id_for_organization(${organizationId})::text, ''), true) as tenant_id`,
      );
      const tenantId = (res.rows[0] as { tenant_id?: string } | undefined)?.tenant_id;
      if (!tenantId) return { ok: false, reason: 'tenant_not_found' };

      const { value, rollback } = await work(tx, tenantId);
      if (rollback) throw new RollbackSignal(value);
      return { ok: true, value };
    });
  } catch (error) {
    if (error instanceof RollbackSignal) return { ok: true, value: error.value as R, rolledBack: true };
    throw error;
  }
}
