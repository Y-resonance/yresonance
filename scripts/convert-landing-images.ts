import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Keep text and chart lines exact. cwebp is part of the libwebp tools package.
const directory = 'public/landing';
for (const file of await readdir(directory)) {
  if (!file.endsWith('.png')) continue;
  const input = join(directory, file);
  const output = join(directory, file.replace(/\.png$/, '.webp'));
  const result = spawnSync('cwebp', ['-lossless', '-m', '6', input, '-o', output], {
    stdio: 'inherit',
  });
  if (result.error)
    throw new Error('Install the libwebp tools to convert landing screenshots.', {
      cause: result.error,
    });
  if (result.status !== 0) throw new Error(`Could not convert ${input}.`);
}
