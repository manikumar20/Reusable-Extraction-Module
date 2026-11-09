import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { env } from "../src/config/env.js";
import { closeDatabase, getPool } from "../src/db/_shared/client.js";
import { runMigrations } from "./migrate.js";

const schemaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "schema");

/** Apply config/schema/*.sql (current database shape, idempotent). */
export const applySchema = async () => {
  const files = (await fs.readdir(schemaDir))
    .filter((name) => name.endsWith(".sql"))
    .sort();
  console.log("Applying schema…");
  for (const file of files) {
    const sql = await fs.readFile(path.join(schemaDir, file), "utf8");
    await getPool().query(sql);
    console.log(`  ✓ ${file}`);
  }
};

const { Pool } = pg;

const databaseNameFromUrl = (databaseUrl: string) => {
  const name = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Refusing database name "${name}". Use letters, numbers, and underscores.`);
  }
  return name;
};

export const ensureDatabase = async () => {
  const dbName = databaseNameFromUrl(env.databaseUrl);
  const adminUrl = new URL(env.databaseUrl);
  adminUrl.pathname = "/postgres";
  const admin = new Pool({ connectionString: adminUrl.toString() });
  try {
    const found = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
    if (found.rowCount === 0) {
      await admin.query(`CREATE DATABASE ${dbName}`);
      console.log(`Created database ${dbName}`);
    } else {
      console.log(`Database ${dbName} already exists`);
    }
  } finally {
    await admin.end();
  }
};

const run = async () => {
  await ensureDatabase();
  await applySchema();
  await runMigrations();
  console.log("PostgreSQL schema and migrations are up to date");
  await closeDatabase();
};

const isDirectRun = process.argv[1]?.includes("initDb");
if (isDirectRun) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
