import { defineConfig } from 'prisma/config';

// Prisma 7 loads connection config from here (no `url` in schema.prisma anymore).
// Load apps/api/.env so the CLI (migrate/studio/seed) sees DATABASE_URL locally.
try {
  process.loadEnvFile();
} catch {
  // .env is optional (CI injects env vars directly).
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    // Migrations/introspection use a DIRECT connection (Prisma 7 has no schema `directUrl`).
    // On managed Postgres (Supabase) DATABASE_URL is the pooler; DIRECT_URL is port 5432.
    // Locally they are the same. Empty is fine for `prisma generate` (no DB needed).
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL ?? '',
  },
  migrations: {
    seed: 'tsx prisma/seed.ts',
  },
});
