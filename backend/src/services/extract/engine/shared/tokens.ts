import { EXTRACTION_MODEL, TOKEN_PRICES } from "./constants.js";

export { EXTRACTION_MODEL };

export type ExtractionTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  /** Model that produced the usage; priced as the extraction model when absent. */
  model?: string;
};

export const emptyTokenUsage = (): ExtractionTokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
});

export const addTokenUsage = (
  total: ExtractionTokenUsage,
  next: ExtractionTokenUsage,
) => {
  total.inputTokens += next.inputTokens;
  total.outputTokens += next.outputTokens;
};

export const tokenUsageTotal = (usage: ExtractionTokenUsage) =>
  usage.inputTokens + usage.outputTokens;

export const tokenCostUsd = (usage: ExtractionTokenUsage) => {
  const [inputPrice, outputPrice] =
    TOKEN_PRICES[usage.model ?? EXTRACTION_MODEL] ??
    TOKEN_PRICES[EXTRACTION_MODEL];
  const cost =
    (usage.inputTokens / 1_000_000) * inputPrice +
    (usage.outputTokens / 1_000_000) * outputPrice;
  return Number(cost.toFixed(2));
};
