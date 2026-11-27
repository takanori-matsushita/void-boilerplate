import { sql } from 'drizzle-orm';
import { pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

/** 主キー（UUID v7）。採番は DB（`uuidv7()`。PostgreSQL 18 の標準関数）。 */
export const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);

export const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

/** テナント（クラブ）。`id` がそのまま `tenant_id`（RLS の `app.tenant_id`）になる */
export const tenant = pgTable('tenant', {
  id: id(),
  name: text('name').notNull(),
  /** Better Auth の組織 ID（ランダム文字列）との対応。認証（フェーズ 3）で設定する */
  organizationId: text('organization_id').unique(),
  createdAt: createdAt(),
});

/** 拠点（会場・教室）。テナントの配下の 2 階層目 */
export const site = pgTable(
  'site',
  {
    id: id(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenant.id),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('site_tenant_name_unique').on(t.tenantId, t.name)],
);
