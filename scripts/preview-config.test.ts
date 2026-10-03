import { describe, expect, it } from 'vitest';
import { previewResourceName } from './preview-config';

describe('branch preview storage isolation', () => {
  it('keeps distinct branches separate even when their URL slugs would collide', () => {
    const names = ['feature/report', 'feature-report', 'feature/Report', 'feature/report-2'].map(
      (branch) => previewResourceName('yresonance', branch),
    );
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^[a-z0-9-]+$/);
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it.each(['main', 'HEAD', ''])('rejects an unsafe branch target: %s', (branch) => {
    expect(() => previewResourceName('yresonance', branch)).toThrow(Error);
  });
});
