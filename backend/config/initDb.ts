import pg from "pg";
import { env } from "../src/config/env.js";
import { closeDatabase } from "../src/db/_shared/client.js";
import { runMigrations } from "./migrate.js";

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
  await runMigrations();
  console.log("PostgreSQL migrations are up to date");
  await closeDatabase();
};

const isDirectRun = process.argv[1]?.includes("initDb");
if (isDirectRun) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
