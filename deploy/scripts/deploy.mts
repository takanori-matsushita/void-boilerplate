import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  appDir,
  ConfigError,
  hyperdriveName,
  lockStorePath,
  lockWorkPath,
  requireVars,
  workerName,
  type App,
  type Environment,
} from './config.mts';
import { Cloudflare } from './cloudflare.mts';
import { checkHyperdrive } from './hyperdrive.mts';
import { verifyDeployment } from './verify.mts';

export interface RunResult {
  code: number;
}
export type Runner = (
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; stdin?: string },
) => Promise<RunResult>;

export const runCommand: Runner = (command, args, { cwd, env, stdin }) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: [stdin === undefined ? 'ignore' : 'pipe', 'inherit', 'inherit'],
    });
    if (stdin !== undefined) child.stdin?.end(stdin);
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1 }));
  });

/** DB 資格情報は子プロセスに渡さない（デプロイジョブは DB 資格情報を持たない設計。マイグレーションは別ジョブ） */
export function sanitizedEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith('DATABASE_URL') || key.startsWith('APP_DATABASE_URL')) delete env[key];
  }
  return env;
}

/** アプリ内の void バイナリ（pnpm が PATH になくても動く。バージョンはアプリの固定版） */
export function voidBin(root: string, app: App): string {
  return path.join(appDir(root, app), 'node_modules', '.bin', 'void');
}

/**
 * Cloudflare への直接デプロイとして接続する（`.void/project.json` を作る。べき等・非対話）。
 * 新規クローン（CI）では `.void/` が無いため、これが無いと `void db migrate --remote`（PostgreSQL）は拒否され、
 * `void deploy` は Void プラットフォーム側に倒れ、`void secret put` は「Deployment is disabled」で失敗する。
 */
export async function connectCloudflare(
  root: string,
  app: App,
  env: NodeJS.ProcessEnv,
  runner: Runner,
  log: (message: string) => void,
): Promise<void> {
  log('  void connect --platform cloudflare');
  const result = await runner(voidBin(root, app), ['connect', '--platform', 'cloudflare'], {
    cwd: appDir(root, app),
    env,
  });
  if (result.code !== 0) throw new ConfigError(`void connect が失敗しました（終了コード ${result.code}）`);
}

export function placeLock(root: string, env: Environment, app: App): boolean {
  const store = lockStorePath(root, env, app);
  const work = lockWorkPath(root, app);
  fs.rmSync(work, { force: true }); // 別環境の lock が残っていないようにする
  if (!fs.existsSync(store)) return false;
  fs.copyFileSync(store, work);
  return true;
}

export function saveLock(root: string, env: Environment, app: App): boolean {
  const work = lockWorkPath(root, app);
  if (!fs.existsSync(work)) return false;
  const store = lockStorePath(root, env, app);
  fs.mkdirSync(path.dirname(store), { recursive: true });
  fs.copyFileSync(work, store);
  return true;
}

export interface DeployDeps {
  runner?: Runner;
  cloudflare?: Cloudflare;
  verify?: typeof verifyDeployment;
  log?: (message: string) => void;
}

export async function deploy(
  root: string,
  env: Environment,
  app: App,
  source: NodeJS.ProcessEnv,
  deps: DeployDeps = {},
): Promise<void> {
  const { runner = runCommand, verify = verifyDeployment, log = console.log } = deps;
  requireVars(source, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
  const cf = deps.cloudflare ?? new Cloudflare(source.CLOUDFLARE_API_TOKEN!, source.CLOUDFLARE_ACCOUNT_ID!);

  log(`[1/5] Hyperdrive を確認: ${hyperdriveName(app, env)}`);
  await checkHyperdrive(cf, hyperdriveName(app, env));

  log(`[2/5] ${env}/${app} の lock を配置`);
  const hadLock = placeLock(root, env, app);
  log(hadLock ? '  既存の lock を使用' : '  lock なし（Void が Hyperdrive を名前で引き継ぎ、新しい lock を作る）');

  log(`[3/5] void deploy --platform cloudflare --skip-migrations（${workerName(app, env)}）`);
  const childEnv = { ...sanitizedEnv(source), WORKER_NAME: workerName(app, env), CI: source.CI ?? '1' };
  await connectCloudflare(root, app, childEnv, runner, log);
  const result = await runner(voidBin(root, app), ['deploy', '--platform', 'cloudflare', '--skip-migrations'], {
    cwd: appDir(root, app),
    env: childEnv,
  });
  if (result.code !== 0) throw new ConfigError(`void deploy が失敗しました（終了コード ${result.code}）`);

  log('[4/5] lock を保管');
  saveLock(root, env, app);

  log('[5/5] デプロイ後の検証');
  const verified = await verify(cf, env, app);
  log(`  OK: ${verified.url}（接続ロール: ${verified.role}）`);
}

/** マイグレーション（管理用ロール）。デプロイとは別ジョブで実行する */
export async function migrate(
  root: string,
  env: Environment,
  source: NodeJS.ProcessEnv,
  deps: Pick<DeployDeps, 'runner' | 'log'> = {},
): Promise<void> {
  const { runner = runCommand, log = console.log } = deps;
  requireVars(source, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'DATABASE_URL_ADMIN']);
  const app: App = 'admin'; // マイグレーションは apps/admin が所有する
  placeLock(root, env, app);
  const childEnv = {
    ...source,
    DATABASE_URL: source.DATABASE_URL_ADMIN,
    WORKER_NAME: workerName(app, env),
    CI: source.CI ?? '1',
  };
  await connectCloudflare(root, app, childEnv, runner, log);
  log(`void db migrate --remote（${env}、管理用ロール）`);
  const result = await runner(voidBin(root, app), ['db', 'migrate', '--remote'], {
    cwd: appDir(root, app),
    env: childEnv,
  });
  if (result.code !== 0) throw new ConfigError(`マイグレーションが失敗しました（終了コード ${result.code}）`);
}

/** Worker のシークレットを標準入力から投入する（値はログに出さない） */
export async function putSecret(
  root: string,
  env: Environment,
  app: App,
  name: string,
  value: string,
  source: NodeJS.ProcessEnv,
  deps: Pick<DeployDeps, 'runner' | 'log'> = {},
): Promise<void> {
  const { runner = runCommand, log = console.log } = deps;
  requireVars(source, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
  placeLock(root, env, app);
  const childEnv = { ...sanitizedEnv(source), WORKER_NAME: workerName(app, env), CI: source.CI ?? '1' };
  await connectCloudflare(root, app, childEnv, runner, log);
  log(`シークレット ${name} を ${workerName(app, env)} に設定`);
  const result = await runner(voidBin(root, app), ['secret', 'put', name], {
    cwd: appDir(root, app),
    env: childEnv,
    stdin: value,
  });
  if (result.code !== 0) throw new ConfigError(`シークレットの設定に失敗しました（終了コード ${result.code}）`);
}
