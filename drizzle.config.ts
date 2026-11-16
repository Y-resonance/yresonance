import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  out: './drizzle',
  schema: './src/db/schema.ts',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://yresonance:yresonance@localhost:5432/yresonance',
  },
});
