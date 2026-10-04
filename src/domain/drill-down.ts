import type { DrillPath, WidgetDefinition } from './schema';

type DrillableDefinition = Extract<WidgetDefinition, { type: 'bar' | 'pie' | 'line' }>;

function isDrillable(definition: WidgetDefinition): definition is DrillableDefinition {
  return definition.type === 'bar' || definition.type === 'pie' || definition.type === 'line';
}

/** Every level a chart can drill through, top level first. Empty for widgets without drilling. */
export function drillLevels(definition: WidgetDefinition) {
  if (!isDrillable(definition)) return [];
  return [definition.dimension, ...(definition.drillDimensions ?? [])];
}

/**
 * What a chart queries at a drill path: the same definition grouped by the next level's dimension,
 * plus one equality filter per clicked level. Returns undefined when the path goes deeper than the
 * levels the editor defined.
 */
export function drilledQuery(definition: WidgetDefinition, drillPath: DrillPath) {
  if (!drillPath.length) return { definition, filters: [] };
  if (!isDrillable(definition)) return undefined;
  const levels = drillLevels(definition);
  const dimension = levels[drillPath.length];
  if (!dimension) return undefined;
  const filters = drillPath.map((value, index) => ({
    fieldId: levels[index]!.fieldId,
    values: [value],
  }));
  if (definition.type === 'line') return { definition: { ...definition, dimension }, filters };
  // A sort on the top-level dimension means "sort along the axis", so it follows the axis down.
  const sort = definition.sort?.map((item) =>
    item.target.kind === 'dimension' && item.target.fieldId === definition.dimension.fieldId
      ? { ...item, target: { kind: 'dimension' as const, fieldId: dimension.fieldId } }
      : item,
  );
  return { definition: { ...definition, dimension, sort }, filters };
}
