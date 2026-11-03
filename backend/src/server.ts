import fs from "node:fs/promises";
import { ensureDatabase } from "../config/initDb.js";
import { createApp } from "./app.js";
import { env } from "./config/env.js";
import { checkDatabaseConnection, closeDatabase } from "./db/_shared/client.js";
import { runMigrations } from "../config/migrate.js";
import { uploadDir } from "./middleware/documentUpload.js";

const startServer = async () => {
  await ensureDatabase();
  const connected = await checkDatabaseConnection();
  if (!connected) {
    console.error(
      "Unable to connect to PostgreSQL. Check DATABASE_URL in config/.env and ensure PostgreSQL is running.",
    );
    process.exit(1);
  }
  await runMigrations();
  await fs.mkdir(uploadDir, { recursive: true });

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`Extraction API listening on http://127.0.0.1:${env.port}`);
    console.log(`Uploads folder: ${uploadDir}`);
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
