import { z } from 'zod';
import type { ApiRequest, DatasourceCatalogPage } from '#/api/contracts';
import { bigqueryRequest } from '#/data/bigquery.server';
import { googleAccessToken } from '#/data/google-oauth.server';
import { requireSession } from './auth.server';
import { datasourceOperation } from './datasource-operations.server';
import { ApiError } from './errors';

const pagination = { nextPageToken: z.string().optional() };
const projectsSchema = z.object({
  ...pagination,
  projects: z
    .array(
      z.object({
        projectReference: z.object({ projectId: z.string() }),
        friendlyName: z.string().optional(),
      }),
    )
    .default([]),
});
const datasetsSchema = z.object({
  ...pagination,
  datasets: z
    .array(
      z.object({
        datasetReference: z.object({ datasetId: z.string() }),
        location: z.string(),
      }),
    )
    .default([]),
});
const tablesSchema = z.object({
  ...pagination,
  tables: z
    .array(
      z.object({
        tableReference: z.object({ tableId: z.string() }),
        type: z.string(),
      }),
    )
    .default([]),
});

export async function browseDatasource(
  request: Extract<ApiRequest, { action: 'browseDatasource' }>,
): Promise<DatasourceCatalogPage> {
  const session = await requireSession();
  if (request.dataset && !request.project)
    throw new ApiError(400, 'invalid_datasource_location', 'Choose a project first.');
  return datasourceOperation(async () => {
    const { accessToken } = await googleAccessToken(session.workspace.id, request.connectionId);
    const search = new URLSearchParams({ maxResults: '50' });
    if (request.cursor) search.set('pageToken', request.cursor);
    const projectPath = request.project ? `projects/${encodeURIComponent(request.project)}` : '';
    const path = request.dataset
      ? `${projectPath}/datasets/${encodeURIComponent(request.dataset)}/tables`
      : request.project
        ? `${projectPath}/datasets`
        : 'projects';
    const body = await bigqueryRequest(accessToken, `${path}?${search}`);
    if (request.dataset) {
      const page = tablesSchema.parse(body);
      return {
        entries: page.tables.map((entry) => ({
          id: entry.tableReference.tableId,
          label: entry.tableReference.tableId,
          type: entry.type,
        })),
        cursor: page.nextPageToken,
      };
    }
    if (request.project) {
      const page = datasetsSchema.parse(body);
      return {
        entries: page.datasets.map((entry) => ({
          id: entry.datasetReference.datasetId,
          label: entry.datasetReference.datasetId,
          location: entry.location,
        })),
        cursor: page.nextPageToken,
      };
    }
    const page = projectsSchema.parse(body);
    return {
      entries: page.projects.map((entry) => ({
        id: entry.projectReference.projectId,
        label: entry.friendlyName || entry.projectReference.projectId,
      })),
      cursor: page.nextPageToken,
    };
  });
}
