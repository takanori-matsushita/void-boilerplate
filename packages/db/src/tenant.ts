import { UUID_PATTERN } from '@club/shared';

/** `pg` の Client / PoolClient / Drizzle の tx から `query` 相当を渡せるようにするための最小インターフェース */
export interface SqlExecutor {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

export const TENANT_SETTING = 'app.tenant_id';

export function assertTenantId(value: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new TypeError('tenant_id は UUID 形式である必要があります');
  }
  return value;
}

/**
 * 現在のトランザクションにテナントを設定する（`SET LOCAL` 相当。第3引数 true = トランザクション終了で破棄）。
 * 必ず BEGIN 済みの接続で呼ぶこと。接続プール（Hyperdrive 等）でもトランザクションをまたいで残らない。
 */
export async function applyTenant(executor: SqlExecutor, tenantId: string): Promise<void> {
  await executor.query(`select set_config('${TENANT_SETTING}', $1, true)`, [assertTenantId(tenantId)]);
}

/** 専用の接続でトランザクションを張り、テナントを設定して処理を実行する（スクリプト・テスト・Cron 向け）。 */
export async function withTenant<T>(
  client: SqlExecutor,
  tenantId: string,
  run: (executor: SqlExecutor) => Promise<T>,
): Promise<T> {
  await client.query('begin');
  try {
    await applyTenant(client, tenantId);
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  }
}
