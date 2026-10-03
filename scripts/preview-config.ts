import { createHash } from 'node:crypto';
import { z } from 'zod';

export function previewResourceName(workerName: string, branch: string) {
  const name = z.string().min(1).max(250).parse(branch);
  if (name === 'main' || name === 'HEAD')
    throw new Error('An explicit non-production branch is required.');
  const hash = createHash('sha256').update(name).digest('hex').slice(0, 16);
  return `${workerName}-branch-${hash}`;
}
