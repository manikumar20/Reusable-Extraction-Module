import { config as loadDotenv } from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Only `config/.env` is used — never `.env.example`. */
export const ENV_FILE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../config/.env",
);

if (path.basename(ENV_FILE) !== ".env") {
  throw new Error(`Refusing to load env file "${ENV_FILE}". Expected config/.env`);
}

if (!fs.existsSync(ENV_FILE)) {
  throw new Error(
    `Missing config/.env. Copy config/.env.example to config/.env and set ANTHROPIC_API_KEY there.`,
  );
}

// Strip UTF-8 BOM so the first key is not read as "\uFEFFNODE_ENV".
const envText = fs.readFileSync(ENV_FILE, "utf8").replace(/^\uFEFF/, "");
loadDotenv({ path: ENV_FILE, override: true });

// Re-apply from cleaned text so BOM / odd encodings cannot poison values.
for (const line of envText.split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  const name = trimmed.slice(0, eq).trim();
  let value = trimmed.slice(eq + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  process.env[name] = value;
}

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name} (from config/.env)`);
  }
  return value;
};

const optional = (name: string, fallback = "") =>
  (process.env[name] ?? fallback).trim().replace(/^["']|["']$/g, "");

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
  /** Always from config/.env — never from .env.example. */
  anthropicApiKey: optional("ANTHROPIC_API_KEY"),
  anthropicAuthToken: optional("ANTHROPIC_AUTH_TOKEN"),
  googleDriveApiKey: optional("GOOGLE_DRIVE_API_KEY") || optional("GOOGLE_API_KEY"),
  isProduction: required("NODE_ENV") === "production",
} as const;

console.info(
  `Env loaded from ${ENV_FILE} (ANTHROPIC_API_KEY ${env.anthropicApiKey ? "set" : "missing"}, GOOGLE_DRIVE_API_KEY ${env.googleDriveApiKey ? "set" : "missing"})`,
);
