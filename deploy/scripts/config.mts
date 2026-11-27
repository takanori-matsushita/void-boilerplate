import path from 'node:path';

export const ENVIRONMENTS = ['dev', 'stg', 'prod'] as const;
export type Environment = (typeof ENVIRONMENTS)[number];
export const APPS = ['admin', 'liff'] as const;
export type App = (typeof APPS)[number];

/** アプリ用の DB ロール（RLS を強制される一般ロール）。Hyperdrive は必ずこのロールで作る */
export const APP_ROLE = 'app_user';

export function isEnvironment(value: string): value is Environment {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}
export function isApp(value: string): value is App {
  return (APPS as readonly string[]).includes(value);
}

/** Worker 名。キューは `<Worker名>-<キュー名>` になるので 63 文字以内に収める */
export function workerName(app: App, env: Environment): string {
  return `club-${app}-${env}`;
}

/** Void は `<Worker名>-hyperdrive` という名前の既存の Hyperdrive を引き継ぐ */
export function hyperdriveName(app: App, env: Environment): string {
  return `${workerName(app, env)}-hyperdrive`;
}

export function appDir(root: string, app: App): string {
  return path.join(root, 'apps', app);
}

/** 環境 × アプリごとの lock の保管場所。別環境の lock を流用すると別環境の Hyperdrive（= DB）に接続してしまう */
export function lockStorePath(root: string, env: Environment, app: App): string {
  return path.join(root, 'deploy', env, app, 'void.lock.json');
}

export function lockWorkPath(root: string, app: App): string {
  return path.join(appDir(root, app), 'void.lock.json');
}

export class ConfigError extends Error {}

export function requireVars(source: Record<string, string | undefined>, names: readonly string[]): void {
  const missing = names.filter((n) => !source[n]);
  if (missing.length > 0) {
    throw new ConfigError(`必須の環境変数が設定されていません: ${missing.join(', ')}`);
  }
}

export interface DbOrigin {
  scheme: 'postgres';
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

/** 接続文字列を Hyperdrive の origin に変換する。接続文字列はログに出さない */
export function parseOrigin(connectionString: string): DbOrigin {
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new ConfigError('接続文字列の形式が不正です');
  }
  if (url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') {
    throw new ConfigError('接続文字列は postgres:// または postgresql:// である必要があります');
  }
  return {
    scheme: 'postgres',
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  };
}

/** Hyperdrive に渡す URL がアプリ用ロールであることを保証する（管理用ロールだと本番アプリが RLS をバイパスする） */
export function assertAppRoleUrl(connectionString: string, appRole: string = APP_ROLE): DbOrigin {
  const origin = parseOrigin(connectionString);
  if (origin.user !== appRole) {
    throw new ConfigError(
      `Hyperdrive 用の接続はアプリ用ロール（${appRole}）である必要があります（指定されたロール: ${origin.user}）`,
    );
  }
  return origin;
}

/** 管理用 URL のホスト・DB を使い、アプリ用ロールの認証情報に差し替えた接続文字列を作る */
export function appUrlFromAdmin(adminUrl: string, appRole: string, appPassword: string): string {
  const url = new URL(adminUrl);
  url.username = encodeURIComponent(appRole);
  url.password = encodeURIComponent(appPassword);
  return url.toString();
}
