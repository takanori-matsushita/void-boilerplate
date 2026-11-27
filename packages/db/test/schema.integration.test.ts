import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { withTenant } from '../src/index.ts';

// 実際のマイグレーション（apps/admin/db/migrations）を、空の一時データベースに適用して、スキーマ全体を検証する。
const MIGRATIONS = path.resolve(import.meta.dirname, '../../../apps/admin/db/migrations');
const BASE = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/club';
const dbName = `t_schema_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/** RLS を付けないテーブル（理由つき）。**増やすときは、情報漏えいにならないことを確認してから**。認証系（フェーズ 3）などが入る */
const RLS_EXEMPT: Record<string, string> = {};

const urlFor = (user: string) => {
  const u = new URL(BASE);
  u.username = user;
  u.password = user;
  u.pathname = `/${dbName}`;
  return u.toString();
};

let superClient: pg.Client;
let admin: pg.Client;
let app: pg.Client;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  superClient = new pg.Client({ connectionString: BASE });
  await superClient.connect();
  await superClient.query(`create database ${dbName} owner app_admin`);
  admin = new pg.Client({ connectionString: urlFor('app_admin') });
  await admin.connect();

  const files = readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of files) {
    for (const stmt of readFileSync(path.join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await admin.query(stmt);
    }
  }

  const insert = (name: string) =>
    admin
      .query<{ id: string }>('insert into tenant (name) values ($1) returning id', [name])
      .then((r) => r.rows[0]!.id);
  tenantA = await insert('クラブ A');
  tenantB = await insert('クラブ B');
  await admin.query('insert into site (tenant_id, name) values ($1, $2), ($1, $3), ($4, $5)', [
    tenantA,
    'A 競技場',
    'A 体育館',
    tenantB,
    'B 競技場',
  ]);

  app = new pg.Client({ connectionString: urlFor('app_user') });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await superClient?.query(`drop database if exists ${dbName} with (force)`);
  await superClient?.end();
});

const names = async (table: string, tenant: string) =>
  withTenant(app, tenant, async (ex) =>
    ((await ex.query(`select name from ${table} order by name`)) as pg.QueryResult).rows.map((r) => r.name),
  );

describe('スキーマ全体の不変条件', () => {
  it('public のすべてのテーブルで、RLS が有効で、ポリシーが 1 つ以上ある（例外は理由つきで列挙）', async () => {
    const tables = await admin.query<{ name: string; rls: boolean; policies: number }>(`
      select c.relname as name, c.relrowsecurity as rls,
             (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by c.relname`);

    const unprotected = tables.rows
      .filter((t) => !RLS_EXEMPT[t.name] && (!t.rls || t.policies === 0))
      .map((t) => t.name);

    expect(tables.rows.length).toBeGreaterThan(0);
    expect(unprotected).toEqual([]);
  });

  it('tenant_id を持つテーブルは、すべて tenant を参照する外部キーを持つ', async () => {
    const res = await admin.query<{ name: string }>(`
      select c.table_name as name from information_schema.columns c
      where c.table_schema = 'public' and c.column_name = 'tenant_id'
        and not exists (
          select 1 from pg_constraint k
          where k.contype = 'f' and k.conrelid = format('public.%I', c.table_name)::regclass and k.confrelid = 'public.tenant'::regclass)`);

    expect(res.rows).toEqual([]);
  });
});

describe('tenant', () => {
  it('主キーは DB が採番する UUID v7 で、時刻順に増える', async () => {
    const ids = await admin.query<{ id: string; version: number }>(
      'select id, uuid_extract_version(id) as version from tenant order by id',
    );

    expect(ids.rows.every((r) => r.version === 7)).toBe(true);
    expect(ids.rows.map((r) => r.id)).toEqual([tenantA, tenantB]);
  });

  it('アプリ用ロールは、自分のテナントの行だけを見られる', async () => {
    expect(await names('tenant', tenantA)).toEqual(['クラブ A']);
    expect(await names('tenant', tenantB)).toEqual(['クラブ B']);
  });

  it('テナント未設定では失敗する（安全側）', async () => {
    await expect(app.query('select * from tenant')).rejects.toThrow();
  });
});

describe('site（拠点）', () => {
  it('テナント A からは A の拠点だけ、B からは B の拠点だけが見える', async () => {
    expect(await names('site', tenantA)).toEqual(['A 体育館', 'A 競技場']);
    expect(await names('site', tenantB)).toEqual(['B 競技場']);
  });

  it('他テナントの tenant_id での書き込みを拒否する（WITH CHECK）', async () => {
    await expect(
      withTenant(app, tenantA, (ex) =>
        ex.query('insert into site (tenant_id, name) values ($1, $2)', [tenantB, '偽装']),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('同じテナントで拠点名は重複できないが、別テナントなら同じ名前を使える', async () => {
    await expect(
      withTenant(app, tenantA, (ex) =>
        ex.query('insert into site (tenant_id, name) values ($1, $2)', [tenantA, 'A 競技場']),
      ),
    ).rejects.toThrow(/unique/);

    await withTenant(app, tenantB, (ex) =>
      ex.query('insert into site (tenant_id, name) values ($1, $2)', [tenantB, 'A 競技場']),
    );
    expect(await names('site', tenantB)).toEqual(['A 競技場', 'B 競技場']);
    await admin.query("delete from site where tenant_id = $1 and name = 'A 競技場'", [tenantB]);
  });

  it('拠点を持つテナントは、削除できない（拠点が残る）', async () => {
    await expect(admin.query('delete from tenant where id = $1', [tenantA])).rejects.toThrow(/foreign key/);
  });
});
