import { APP_ROLE, assertAppRoleUrl, ConfigError } from './config.mts';
import type { Cloudflare, HyperdriveConfig } from './cloudflare.mts';

export interface EnsureResult {
  config: HyperdriveConfig;
  action: 'created' | 'caching-disabled' | 'unchanged';
}

/**
 * `<Worker名>-hyperdrive` を、アプリ用ロール・クエリキャッシュ無効で用意する（べき等）。
 * Void が自動作成する Hyperdrive はキャッシュが有効で、トランザクション外の読み取りが最大約 1 分古くなる。
 * そのため事前に作り、Void に引き継がせる。
 */
export async function ensureHyperdrive(
  cf: Cloudflare,
  name: string,
  appDatabaseUrl: string,
  appRole: string = APP_ROLE,
): Promise<EnsureResult> {
  const origin = assertAppRoleUrl(appDatabaseUrl, appRole);
  const existing = await cf.findHyperdrive(name);
  if (!existing) {
    return { config: await cf.createHyperdrive(name, origin), action: 'created' };
  }
  if (existing.origin.user !== appRole) {
    throw new ConfigError(
      `既存の Hyperdrive ${name} の接続ロールが ${existing.origin.user ?? '(不明)'} です。アプリ用ロール（${appRole}）で作り直してください`,
    );
  }
  if (existing.caching?.disabled !== true) {
    return { config: await cf.disableHyperdriveCaching(existing.id), action: 'caching-disabled' };
  }
  return { config: existing, action: 'unchanged' };
}

/** デプロイ前・後の検証。作成はしない */
export async function checkHyperdrive(
  cf: Cloudflare,
  name: string,
  appRole: string = APP_ROLE,
): Promise<HyperdriveConfig> {
  const config = await cf.findHyperdrive(name);
  if (!config) {
    throw new ConfigError(
      `Hyperdrive ${name} がありません。先に provision（DB ロールと Hyperdrive の作成）を実行してください`,
    );
  }
  if (config.origin.user !== appRole) {
    throw new ConfigError(
      `Hyperdrive ${name} の接続ロールが ${config.origin.user ?? '(不明)'} です（${appRole} が必要）`,
    );
  }
  if (config.caching?.disabled !== true) {
    throw new ConfigError(`Hyperdrive ${name} のクエリキャッシュが有効です。provision を再実行して無効化してください`);
  }
  return config;
}
