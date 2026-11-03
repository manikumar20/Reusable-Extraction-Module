import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/.env",
);

if (!fs.existsSync(envFile)) {
  throw new Error(`Missing env file: ${envFile}`);
}

loadDotenv({ path: envFile, override: true });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optional = (name: string, fallback = "") =>
  (process.env[name] ?? fallback).trim();

const parseOrigins = (value: string) =>
  value
    .split(",")
    .map((origin) => origin.trim().replace(/\/$/, ""))
    .filter(Boolean);

export const env = {
  nodeEnv: required("NODE_ENV"),
  port: Number(required("PORT")),
  corsOrigins: parseOrigins(required("CORS_ORIGIN")),
  databaseUrl: required("DATABASE_URL"),
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  isProduction: required("NODE_ENV") === "production",
} as const;
