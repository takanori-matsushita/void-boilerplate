import { defineEnv, url } from 'void/env';

// DATABASE_URL は宣言しない（宣言すると Hyperdrive を迂回して直接接続になる）。
// 管理用の接続（RLS をバイパス）は Queue consumer / Cron でだけ使う。
export default defineEnv({
  DATABASE_URL_ADMIN: url().optional(),
});
