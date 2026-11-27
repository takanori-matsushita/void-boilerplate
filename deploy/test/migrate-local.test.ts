import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vite-plus/test';
import type { Runner } from '../scripts/deploy.mts';
import { migrateLocal } from '../scripts/migrate-local.mts';

const ENV = 'DATABASE_URL=postgresql://app_user:a@h/db\nDATABASE_URL_ADMIN=postgresql://app_admin:b@h/db\nOTHER=1\n';
let root: string;
let envFile: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'club-migrate-'));
  fs.mkdirSync(path.join(root, 'apps/admin'), { recursive: true });
  envFile = path.join(root, 'apps/admin/.env');
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('migrateLocal', () => {
  it('実行中だけ DATABASE_URL を管理用に差し替え、終わったら元に戻す', async () => {
    fs.writeFileSync(envFile, ENV);
    let during = '';
    const runner: Runner = async (_command, args) => {
      during = fs.readFileSync(envFile, 'utf8');
      expect(args).toEqual(['db', 'migrate']);
      return { code: 0 };
    };

    await migrateLocal(root, runner);

    expect(during).toContain('DATABASE_URL=postgresql://app_admin:b@h/db\n');
    expect(during).toContain('OTHER=1');
    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV);
  });

  it('失敗しても、.env は必ず元に戻る', async () => {
    fs.writeFileSync(envFile, ENV);

    await expect(migrateLocal(root, async () => ({ code: 1 }))).rejects.toThrow('失敗');

    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV);
  });

  it('runner が例外を投げても、.env は必ず元に戻る', async () => {
    fs.writeFileSync(envFile, ENV);

    await expect(
      migrateLocal(root, async () => {
        throw new Error('spawn failed');
      }),
    ).rejects.toThrow('spawn failed');

    expect(fs.readFileSync(envFile, 'utf8')).toBe(ENV);
  });

  it('.env や DATABASE_URL_ADMIN が無ければ、何も実行せずに止まる', async () => {
    await expect(migrateLocal(root, async () => ({ code: 0 }))).rejects.toThrow('.env がありません');
    fs.writeFileSync(envFile, 'DATABASE_URL=postgresql://app_user:a@h/db\n');
    await expect(migrateLocal(root, async () => ({ code: 0 }))).rejects.toThrow('DATABASE_URL_ADMIN');
    expect(fs.readFileSync(envFile, 'utf8')).toBe('DATABASE_URL=postgresql://app_user:a@h/db\n');
  });
});
