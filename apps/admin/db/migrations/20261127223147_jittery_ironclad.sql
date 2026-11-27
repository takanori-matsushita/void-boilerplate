CREATE TABLE "site" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_tenant_name_unique" UNIQUE("tenant_id","name")
);
--> statement-breakpoint
CREATE TABLE "tenant" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"organization_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "site" ADD CONSTRAINT "site_tenant_id_tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenant"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- RLS: tenant は自分の行だけ（id が tenant_id）、テナントに属するテーブルは tenant_id で絞る
--> statement-breakpoint
ALTER TABLE "tenant" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "tenant_tenant_isolation" ON "tenant" USING ("id" = current_setting('app.tenant_id')::uuid) WITH CHECK ("id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant" TO "app_user";
--> statement-breakpoint
ALTER TABLE "site" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "site_tenant_isolation" ON "site" USING ("tenant_id" = current_setting('app.tenant_id')::uuid) WITH CHECK ("tenant_id" = current_setting('app.tenant_id')::uuid);
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON "site" TO "app_user";
