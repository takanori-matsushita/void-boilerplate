/** テーブル名・ロール名として安全な識別子だけを許可する（SQL 組み立て時のインジェクション防止） */
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENTIFIER.test(name)) throw new TypeError(`不正な識別子です: ${name}`);
  return `"${name}"`;
}

export interface TenantTableOptions {
  /** テナントを識別するカラム名（既定: tenant_id） */
  column?: string;
  /** 一般ロール（RLS を強制される）。既定: app_user */
  appRole?: string;
}

/**
 * テナントに属するテーブル用の RLS マイグレーション SQL を生成する。
 * - RLS を有効化し、`tenant_id = current_setting('app.tenant_id')::uuid` のポリシーを USING / WITH CHECK の両方に付ける
 * - `current_setting` は第2引数を省略する（未設定ならエラーで失敗＝安全側に倒れる）
 * - 一般ロールに DML 権限を付与する
 * Drizzle の生成 SQL の末尾に、`--> statement-breakpoint` 区切りで追記して使う。
 */
export function tenantTableRlsSql(table: string, options: TenantTableOptions = {}): string {
  const column = ident(options.column ?? 'tenant_id');
  const role = ident(options.appRole ?? 'app_user');
  const t = ident(table);
  const policy = ident(`${table}_tenant_isolation`);
  return [
    `ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`,
    `CREATE POLICY ${policy} ON ${t} USING (${column} = current_setting('app.tenant_id')::uuid) WITH CHECK (${column} = current_setting('app.tenant_id')::uuid);`,
    `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${role};`,
  ].join('\n--> statement-breakpoint\n');
}
