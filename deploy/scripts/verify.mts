import { APP_ROLE, ConfigError, hyperdriveName, workerName, type App, type Environment } from './config.mts';
import { checkHyperdrive } from './hyperdrive.mts';
import type { Cloudflare, FetchLike } from './cloudflare.mts';

export interface VerifyOptions {
  fetchImpl?: FetchLike;
  retries?: number;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * デプロイ後の検証:
 * 1. Hyperdrive がアプリ用ロール・キャッシュ無効のままか
 * 2. /api/health の接続ロールが app_user か（管理用ロールで動いていないか）
 * デプロイ直後の数十秒は 404（error code: 1042）が一時的に返るため、リトライする。
 */
export async function verifyDeployment(
  cf: Cloudflare,
  env: Environment,
  app: App,
  options: VerifyOptions = {},
): Promise<{ url: string; role: string }> {
  const {
    fetchImpl = fetch as FetchLike,
    retries = 12,
    delayMs = 5000,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  } = options;
  await checkHyperdrive(cf, hyperdriveName(app, env));

  const url = `https://${workerName(app, env)}.${await cf.workersSubdomain()}.workers.dev/api/health`;
  let lastStatus = 0;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const response = await fetchImpl(url).catch(() => undefined);
    lastStatus = response?.status ?? 0;
    if (response?.ok) {
      const body = (await response.json()) as { ok?: boolean; role?: string | null };
      if (body.role !== APP_ROLE) {
        throw new ConfigError(
          `接続ロールが ${APP_ROLE} ではありません（${String(body.role)}）。管理用ロールの Hyperdrive になっていないか確認してください`,
        );
      }
      return { url, role: body.role };
    }
    if (attempt < retries) await sleep(delayMs);
  }
  throw new ConfigError(`ヘルスチェックに失敗しました（${url}、最後のステータス: ${lastStatus}）`);
}
