// テーブル定義は `drizzle-orm/pg-core` で書く（Void に依存させない）。Void のプラグインが `drizzle-orm` の import を自前のコピーに
// 解決するため、`void db generate` はここの定義を拾い、`void/db` の `eq` や `void/drizzle-valibot` とも型が合う（実測済み）。
// テナントに属するテーブルは、マイグレーションの末尾に `tenantTableRlsSql('<table>')` を足す（architecture.md）。
export { createdAt, id, site, tenant } from './tenant';
