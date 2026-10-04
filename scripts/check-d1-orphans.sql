-- Run before adding foreign keys. Every orphan_count must be zero.
SELECT 'data_sources.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM data_sources c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'fields.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM fields c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'calculated_fields.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM calculated_fields c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'library_metrics.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM library_metrics c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'dashboards.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM dashboards c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'datasource_uploads.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM datasource_uploads c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'ingestion_tokens.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM ingestion_tokens c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'query_read_budgets.workspace_id' AS relation, COUNT(*) AS orphan_count
FROM query_read_budgets c
LEFT JOIN workspaces p ON p.id = c.workspace_id
WHERE p.id IS NULL;
SELECT 'fields.data_source_id' AS relation, COUNT(*) AS orphan_count
FROM fields c
LEFT JOIN data_sources p ON p.id = c.data_source_id
WHERE p.id IS NULL;
SELECT 'calculated_fields.data_source_id' AS relation, COUNT(*) AS orphan_count
FROM calculated_fields c
LEFT JOIN data_sources p ON p.id = c.data_source_id
WHERE p.id IS NULL;
SELECT 'dashboard_grants.dashboard_id' AS relation, COUNT(*) AS orphan_count
FROM dashboard_grants c
LEFT JOIN dashboards p ON p.id = c.dashboard_id
WHERE p.id IS NULL;
SELECT 'share_links.dashboard_id' AS relation, COUNT(*) AS orphan_count
FROM share_links c
LEFT JOIN dashboards p ON p.id = c.dashboard_id
WHERE p.id IS NULL;
