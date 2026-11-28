import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { runInTenantTransaction } from '../src/index.ts';

// 実際のマイグレーションを適用した一時データベースに、アプリ用ロール（RLS を強制）のプールで接続して検証する。
// プールは 1 接続だけ（Void の `db` と同じ条件。トランザクション外のクエリは、同じ接続を使う）。
const MIGRATIONS = path.resolve(import.meta.dirname, '../../../apps/admin/db/migrations');
const BASE = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/club';
const dbName = `t_txn_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const urlFor = (user: string) => {
  const u = new URL(BASE);
  u.username = user;
  u.password = user;
  u.pathname = `/${dbName}`;
  return u.toString();
};

const ORG_A = 'org_aaaaaaaa';
const ORG_B = 'org_bbbbbbbb';

let superClient: pg.Client;
let admin: pg.Client;
let pool: pg.Pool;
let db: NodePgDatabase;
let tenantA: string;

const siteNames = async (tx: Pick<NodePgDatabase, 'execute'>) =>
  (await tx.execute<{ name: string }>(sql`select name from site order by name`)).rows.map((r) => r.name);

beforeAll(async () => {
  superClient = new pg.Client({ connectionString: BASE });
  await superClient.connect();
  await superClient.query(`create database ${dbName} owner app_admin`);
  admin = new pg.Client({ connectionString: urlFor('app_admin') });
  await admin.connect();
  for (const file of readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith('.sql'))
    .sort()) {
    for (const stmt of readFileSync(path.join(MIGRATIONS, file), 'utf8').split('--> statement-breakpoint')) {
      if (stmt.trim()) await admin.query(stmt);
    }
  }
  const insert = (name: string, org: string) =>
    admin
      .query<{ id: string }>('insert into tenant (name, organization_id) values ($1, $2) returning id', [name, org])
      .then((r) => r.rows[0]!.id);
  tenantA = await insert('クラブ A', ORG_A);
  const tenantB = await insert('クラブ B', ORG_B);
  await admin.query('insert into site (tenant_id, name) values ($1, $2), ($1, $3), ($4, $5)', [
    tenantA,
    'A 競技場',
    'A 体育館',
    tenantB,
    'B 競技場',
  ]);

  pool = new pg.Pool({ connectionString: urlFor('app_user'), max: 1 });
  db = drizzle(pool);
});

afterAll(async () => {
  await pool?.end();
  await admin?.end();
  await superClient?.query(`drop database if exists ${dbName} with (force)`);
  await superClient?.end();
});

describe('runInTenantTransaction（組織 ID → テナントを設定 → 処理 → commit / rollback）', () => {
  it('組織 ID からテナントを設定し、そのテナントの行だけが見える', async () => {
    const result = await runInTenantTransaction(db, ORG_A, async (tx, tenantId) => ({
      value: { tenantId, sites: await siteNames(tx) },
    }));

    expect(result).toEqual({ ok: true, value: { tenantId: tenantA, sites: ['A 体育館', 'A 競技場'] } });
  });

  it('別の組織なら、別のテナントの行だけが見える（接続を再利用しても、前のテナントが残らない）', async () => {
    const result = await runInTenantTransaction(db, ORG_B, async (tx) => ({ value: await siteNames(tx) }));

    expect(result).toEqual({ ok: true, value: ['B 競技場'] });
  });

  it('見つからない組織では、処理を呼ばずに tenant_not_found を返す', async () => {
    let called = false;

    const result = await runInTenantTransaction(db, 'org_unknown', async () => {
      called = true;
      return { value: 1 };
    });

    expect(result).toEqual({ ok: false, reason: 'tenant_not_found' });
    expect(called).toBe(false);
  });

  it('処理が正常に終われば commit される', async () => {
    await runInTenantTransaction(db, ORG_A, async (tx, tenantId) => {
      await tx.execute(sql`insert into site (tenant_id, name) values (${tenantId}, 'commit される拠点')`);
      return { value: undefined };
    });

    const rows = await admin.query("select name from site where name = 'commit される拠点'");
    expect(rows.rowCount).toBe(1);
    await admin.query("delete from site where name = 'commit される拠点'");
  });

  it('処理が rollback を求めたら（500 など）、書き込みを取り消す。値は返す', async () => {
    const result = await runInTenantTransaction(db, ORG_A, async (tx, tenantId) => {
      await tx.execute(sql`insert into site (tenant_id, name) values (${tenantId}, 'rollback される拠点')`);
      return { value: 'responded', rollback: true };
    });

    expect(result).toEqual({ ok: true, value: 'responded', rolledBack: true });
    expect((await admin.query("select 1 from site where name = 'rollback される拠点'")).rowCount).toBe(0);
  });

  it('処理が例外を投げたら、書き込みを取り消して、例外を再送出する', async () => {
    await expect(
      runInTenantTransaction(db, ORG_A, async (tx, tenantId) => {
        await tx.execute(sql`insert into site (tenant_id, name) values (${tenantId}, '例外の拠点')`);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    expect((await admin.query("select 1 from site where name = '例外の拠点'")).rowCount).toBe(0);
  });

  it('トランザクションの外では、テナントが残らず、アプリ用ロールは何も読めない（安全側）', async () => {
    await runInTenantTransaction(db, ORG_A, async () => ({ value: undefined }));

    await expect(db.execute(sql`select * from site`)).rejects.toThrow();
  });
});
