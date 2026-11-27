-- アプリ用ロール（RLS を強制される一般ロール）と管理用ロール（マイグレーション・Cron・Queue consumer 用）
-- ローカル / CI 用の固定パスワード。本番・stg・dev のクラウド環境では deploy/scripts/provision-db.mts が別途作成する。
CREATE ROLE app_user LOGIN PASSWORD 'app_user' NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
CREATE ROLE app_admin LOGIN PASSWORD 'app_admin' BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
GRANT CONNECT ON DATABASE club TO app_user, app_admin;
ALTER SCHEMA public OWNER TO app_admin;
GRANT USAGE ON SCHEMA public TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO app_user;
ALTER DEFAULT PRIVILEGES FOR ROLE app_admin IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO app_user;
