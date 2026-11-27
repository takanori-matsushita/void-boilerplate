import { describe, expect, it } from 'vite-plus/test';
import {
  appUrlFromAdmin,
  assertAppRoleUrl,
  ConfigError,
  hyperdriveName,
  lockStorePath,
  parseOrigin,
  requireVars,
  workerName,
} from '../scripts/config.mts';

describe('命名規則', () => {
  it('Worker 名・Hyperdrive 名・lock の保管先が環境×アプリごとに分かれる', () => {
    expect(workerName('admin', 'stg')).toBe('club-admin-stg');
    expect(hyperdriveName('liff', 'prod')).toBe('club-liff-prod-hyperdrive');
    expect(lockStorePath('/r', 'dev', 'admin')).toBe('/r/deploy/dev/admin/void.lock.json');
    expect(lockStorePath('/r', 'dev', 'admin')).not.toBe(lockStorePath('/r', 'stg', 'admin'));
    // キュー名は <Worker名>-<キュー名> で 63 文字以内
    expect(`${workerName('admin', 'prod')}-broadcast-delivery`.length).toBeLessThanOrEqual(63);
  });
});

describe('接続文字列', () => {
  const app = 'postgresql://app_user:p%40ss@db.example.com:5432/club?sslmode=require';
  it('origin に分解する（パスワードはデコード）', () => {
    expect(parseOrigin(app)).toEqual({
      scheme: 'postgres',
      host: 'db.example.com',
      port: 5432,
      database: 'club',
      user: 'app_user',
      password: 'p@ss',
    });
  });
  it('Hyperdrive にはアプリ用ロールだけ許可し、管理用ロールを拒否する', () => {
    expect(assertAppRoleUrl(app).user).toBe('app_user');
    expect(() => assertAppRoleUrl('postgresql://neondb_owner:x@h/db')).toThrow(ConfigError);
  });
  it('拒否メッセージに接続文字列やパスワードを含めない', () => {
    try {
      assertAppRoleUrl('postgresql://neondb_owner:SECRETPW@h/db');
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('SECRETPW');
    }
  });
  it('postgres 以外・不正な URL を拒否する', () => {
    expect(() => parseOrigin('mysql://u:p@h/db')).toThrow(ConfigError);
    expect(() => parseOrigin('not a url')).toThrow(ConfigError);
  });
  it('管理用 URL からアプリ用 URL を作る（ホスト・DB は同じ、認証情報だけ差し替え）', () => {
    const url = appUrlFromAdmin(
      'postgresql://owner:ownerpw@host.example.com/club?sslmode=require',
      'app_user',
      'a/b c',
    );
    const origin = parseOrigin(url);
    expect(origin.user).toBe('app_user');
    expect(origin.password).toBe('a/b c');
    expect(origin.host).toBe('host.example.com');
    expect(origin.database).toBe('club');
  });
});

describe('requireVars', () => {
  it('不足している変数名だけを列挙する', () => {
    expect(() => requireVars({ A: '1' }, ['A', 'B', 'C'])).toThrow('B, C');
    expect(() => requireVars({ A: '1' }, ['A'])).not.toThrow();
  });
});
