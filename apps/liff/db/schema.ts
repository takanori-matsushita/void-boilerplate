// スキーマの実体は packages/db。マイグレーションは apps/admin が所有する（liff は常に --skip-migrations でデプロイ）。
export * from '@club/db/schema';
