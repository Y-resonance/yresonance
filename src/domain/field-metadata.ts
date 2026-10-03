import type { ApiRequest } from '#/api/contracts';
import type { Aggregation, FieldRole, SemanticType } from '#/domain/schema';

type MetadataPatch = Extract<ApiRequest, { action: 'updateFieldMetadata' }>['patch'];

export function canUpdateFieldMetadata(
  isAdmin: boolean,
  hasEditorAccess: boolean,
  dashboardUsesSource: boolean,
  patch: MetadataPatch,
) {
  if (isAdmin) return true;
  if (!hasEditorAccess || !dashboardUsesSource) return false;
  return (
    patch.hidden === undefined && patch.castTo === undefined && patch.canonicalName === undefined
  );
}

export interface DetectedFieldSemantics {
  role: FieldRole;
  semanticType: SemanticType;
  defaultAggregation: Aggregation | null;
  castTo: string | null;
}

/**
 * Derives field defaults from a backend column description at registration time.
 * Roles are only dimension or metric, so id-like and date-like columns become
 * dimensions and keep their nature in the semantic type.
 */
export function detectFieldSemantics(
  columnName: string,
  columnType: string,
): DetectedFieldSemantics {
  const idLike = /id$/iu.test(columnName);
  const dateLike = /DATE|TIMESTAMP/iu.test(columnType);
  const numeric = /INT|DECIMAL|DOUBLE|FLOAT|REAL|HUGE/iu.test(columnType);
  return {
    role: numeric && !idLike ? 'metric' : 'dimension',
    semanticType: idLike ? 'id' : dateLike ? 'date' : numeric ? 'count' : 'text',
    defaultAggregation: numeric ? 'sum' : null,
    castTo: idLike ? 'VARCHAR' : null,
  };
}
