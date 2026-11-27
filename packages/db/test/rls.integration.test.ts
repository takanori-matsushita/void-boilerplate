import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { applyTenant, withTenant } from '../src/index.ts';
import { tenantTableRlsSql } from '../src/rls.ts';

const BASE = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/club';
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const dbName = `t_rls_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

const urlFor = (user: string, password: string) => {
  const u = new URL(BASE);
  u.username = user;
  u.password = password;
  u.pathname = `/${dbName}`;
  return u.toString();
};

let superClient: pg.Client;
let admin: pg.Client; // RLS をバイパスする管理用ロール（マイグレーション・Cron・Queue consumer 相当）
let app: pg.Client; // RLS を強制される一般ロール（アプリ）

beforeAll(async () => {
  superClient = new pg.Client({ connectionString: BASE });
  await superClient.connect();
  await superClient.query(`create database ${dbName} owner app_admin`);
  admin = new pg.Client({ connectionString: urlFor('app_admin', 'app_admin') });
  await admin.connect();
  // 主キーの既定値は、DB が採番する uuidv7()（PostgreSQL 18 の標準関数。拡張・ライブラリは不要）
  await admin.query(
    'create table notes (id uuid primary key default uuidv7(), tenant_id uuid not null, body text not null)',
  );
  for (const stmt of tenantTableRlsSql('notes').split('--> statement-breakpoint')) await admin.query(stmt);
  await admin.query('insert into notes (tenant_id, body) values ($1, $2), ($3, $4)', [A, 'a-note', B, 'b-note']);
  app = new pg.Client({ connectionString: urlFor('app_user', 'app_user') });
  await app.connect();
});

afterAll(async () => {
  await app?.end();
  await admin?.end();
  await superClient?.query(`drop database if exists ${dbName} with (force)`);
  await superClient?.end();
});

const bodies = async (c: pg.Client, tenant: string) =>
  withTenant(c, tenant, async (ex) =>
    ((await ex.query('select body from notes order by body')) as pg.QueryResult).rows.map((r) => r.body),
  );

describe('RLS（アプリ用ロール）', () => {
  it('ロールの前提: アプリ用は RLS を強制され、管理用はバイパスする', async () => {
    const roles = await superClient.query(
      "select rolname, rolbypassrls, rolsuper from pg_roles where rolname in ('app_user','app_admin') order by rolname",
    );
    expect(roles.rows).toEqual([
      { rolname: 'app_admin', rolbypassrls: true, rolsuper: false },
      { rolname: 'app_user', rolbypassrls: false, rolsuper: false },
    ]);
  });

  it('テナント A は A の行だけ、B は B の行だけ見える', async () => {
    expect(await bodies(app, A)).toEqual(['a-note']);
    expect(await bodies(app, B)).toEqual(['b-note']);
  });

  it('他テナントの tenant_id での書き込みを拒否する（WITH CHECK）', async () => {
    await expect(
      withTenant(app, A, (ex) => ex.query('insert into notes (tenant_id, body) values ($1, $2)', [B, 'forged'])),
    ).rejects.toThrow(/row-level security/);
    expect(await bodies(app, B)).toEqual(['b-note']);
  });

  it('他テナントの行は UPDATE / DELETE の対象にならない', async () => {
    const res = (await withTenant(app, A, (ex) =>
      ex.query('delete from notes where body = $1', ['b-note']),
    )) as pg.QueryResult;
    expect(res.rowCount).toBe(0);
    expect(await bodies(app, B)).toEqual(['b-note']);
  });

  it('テナント未設定は失敗する（安全側）', async () => {
    await app.query('begin');
    await expect(app.query('select * from notes')).rejects.toThrow();
    await app.query('rollback');
  });

  it('SET LOCAL 相当なので、トランザクション終了後にテナントが残らない', async () => {
    await bodies(app, A);
    await app.query('begin');
    await expect(app.query('select * from notes')).rejects.toThrow(); // A の設定が引き継がれていれば読めてしまう
    await app.query('rollback');
  });

  it('例外でロールバックされ、書き込みが残らない', async () => {
    await expect(
      withTenant(app, A, async (ex) => {
        await ex.query('insert into notes (tenant_id, body) values ($1, $2)', [A, 'should-rollback']);
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await bodies(app, A)).toEqual(['a-note']);
  });

  it('自テナントへの書き込みは成功し、同じトランザクション内で読める', async () => {
    const rows = await withTenant(app, A, async (ex) => {
      await ex.query('insert into notes (tenant_id, body) values ($1, $2)', [A, 'second']);
      return ((await ex.query('select body from notes order by body')) as pg.QueryResult).rows.map((r) => r.body);
    });
    expect(rows).toEqual(['a-note', 'second']);
    await admin.query("delete from notes where body = 'second'");
  });

  it('主キーの既定値 uuidv7() は、バージョン 7 の UUID を採番し、時刻順に増える', async () => {
    const res = await admin.query(
      "insert into notes (tenant_id, body) select $1, 'v7-' || g from generate_series(1, 5) g returning id, uuid_extract_version(id) as version",
      [A],
    );

    const ids = res.rows.map((r: { id: string }) => r.id);
    expect(res.rows.every((r: { version: number }) => r.version === 7)).toBe(true);
    expect([...ids].sort()).toEqual(ids);

    // 他のテストの件数に影響しないよう、足した行を消す
    await admin.query("delete from notes where body like 'v7-%'");
  });

  it('applyTenant に UUID 以外を渡すと SQL を発行せず拒否する', async () => {
    await app.query('begin');
    await expect(applyTenant(app, "x'; drop table notes; --")).rejects.toThrow(TypeError);
    await app.query('rollback');
  });

  it('管理用ロールは全テナントの行を見られる（Cron / Queue consumer 用）', async () => {
    const rows = await admin.query('select count(*)::int as n from notes');
    expect(rows.rows[0].n).toBe(2);
  });
});
