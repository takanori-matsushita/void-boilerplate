import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appDir, ConfigError } from './config.mts';
import { runCommand, voidBin, type Runner } from './deploy.mts';

/**
 * ローカル DB へのマイグレーション（アプリ用ロールは DDL できないため、管理用ロールで流す）。
 * ローカルの `void db migrate` はシェルの DATABASE_URL を無視して `.env` を読むので、`.env` の DATABASE_URL を
 * 一時的に管理用（DATABASE_URL_ADMIN）に差し替え、終わったら（失敗しても）必ず元に戻す。
 */
export async function migrateLocal(root: string, runner: Runner = runCommand): Promise<void> {
  const cwd = appDir(root, 'admin'); // マイグレーションは apps/admin が所有する
  const envFile = path.join(cwd, '.env');
  if (!fs.existsSync(envFile))
    throw new ConfigError('apps/admin/.env がありません（.env.example をコピーしてください）');

  const original = fs.readFileSync(envFile, 'utf8');
  const lines = original.split('\n');
  const admin = lines.find((l) => l.startsWith('DATABASE_URL_ADMIN='))?.slice('DATABASE_URL_ADMIN='.length);
  if (!admin) throw new ConfigError('apps/admin/.env に DATABASE_URL_ADMIN がありません');

  const swapped = lines.map((l) => (l.startsWith('DATABASE_URL=') ? `DATABASE_URL=${admin}` : l)).join('\n');
  fs.writeFileSync(envFile, swapped);
  try {
    const result = await runner(voidBin(root, 'admin'), ['db', 'migrate'], { cwd, env: { ...process.env } });
    if (result.code !== 0) throw new ConfigError(`マイグレーションが失敗しました（終了コード ${result.code}）`);
  } finally {
    fs.writeFileSync(envFile, original);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  migrateLocal(root).catch((error: unknown) => {
    console.error(error instanceof Error ? `エラー: ${error.message}` : error);
    process.exitCode = 1;
  });
}
