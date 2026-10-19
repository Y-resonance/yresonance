export interface ObjectPage<T> {
  objects: T[];
  truncated: boolean;
  cursor?: string;
}

export function paginateObjects<T>(objects: T[], cursor?: string, limit = 1_000): ObjectPage<T> {
  const offset = cursor === undefined ? 0 : Number(cursor);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error('Invalid object listing cursor.');
  const nextOffset = offset + limit;
  const truncated = nextOffset < objects.length;
  return {
    objects: objects.slice(offset, nextOffset),
    truncated,
    cursor: truncated ? String(nextOffset) : undefined,
  };
}

export async function collectObjectPages<T>(load: (cursor?: string) => Promise<ObjectPage<T>>) {
  const objects: T[] = [];
  let cursor: string | undefined;
  const cursors = new Set<string>();
  let pages = 0;
  do {
    if (++pages > 100) throw new Error('Object listing exceeds the 100 page limit.');
    const page = await load(cursor);
    if (objects.length + page.objects.length > 10_000)
      throw new Error('Object listing exceeds the 10,000 object limit.');
    objects.push(...page.objects);
    if (page.truncated && !page.cursor) throw new Error('Object listing ended without a cursor.');
    cursor = page.truncated ? page.cursor : undefined;
    if (cursor) {
      if (cursors.has(cursor)) throw new Error('Object listing repeated a cursor.');
      cursors.add(cursor);
    }
  } while (cursor);
  return objects;
}

export function matchingSourceObjects<T extends { key: string }>(
  objects: T[],
  format: 'csv' | 'parquet',
) {
  return objects
    .filter((object) => object.key.toLowerCase().endsWith(`.${format}`))
    .sort((left, right) => left.key.localeCompare(right.key));
}
