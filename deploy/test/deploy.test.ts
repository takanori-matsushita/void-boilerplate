import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { lockStorePath, lockWorkPath } from '../scripts/config.mts';
import { deploy, migrate, putSecret, sanitizedEnv, type Runner } from '../scripts/deploy.mts';
import { fakeCloudflare, good } from './fake-cloudflare.ts';

const CF_ENV = { CLOUDFLARE_API_TOKEN: 't', CLOUDFLARE_ACCOUNT_ID: 'a' };
let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'club-deploy-'));
  fs.mkdirSync(path.join(root, 'apps/admin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'apps/liff'), { recursive: true });
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function recorder(code = 0) {
  const runs: { command: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv; stdin?: string }[] = [];
  const runner: Runner = async (command, args, options) => {
    runs.push({ command, args, ...options });
    // void deploy は lock を作る（新規デプロイ相当）
    if (args.includes('deploy'))
      fs.writeFileSync(path.join(options.cwd, 'void.lock.json'), JSON.stringify({ from: options.env.WORKER_NAME }));
    return { code };
  };
  return { runner, runs };
}
const okVerify = vi.fn(async () => ({ url: 'https://x', role: 'app_user' }));
const quiet = () => undefined;

describe('sanitizedEnv', () => {
  it('DB 資格情報を取り除き、それ以外は残す', () => {
    const env = sanitizedEnv({
      DATABASE_URL: 'a',
      DATABASE_URL_ADMIN: 'b',
      APP_DATABASE_URL: 'c',
      CLOUDFLARE_API_TOKEN: 't',
      PATH: '/bin',
    });
    expect(env).toEqual({ CLOUDFLARE_API_TOKEN: 't', PATH: '/bin' });
  });
});

describe('deploy', () => {
  it('Hyperdrive 確認 → void deploy --skip-migrations → lock 保管 → 検証 の順で実行する', async () => {
    const { runner, runs } = recorder();
    const { cf } = fakeCloudflare([good('club-admin-dev-hyperdrive')]);
    await deploy(
      root,
      'dev',
      'admin',
      { ...CF_ENV, DATABASE_URL: 'secret-db', DATABASE_URL_ADMIN: 'secret-admin', PATH: '/bin' },
      { runner, cloudflare: cf, verify: okVerify, log: quiet },
    );
    expect(runs.map((r) => r.args)).toEqual([
      ['connect', '--platform', 'cloudflare'], // 新規クローンでは .void/project.json が無いので、先に接続する
      ['deploy', '--platform', 'cloudflare', '--skip-migrations'], // プラットフォームを明示（Void プラットフォームに倒れない）
    ]);
    const run = runs[1]!;
    expect(run.command).toBe(path.join(root, 'apps/admin/node_modules/.bin/void'));
    expect(run.cwd).toBe(path.join(root, 'apps/admin'));
    expect(run.env.WORKER_NAME).toBe('club-admin-dev');
    for (const r of runs) {
      expect(r.env.DATABASE_URL).toBeUndefined(); // デプロイジョブに DB 資格情報を渡さない（connect を含む）
      expect(r.env.DATABASE_URL_ADMIN).toBeUndefined();
    }
    expect(JSON.parse(fs.readFileSync(lockStorePath(root, 'dev', 'admin'), 'utf8'))).toEqual({
      from: 'club-admin-dev',
    });
    expect(okVerify).toHaveBeenCalled();
  });

  it('Hyperdrive が未作成なら、void deploy を実行せずに中止する', async () => {
    const { runner, runs } = recorder();
    await expect(
      deploy(root, 'dev', 'admin', CF_ENV, { runner, cloudflare: fakeCloudflare().cf, verify: okVerify, log: quiet }),
    ).rejects.toThrow('provision');
    expect(runs).toHaveLength(0);
  });

  it('別環境の lock を使わない（stg のデプロイに dev の lock が混ざらない）', async () => {
    fs.mkdirSync(path.dirname(lockStorePath(root, 'dev', 'admin')), { recursive: true });
    fs.writeFileSync(lockStorePath(root, 'dev', 'admin'), '{"env":"dev"}');
    fs.writeFileSync(lockWorkPath(root, 'admin'), '{"env":"dev","leftover":true}'); // 作業ディレクトリに残った lock
    const seen: string[] = [];
    const runner: Runner = async (_c, _a, o) => {
      seen.push(
        fs.existsSync(path.join(o.cwd, 'void.lock.json'))
          ? fs.readFileSync(path.join(o.cwd, 'void.lock.json'), 'utf8')
          : '(なし)',
      );
      return { code: 0 };
    };
    const { cf } = fakeCloudflare([good('club-admin-stg-hyperdrive')]);
    await deploy(root, 'stg', 'admin', CF_ENV, { runner, cloudflare: cf, verify: okVerify, log: quiet });
    expect(seen).toEqual(['(なし)', '(なし)']); // connect と deploy のどちらの時点でも、dev の lock は無い
  });

  it('同じ環境の lock は配置して使う', async () => {
    fs.mkdirSync(path.dirname(lockStorePath(root, 'prod', 'liff')), { recursive: true });
    fs.writeFileSync(lockStorePath(root, 'prod', 'liff'), '{"env":"prod"}');
    let seen = '';
    const runner: Runner = async (_c, _a, o) => (
      (seen = fs.readFileSync(path.join(o.cwd, 'void.lock.json'), 'utf8')),
      { code: 0 }
    );
    const { cf } = fakeCloudflare([good('club-liff-prod-hyperdrive')]);
    await deploy(root, 'prod', 'liff', CF_ENV, { runner, cloudflare: cf, verify: okVerify, log: quiet });
    expect(seen).toBe('{"env":"prod"}');
  });

  it('void deploy が失敗したら lock を保管せず、検証もしない', async () => {
    okVerify.mockClear();
    const { runner } = recorder(1);
    const { cf } = fakeCloudflare([good('club-admin-dev-hyperdrive')]);
    await expect(
      deploy(root, 'dev', 'admin', CF_ENV, { runner, cloudflare: cf, verify: okVerify, log: quiet }),
    ).rejects.toThrow('失敗');
    expect(fs.existsSync(lockStorePath(root, 'dev', 'admin'))).toBe(false);
    expect(okVerify).not.toHaveBeenCalled();
  });

  it('Cloudflare の認証情報がなければ中止する', async () => {
    await expect(deploy(root, 'dev', 'admin', {}, { runner: recorder().runner, log: quiet })).rejects.toThrow(
      'CLOUDFLARE_API_TOKEN',
    );
  });
});

describe('migrate', () => {
  it('管理用 URL を DATABASE_URL として void db migrate --remote を実行する（apps/admin）', async () => {
    const { runner, runs } = recorder();
    await migrate(root, 'stg', { ...CF_ENV, DATABASE_URL_ADMIN: 'postgresql://admin' }, { runner, log: quiet });
    expect(runs.map((r) => r.args)).toEqual([
      ['connect', '--platform', 'cloudflare'],
      ['db', 'migrate', '--remote'],
    ]);
    expect(runs[1]!.cwd).toBe(path.join(root, 'apps/admin'));
    expect(runs[1]!.env.DATABASE_URL).toBe('postgresql://admin');
    expect(runs[1]!.env.WORKER_NAME).toBe('club-admin-stg');
  });
  it('管理用 URL がなければ中止する', async () => {
    await expect(migrate(root, 'dev', CF_ENV, { runner: recorder().runner, log: quiet })).rejects.toThrow(
      'DATABASE_URL_ADMIN',
    );
  });
});

describe('putSecret', () => {
  it('値は標準入力で渡し、引数に含めない', async () => {
    const { runner, runs } = recorder();
    await putSecret(root, 'dev', 'admin', 'DATABASE_URL_ADMIN', 'postgresql://admin:pw@h/db', CF_ENV, {
      runner,
      log: quiet,
    });
    expect(runs.map((r) => r.args)).toEqual([
      ['connect', '--platform', 'cloudflare'],
      ['secret', 'put', 'DATABASE_URL_ADMIN'],
    ]);
    expect(runs[1]!.stdin).toBe('postgresql://admin:pw@h/db');
    expect(runs[1]!.args.join(' ')).not.toContain('pw');
    expect(runs[0]!.stdin).toBeUndefined(); // connect に値を渡さない
  });
});
