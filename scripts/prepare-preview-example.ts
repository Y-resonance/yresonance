import { DuckDBInstance } from '@duckdb/node-api';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { exampleCampaignCsv } from '../src/data/example-campaign';

// Package the preview fixture with its inspected schema. Bootstrap needs no query engine.
const endDate = new Date().toISOString().slice(0, 10);
const directory = await mkdtemp(join(tmpdir(), 'rundown-preview-example-'));
const instance = await DuckDBInstance.create(':memory:');
const connection = await instance.connect();
try {
  const csv = join(directory, 'example.csv');
  const parquet = join(directory, 'example.parquet');
  const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
  await Bun.write(csv, exampleCampaignCsv(endDate));
  await connection.run(
    `COPY (SELECT * FROM read_csv_auto(${quote(csv)}, header = true)) TO ${quote(parquet)} (FORMAT PARQUET, COMPRESSION ZSTD)`,
  );
  const source = `read_parquet(${quote(parquet)})`;
  const description = z
    .array(z.object({ column_name: z.string(), column_type: z.string() }))
    .parse(
      (await connection.runAndReadAll(`DESCRIBE SELECT * FROM ${source}`)).getRowObjectsJson(),
    );
  const samples = (
    await connection.runAndReadAll(`SELECT * FROM ${source} LIMIT 20`)
  ).getRowObjectsJson();
  const bytes = await Bun.file(parquet).bytes();
  await mkdir('.generated', { recursive: true });
  await Bun.write(
    '.generated/preview-example.json',
    JSON.stringify({
      endDate,
      parquet: Buffer.from(bytes).toString('base64'),
      description,
      samples,
    }),
  );
  console.log(`Prepared preview example ending ${endDate}: ${bytes.length} bytes`);
} finally {
  connection.closeSync();
  instance.closeSync();
  await rm(directory, { recursive: true, force: true });
}
