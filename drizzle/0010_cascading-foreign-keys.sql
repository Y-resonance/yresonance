-- D1 keeps foreign keys enabled. Rebuild parents before adding child cascades
-- so dropping the old parent tables cannot delete existing child rows.
CREATE TABLE `__new_data_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`connector_type` text DEFAULT 'duckdb-file' NOT NULL,
	`location` text NOT NULL,
	`version` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_data_sources`("id", "workspace_id", "name", "connector_type", "location", "version", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "connector_type", "location", "version", "created_at", "updated_at" FROM `data_sources`;--> statement-breakpoint
DROP TABLE `data_sources`;--> statement-breakpoint
ALTER TABLE `__new_data_sources` RENAME TO `data_sources`;--> statement-breakpoint
CREATE INDEX `data_sources_workspace_id_idx` ON `data_sources` (`workspace_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `data_sources_workspace_name_unique` ON `data_sources` (`workspace_id`,`name`);--> statement-breakpoint
CREATE TABLE `__new_dashboards` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`document` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_dashboards`("id", "workspace_id", "name", "document", "created_by", "created_at", "updated_at") SELECT "id", "workspace_id", "name", "document", "created_by", "created_at", "updated_at" FROM `dashboards`;--> statement-breakpoint
DROP TABLE `dashboards`;--> statement-breakpoint
ALTER TABLE `__new_dashboards` RENAME TO `dashboards`;--> statement-breakpoint
CREATE INDEX `dashboards_workspace_id_idx` ON `dashboards` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_calculated_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`data_source_id` text NOT NULL,
	`canonical_name` text NOT NULL,
	`label` text NOT NULL,
	`expression` text NOT NULL,
	`role` text NOT NULL,
	`semantic_type` text NOT NULL,
	`default_aggregation` text,
	`description` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_calculated_fields`("id", "workspace_id", "data_source_id", "canonical_name", "label", "expression", "role", "semantic_type", "default_aggregation", "description", "updated_at") SELECT "id", "workspace_id", "data_source_id", "canonical_name", "label", "expression", "role", "semantic_type", "default_aggregation", "description", "updated_at" FROM `calculated_fields`;--> statement-breakpoint
DROP TABLE `calculated_fields`;--> statement-breakpoint
ALTER TABLE `__new_calculated_fields` RENAME TO `calculated_fields`;--> statement-breakpoint
CREATE INDEX `calculated_fields_data_source_id_idx` ON `calculated_fields` (`data_source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calculated_fields_data_source_canonical_unique` ON `calculated_fields` (`data_source_id`,`canonical_name`);--> statement-breakpoint
CREATE TABLE `__new_dashboard_grants` (
	`dashboard_id` text NOT NULL,
	`clerk_user_id` text NOT NULL,
	`role` text NOT NULL,
	`granted_by` text NOT NULL,
	`granted_at` text NOT NULL,
	PRIMARY KEY(`dashboard_id`, `clerk_user_id`),
	FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_dashboard_grants`("dashboard_id", "clerk_user_id", "role", "granted_by", "granted_at") SELECT "dashboard_id", "clerk_user_id", "role", "granted_by", "granted_at" FROM `dashboard_grants`;--> statement-breakpoint
DROP TABLE `dashboard_grants`;--> statement-breakpoint
ALTER TABLE `__new_dashboard_grants` RENAME TO `dashboard_grants`;--> statement-breakpoint
CREATE INDEX `dashboard_grants_user_id_idx` ON `dashboard_grants` (`clerk_user_id`);--> statement-breakpoint
CREATE TABLE `__new_datasource_uploads` (
	`key` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`clerk_user_id` text NOT NULL,
	`status` text NOT NULL,
	`claim_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_datasource_uploads`("key", "workspace_id", "clerk_user_id", "status", "claim_id", "created_at", "updated_at") SELECT "key", "workspace_id", "clerk_user_id", "status", "claim_id", "created_at", "updated_at" FROM `datasource_uploads`;--> statement-breakpoint
DROP TABLE `datasource_uploads`;--> statement-breakpoint
ALTER TABLE `__new_datasource_uploads` RENAME TO `datasource_uploads`;--> statement-breakpoint
CREATE INDEX `datasource_uploads_workspace_id_idx` ON `datasource_uploads` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_fields` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`data_source_id` text NOT NULL,
	`column_name` text NOT NULL,
	`canonical_name` text NOT NULL,
	`label` text NOT NULL,
	`role` text NOT NULL,
	`semantic_type` text NOT NULL,
	`default_aggregation` text,
	`description` text,
	`hidden` integer DEFAULT false NOT NULL,
	`cast_to` text,
	`sample_values` text,
	`cardinality` integer,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`data_source_id`) REFERENCES `data_sources`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_fields`("id", "workspace_id", "data_source_id", "column_name", "canonical_name", "label", "role", "semantic_type", "default_aggregation", "description", "hidden", "cast_to", "sample_values", "cardinality") SELECT "id", "workspace_id", "data_source_id", "column_name", "canonical_name", "label", "role", "semantic_type", "default_aggregation", "description", "hidden", "cast_to", "sample_values", "cardinality" FROM `fields`;--> statement-breakpoint
DROP TABLE `fields`;--> statement-breakpoint
ALTER TABLE `__new_fields` RENAME TO `fields`;--> statement-breakpoint
CREATE INDEX `fields_data_source_id_idx` ON `fields` (`data_source_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `fields_data_source_column_unique` ON `fields` (`data_source_id`,`column_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `fields_data_source_canonical_unique` ON `fields` (`data_source_id`,`canonical_name`);--> statement-breakpoint
CREATE TABLE `__new_ingestion_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`source_key` text NOT NULL,
	`destination_key` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_ingestion_tokens`("id", "workspace_id", "source_key", "destination_key", "expires_at", "used_at", "created_at") SELECT "id", "workspace_id", "source_key", "destination_key", "expires_at", "used_at", "created_at" FROM `ingestion_tokens`;--> statement-breakpoint
DROP TABLE `ingestion_tokens`;--> statement-breakpoint
ALTER TABLE `__new_ingestion_tokens` RENAME TO `ingestion_tokens`;--> statement-breakpoint
CREATE INDEX `ingestion_tokens_workspace_id_idx` ON `ingestion_tokens` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_library_metrics` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`name` text NOT NULL,
	`canonical_name` text NOT NULL,
	`expression` text NOT NULL,
	`semantic_type` text NOT NULL,
	`description` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_library_metrics`("id", "workspace_id", "name", "canonical_name", "expression", "semantic_type", "description", "updated_at") SELECT "id", "workspace_id", "name", "canonical_name", "expression", "semantic_type", "description", "updated_at" FROM `library_metrics`;--> statement-breakpoint
DROP TABLE `library_metrics`;--> statement-breakpoint
ALTER TABLE `__new_library_metrics` RENAME TO `library_metrics`;--> statement-breakpoint
CREATE UNIQUE INDEX `library_metrics_workspace_canonical_unique` ON `library_metrics` (`workspace_id`,`canonical_name`);--> statement-breakpoint
CREATE TABLE `__new_query_read_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`workspace_id` text NOT NULL,
	`scanned_bytes` integer DEFAULT 0 NOT NULL,
	`maximum_bytes` integer NOT NULL,
	`expires_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`workspace_id`) REFERENCES `workspaces`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_query_read_budgets`("id", "workspace_id", "scanned_bytes", "maximum_bytes", "expires_at", "created_at") SELECT "id", "workspace_id", "scanned_bytes", "maximum_bytes", "expires_at", "created_at" FROM `query_read_budgets`;--> statement-breakpoint
DROP TABLE `query_read_budgets`;--> statement-breakpoint
ALTER TABLE `__new_query_read_budgets` RENAME TO `query_read_budgets`;--> statement-breakpoint
CREATE INDEX `query_read_budgets_workspace_id_idx` ON `query_read_budgets` (`workspace_id`);--> statement-breakpoint
CREATE TABLE `__new_share_links` (
	`token` text PRIMARY KEY NOT NULL,
	`dashboard_id` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`revoked_at` text,
	FOREIGN KEY (`dashboard_id`) REFERENCES `dashboards`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_share_links`("token", "dashboard_id", "created_by", "created_at", "revoked_at") SELECT "token", "dashboard_id", "created_by", "created_at", "revoked_at" FROM `share_links`;--> statement-breakpoint
DROP TABLE `share_links`;--> statement-breakpoint
ALTER TABLE `__new_share_links` RENAME TO `share_links`;--> statement-breakpoint
CREATE INDEX `share_links_dashboard_id_idx` ON `share_links` (`dashboard_id`);