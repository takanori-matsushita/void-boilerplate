import { defineHandler } from 'void';
import { db, sql } from 'void/db';

// デプロイ後の検証用。接続ロールが一般ロール（app_user）であることを確認する。テナントトランザクションの対象外。
export const GET = defineHandler(async () => {
  const result = await db.execute(sql`select current_user as role`);
  const row = result.rows[0] as { role: string } | undefined;
  return { ok: true, app: 'admin', role: row?.role ?? null };
});
