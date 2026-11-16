CREATE TABLE "calculated_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"canonical_name" text NOT NULL,
	"label" text NOT NULL,
	"expression" text NOT NULL,
	"formula_dialect" text,
	"role" text NOT NULL,
	"semantic_type" text NOT NULL,
	"default_aggregation" text,
	"description" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"uploaded_by" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dashboard_grants" (
	"dashboard_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"granted_at" text NOT NULL,
	CONSTRAINT "dashboard_grants_dashboard_id_clerk_user_id_pk" PRIMARY KEY("dashboard_id","clerk_user_id")
);
--> statement-breakpoint
CREATE TABLE "dashboards" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"connector_type" text DEFAULT 'duckdb-file' NOT NULL,
	"location" jsonb NOT NULL,
	"cache_policy" jsonb,
	"version" text NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasource_authorizations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text NOT NULL,
	"created_by" text NOT NULL,
	"account" text,
	"status" text NOT NULL,
	"encrypted_config" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasource_connections" (
	"datasource_id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"encrypted_config" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "datasource_uploads" (
	"key" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"clerk_user_id" text NOT NULL,
	"status" text NOT NULL,
	"claim_id" text,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fields" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"column_name" text NOT NULL,
	"canonical_name" text NOT NULL,
	"label" text NOT NULL,
	"role" text NOT NULL,
	"semantic_type" text NOT NULL,
	"default_aggregation" text,
	"description" text,
	"hidden" boolean DEFAULT false NOT NULL,
	"cast_to" text,
	"sample_values" jsonb,
	"cardinality" integer
);
--> statement-breakpoint
CREATE TABLE "ingestion_tokens" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"source_key" text NOT NULL,
	"destination_key" text NOT NULL,
	"expires_at" text NOT NULL,
	"used_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "library_metrics" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"name" text NOT NULL,
	"canonical_name" text NOT NULL,
	"expression" text NOT NULL,
	"formula_dialect" text,
	"semantic_type" text NOT NULL,
	"description" text,
	"updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "query_read_budgets" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"scanned_bytes" integer DEFAULT 0 NOT NULL,
	"maximum_bytes" integer NOT NULL,
	"expires_at" text NOT NULL,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "share_links" (
	"token" text PRIMARY KEY NOT NULL,
	"dashboard_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" text NOT NULL,
	"revoked_at" text
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"clerk_organization_id" text NOT NULL,
	"name" text NOT NULL,
	"r2_prefix" text NOT NULL,
	"preview_seeded_at" text,
	"preview_seed_claimed_at" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calculated_fields" ADD CONSTRAINT "calculated_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calculated_fields" ADD CONSTRAINT "calculated_fields_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_assets" ADD CONSTRAINT "dashboard_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboard_grants" ADD CONSTRAINT "dashboard_grants_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dashboards" ADD CONSTRAINT "dashboards_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasource_authorizations" ADD CONSTRAINT "datasource_authorizations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasource_connections" ADD CONSTRAINT "datasource_connections_datasource_id_data_sources_id_fk" FOREIGN KEY ("datasource_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasource_connections" ADD CONSTRAINT "datasource_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "datasource_uploads" ADD CONSTRAINT "datasource_uploads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fields" ADD CONSTRAINT "fields_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_tokens" ADD CONSTRAINT "ingestion_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_metrics" ADD CONSTRAINT "library_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_read_budgets" ADD CONSTRAINT "query_read_budgets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_dashboard_id_dashboards_id_fk" FOREIGN KEY ("dashboard_id") REFERENCES "public"."dashboards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "calculated_fields_data_source_id_idx" ON "calculated_fields" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calculated_fields_data_source_canonical_unique" ON "calculated_fields" USING btree ("data_source_id","canonical_name");--> statement-breakpoint
CREATE INDEX "dashboard_assets_workspace_id_idx" ON "dashboard_assets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "dashboard_grants_user_id_idx" ON "dashboard_grants" USING btree ("clerk_user_id");--> statement-breakpoint
CREATE INDEX "dashboards_workspace_id_idx" ON "dashboards" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "data_sources_workspace_id_idx" ON "data_sources" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_workspace_name_unique" ON "data_sources" USING btree ("workspace_id","name");--> statement-breakpoint
CREATE INDEX "datasource_authorizations_workspace_idx" ON "datasource_authorizations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "datasource_uploads_workspace_id_idx" ON "datasource_uploads" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "fields_data_source_id_idx" ON "fields" USING btree ("data_source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_data_source_column_unique" ON "fields" USING btree ("data_source_id","column_name");--> statement-breakpoint
CREATE UNIQUE INDEX "fields_data_source_canonical_unique" ON "fields" USING btree ("data_source_id","canonical_name");--> statement-breakpoint
CREATE INDEX "ingestion_tokens_workspace_id_idx" ON "ingestion_tokens" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_metrics_workspace_canonical_unique" ON "library_metrics" USING btree ("workspace_id","canonical_name");--> statement-breakpoint
CREATE INDEX "query_read_budgets_workspace_id_idx" ON "query_read_budgets" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "share_links_dashboard_id_idx" ON "share_links" USING btree ("dashboard_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_clerk_organization_id_unique" ON "workspaces" USING btree ("clerk_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_r2_prefix_unique" ON "workspaces" USING btree ("r2_prefix");