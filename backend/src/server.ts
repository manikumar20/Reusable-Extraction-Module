import { applySchema, ensureDatabase } from "../config/initDb.js";
import { runMigrations } from "../config/migrate.js";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabaseConnection, closeDatabase } from "./db/_shared/client.js";

const startServer = async () => {
  await ensureDatabase();
  const connected = await checkDatabaseConnection();
  if (!connected) {
    console.error(
      "Unable to connect to PostgreSQL. Check DATABASE_URL in config/.env and ensure PostgreSQL is running.",
    );
    process.exit(1);
  }
  await applySchema();
  await runMigrations();

  const { ensureDefaultTemplate } = await import("./services/templates/ensureDefaultTemplate.js");
  await ensureDefaultTemplate();
  const { ensureDefaultUser } = await import("./services/auth/ensureDefaultUser.js");
  await ensureDefaultUser();

  const { recoverStagedFiles } = await import("./services/batches/batchService.js");
  await recoverStagedFiles().catch((error) => {
    console.warn(
      `Could not recover compressed uploads: ${error instanceof Error ? error.message : error}`,
    );
  });

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Extraction API listening on http://127.0.0.1:${env.port}`);
    console.log(`A file is saved in the database only after extraction succeeds.`);
  });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}, shutting down.`);
    server.close(() => {
      void closeDatabase().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  server.on("error", (error: NodeJS.ErrnoException) => {
    const message =
      error.code === "EADDRINUSE" ? `Port ${env.port} is already in use.` : error.message;
    console.error(message);
    process.exit(1);
  });
};

startServer().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
