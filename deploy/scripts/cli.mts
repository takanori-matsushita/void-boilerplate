import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPS,
  ConfigError,
  hyperdriveName,
  isApp,
  isEnvironment,
  requireVars,
  appUrlFromAdmin,
  type App,
  type Environment,
} from './config.mts';
import { Cloudflare } from './cloudflare.mts';
import { ensureHyperdrive } from './hyperdrive.mts';
import { ensureAppRole } from './provision-db.mts';
import { deploy, migrate, putSecret } from './deploy.mts';
import { verifyDeployment } from './verify.mts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const USAGE = `使い方: node deploy/scripts/cli.mts <command> <env> [app]

  provision <env>         DB のアプリ用ロールと、全アプリの Hyperdrive（キャッシュ無効）を用意する
                          必須: DATABASE_URL_ADMIN, APP_DB_PASSWORD, CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID
  secrets <env> <app>     Worker のシークレット DATABASE_URL_ADMIN を設定する（Queue consumer / Cron 用）
  migrate <env>           マイグレーションを管理用ロールで適用する（必須: DATABASE_URL_ADMIN, CLOUDFLARE_*）
  deploy <env> <app>      デプロイ（DB 資格情報は不要。Hyperdrive の事前作成が前提）
  verify <env> <app>      デプロイ後の検証だけを実行する

  env: dev | stg | prod    app: ${APPS.join(' | ')}`;

function parseTarget(
  env: string | undefined,
  app: string | undefined,
  needApp: boolean,
): { env: Environment; app?: App } {
  if (!env || !isEnvironment(env))
    throw new ConfigError(`環境は dev | stg | prod のいずれかを指定してください\n${USAGE}`);
  if (!needApp) return { env };
  if (!app || !isApp(app)) throw new ConfigError(`アプリは ${APPS.join(' | ')} のいずれかを指定してください\n${USAGE}`);
  return { env, app };
}

async function main(argv: string[]): Promise<void> {
  const [command, envArg, appArg] = argv;
  const processEnv = process.env;
  switch (command) {
    case 'provision': {
      const { env } = parseTarget(envArg, undefined, false);
      requireVars(processEnv, [
        'DATABASE_URL_ADMIN',
        'APP_DB_PASSWORD',
        'CLOUDFLARE_API_TOKEN',
        'CLOUDFLARE_ACCOUNT_ID',
      ]);
      const adminUrl = processEnv.DATABASE_URL_ADMIN!;
      const password = processEnv.APP_DB_PASSWORD!;
      await ensureAppRole(adminUrl, password);
      console.log(`DB ロール app_user を用意しました（${env}）`);
      const appUrl = appUrlFromAdmin(adminUrl, 'app_user', password);
      const cf = new Cloudflare(processEnv.CLOUDFLARE_API_TOKEN!, processEnv.CLOUDFLARE_ACCOUNT_ID!);
      for (const app of APPS) {
        const result = await ensureHyperdrive(cf, hyperdriveName(app, env), appUrl);
        console.log(`Hyperdrive ${hyperdriveName(app, env)}: ${result.action}`);
      }
      return;
    }
    case 'secrets': {
      const { env, app } = parseTarget(envArg, appArg, true);
      requireVars(processEnv, ['DATABASE_URL_ADMIN']);
      await putSecret(root, env, app!, 'DATABASE_URL_ADMIN', processEnv.DATABASE_URL_ADMIN!, processEnv);
      return;
    }
    case 'migrate': {
      const { env } = parseTarget(envArg, undefined, false);
      await migrate(root, env, processEnv);
      return;
    }
    case 'deploy': {
      const { env, app } = parseTarget(envArg, appArg, true);
      await deploy(root, env, app!, processEnv);
      return;
    }
    case 'verify': {
      const { env, app } = parseTarget(envArg, appArg, true);
      requireVars(processEnv, ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']);
      const cf = new Cloudflare(processEnv.CLOUDFLARE_API_TOKEN!, processEnv.CLOUDFLARE_ACCOUNT_ID!);
      const result = await verifyDeployment(cf, env, app!);
      console.log(`OK: ${result.url}（接続ロール: ${result.role}）`);
      return;
    }
    default:
      console.log(USAGE);
      if (command) process.exitCode = 1;
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? `エラー: ${error.message}` : error);
  process.exitCode = 1;
});
