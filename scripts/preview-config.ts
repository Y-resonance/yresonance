import { createHash } from 'node:crypto';
import { z } from 'zod';

export function previewResourceName(workerName: string, branch: string) {
  return `${workerName}-branch-${branchHash(branch)}`;
}

export function previewClickhouseDatabase(branch: string) {
  return `yresonance_preview_${branchHash(branch)}`;
}

function branchHash(branch: string) {
  const name = z.string().min(1).max(250).parse(branch);
  if (name === 'main' || name === 'HEAD')
    throw new Error('An explicit non-production branch is required.');
  return createHash('sha256').update(name).digest('hex').slice(0, 16);
}
