import { EXTRACTION_MODEL, HEADER_MODEL } from "../services/extract/engine/shared/constants.js";
import { env } from "./env.js";

export const recordModel = () =>
  process.env.RECORD_MODEL?.trim() || EXTRACTION_MODEL;

export const documentModel = () =>
  process.env.DOCUMENT_MODEL?.trim() || HEADER_MODEL;

export const apiKey = () => env.anthropicApiKey || process.env.ANTHROPIC_API_KEY?.trim() || "";
