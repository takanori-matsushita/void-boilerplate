import pg from 'pg';
import { APP_ROLE } from './config.mts';

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

export interface RoleCheck {
  role: string;
  bypassRls: boolean;
  superuser: boolean;
}

/**
 * アプリ用ロールを作る（べき等）。管理用の接続（DDL・ロール作成権限あり）で実行する。
 * - NOBYPASSRLS / NOSUPERUSER の一般ロール（RLS を強制される）
 * - public スキーマの利用と、既存・将来のテーブル／シーケンスへの DML 権限
 * パスワードは `format('%L')` でサーバー側でリテラル化し、SQL に直接連結しない。
 */
export async function ensureAppRole(
  adminUrl: string,
  password: string,
  appRole: string = APP_ROLE,
): Promise<RoleCheck> {
  if (!IDENTIFIER.test(appRole)) throw new TypeError(`不正なロール名です: ${appRole}`);
  const client = new pg.Client({ connectionString: adminUrl });
  await client.connect();
  try {
    const exists = await client.query('select 1 from pg_roles where rolname = $1', [appRole]);
    const verb = exists.rowCount ? 'ALTER' : 'CREATE';
    const stmt = await client.query<{ sql: string }>(
      `select format('%s ROLE %I LOGIN PASSWORD %L NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE', $1::text, $2::text, $3::text) as sql`,
      [verb, appRole, password],
    );
    await client.query(stmt.rows[0]!.sql);

    const grants = await client.query<{ sql: string }>(
      `select unnest(array[
         format('GRANT CONNECT ON DATABASE %I TO %I', current_database(), $1::text),
         format('GRANT USAGE ON SCHEMA public TO %I', $1::text),
         format('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO %I', $1::text),
         format('GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO %I', $1::text),
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO %I', current_user, $1::text),
         format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO %I', current_user, $1::text)
       ]) as sql`,
      [appRole],
    );
    for (const row of grants.rows) await client.query(row.sql);

    const check = await client.query<{ rolbypassrls: boolean; rolsuper: boolean }>(
      'select rolbypassrls, rolsuper from pg_roles where rolname = $1',
      [appRole],
    );
    const row = check.rows[0];
    if (!row || row.rolbypassrls || row.rolsuper) {
      throw new Error(`ロール ${appRole} が RLS を強制される一般ロールになっていません`);
    }
    return { role: appRole, bypassRls: row.rolbypassrls, superuser: row.rolsuper };
  } finally {
    await client.end();
  }
}
