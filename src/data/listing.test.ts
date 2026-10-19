import { describe, expect, it, vi } from 'vitest';
import {
  collectObjectPages,
  matchingSourceObjects,
  paginateObjects,
  type ObjectPage,
} from './listing';

describe('paginated object listings', () => {
  it('collects more than 1,000 objects in stable page order', async () => {
    const first = Array.from({ length: 1_000 }, (_, index) => ({ key: `part-${index}` }));
    const load = vi.fn<(cursor?: string) => Promise<ObjectPage<{ key: string }>>>((cursor) =>
      Promise.resolve(
        cursor
          ? { objects: [{ key: 'part-1000' }], truncated: false }
          : { objects: first, truncated: true, cursor: 'next' },
      ),
    );
    const objects = await collectObjectPages(load);
    expect(objects).toHaveLength(1_001);
    expect(objects.at(-1)).toEqual({ key: 'part-1000' });
    expect(load).toHaveBeenNthCalledWith(2, 'next');
  });

  it('rejects a truncated page without a cursor', async () => {
    await expect(
      collectObjectPages(() => Promise.resolve({ objects: [], truncated: true })),
    ).rejects.toThrow('without a cursor');
  });

  it('rejects repeated cursors and excessive object counts', async () => {
    let calls = 0;
    await expect(
      collectObjectPages(async () => ({
        objects: [],
        truncated: ++calls < 3,
        cursor: 'same',
      })),
    ).rejects.toThrow('repeated a cursor');
    await expect(
      collectObjectPages(async () => ({
        objects: Array(10_001).fill('object'),
        truncated: false,
      })),
    ).rejects.toThrow('10,000 object');
  });

  it('creates cursors for local listings larger than one page', () => {
    const objects = Array.from({ length: 1_001 }, (_, index) => ({ key: `part-${index}` }));
    const first = paginateObjects(objects);
    const second = paginateObjects(objects, first.cursor);
    expect(first).toMatchObject({ truncated: true, cursor: '1000' });
    expect(first.objects).toHaveLength(1_000);
    expect(second).toEqual({ objects: [{ key: 'part-1000' }], truncated: false });
  });

  it('filters the requested format and sorts keys for stable hashes', () => {
    expect(
      matchingSourceObjects(
        [{ key: 'prefix/z.csv' }, { key: 'prefix/a.CSV' }, { key: 'prefix/b.parquet' }],
        'csv',
      ),
    ).toEqual([{ key: 'prefix/a.CSV' }, { key: 'prefix/z.csv' }]);
  });
});
