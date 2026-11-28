-- 組織 ID（Better Auth のランダム文字列）から tenant_id を引く。テナントミドルウェアが、テナントを設定する前に使う。
-- tenant テーブルは RLS で守られているため、テナントを設定する前は読めない（読むには、テナントを設定する必要がある）。
-- この関数は SECURITY DEFINER（所有者の app_admin = RLS をバイパス）で、返すのは tenant_id だけ。組織 ID を知らなければ引けない。
-- `void db reset` は関数を消さないので、CREATE OR REPLACE にする（リセット後の再適用で失敗しない）。
-- search_path を固定し（関数・テーブルの差し替えによる乗っ取りを防ぐ）、PUBLIC の実行権限を外して、app_user だけに与える。
CREATE OR REPLACE FUNCTION "tenant_id_for_organization"(org_id text) RETURNS uuid
	LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
	AS $$ SELECT "id" FROM "tenant" WHERE "organization_id" = org_id $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "tenant_id_for_organization"(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "tenant_id_for_organization"(text) TO "app_user";
