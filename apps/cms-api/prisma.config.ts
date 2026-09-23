import { readFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "prisma/config";

// The Prisma CLI is a Node.js binary, so unlike this project's `bun`-run
// scripts, it never gets Bun's automatic .env.local/.env loading — load the
// same file list ConfigModule uses (src/config/config.module.ts) ourselves,
// first-loaded-wins, so `bun run prisma:migrate` sees the same DB_* values
// the app itself connects with.
function loadEnvFile(path: string): void {
  let content: string;
  try {
    content = readFileSync(path, "utf-8");
  } catch {
    return;
  }

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

const root = process.cwd();
loadEnvFile(join(root, ".env.test.local"));
loadEnvFile(join(root, ".env.local"));

const host = process.env.DB_HOST ?? "localhost";
const port = process.env.DB_PORT ?? "5432";
const database = process.env.DB_NAME ?? "abyssoftime-cms";
const username = encodeURIComponent(process.env.DB_USERNAME ?? "postgres");
const password = encodeURIComponent(process.env.DB_PASSWORD ?? "");

export default defineConfig({
  datasource: {
    url: `postgresql://${username}:${password}@${host}:${port}/${database}`,
  },
});
