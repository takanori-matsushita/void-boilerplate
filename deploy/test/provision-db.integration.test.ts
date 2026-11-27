import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vite-plus/test';
import { ensureAppRole } from '../scripts/provision-db.mts';

const BASE = process.env.TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:54329/club';
const suffix = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const dbName = `t_prov_${suffix}`;
const role = `app_it_${suffix}`;

const urlFor = (db: string, user?: string, password?: string) => {
  const u = new URL(BASE);
  u.pathname = `/${db}`;
  if (user) u.username = user;
  if (password) u.password = password;
  return u.toString();
};

let sup: pg.Client;
beforeAll(async () => {
  sup = new pg.Client({ connectionString: BASE });
  await sup.connect();
  await sup.query(`create database ${dbName}`);
  const inDb = new pg.Client({ connectionString: urlFor(dbName) });
  await inDb.connect();
  await inDb.query('create table existing (id int primary key)');
  await inDb.end();
});
afterAll(async () => {
  await sup?.query(`drop database if exists ${dbName} with (force)`);
  await sup?.query(`drop role if exists ${role}`);
  await sup?.end();
});

describe('ensureAppRole', () => {
  it('RLS を強制される一般ロールを作る（べき等で、パスワードも更新できる）', async () => {
    const first = await ensureAppRole(urlFor(dbName), 'pw-one', role);
    expect(first).toEqual({ role, bypassRls: false, superuser: false });
    await ensureAppRole(urlFor(dbName), 'pw-two', role); // 2 回目は ALTER

    const c = new pg.Client({ connectionString: urlFor(dbName, role, 'pw-two') });
    await c.connect();
    expect((await c.query('select count(*)::int n from existing')).rows[0].n).toBe(0); // 既存テーブルに権限がある
    await c.end();

    const old = new pg.Client({ connectionString: urlFor(dbName, role, 'pw-one') });
    await expect(old.connect()).rejects.toThrow(); // 古いパスワードは使えない
  });

  it('スキーマ変更（DDL）はできない', async () => {
    const c = new pg.Client({ connectionString: urlFor(dbName, role, 'pw-two') });
    await c.connect();
    await expect(c.query('create table forbidden (id int)')).rejects.toThrow(/permission denied/);
    await c.end();
  });

  it('不正なロール名を拒否する', async () => {
    await expect(ensureAppRole(urlFor(dbName), 'x', 'bad"name')).rejects.toThrow(TypeError);
  });
});
