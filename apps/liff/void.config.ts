import { defineConfig } from 'void/config';

// 環境（dev / stg / prod）ごとの Worker 名は、デプロイスクリプトが WORKER_NAME で渡す。
// Void に名前付き環境は無いため、名前・lock・Hyperdrive・DB を組み合わせて分離する（CLAUDE.md「デプロイと環境分離」）。
export default defineConfig({
  routing: { typedRoutes: true },
  database: 'pg',
  worker: { compatibility_date: '2026-02-24' },
  cloudflare: { name: process.env.WORKER_NAME ?? 'club-liff-dev' },
});
