import { EXTRACTION_MODEL, HEADER_MODEL } from "../services/extract/engine/shared/constants.js";
import { env } from "./env.js";

export const recordModel = () =>
  process.env.RECORD_MODEL?.trim() || EXTRACTION_MODEL;

export const documentModel = () =>
  process.env.DOCUMENT_MODEL?.trim() || HEADER_MODEL;

const cleanSecret = (value: string) =>
  value.trim().replace(/^["']|["']$/g, "").replace(/\r/g, "");

/** Anthropic API key from config/.env only (via env.ts). */
export const apiKey = () => cleanSecret(env.anthropicApiKey);

/** Optional bearer token from config/.env. */
export const authToken = () => cleanSecret(env.anthropicAuthToken);
