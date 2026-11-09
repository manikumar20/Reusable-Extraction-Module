import Anthropic from "@anthropic-ai/sdk";
import { apiKey, authToken } from "../../config/runtime.js";
import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

type ClientOptions = {
  timeout?: number;
  maxRetries?: number;
};

/** Shared Anthropic client — prefers API key, falls back to auth token. */
export const createAnthropicClient = (options: ClientOptions = {}) => {
  const key = apiKey();
  const token = authToken();
  if (!key && !token) {
    throw AppError(HTTP_STATUS.SERVICE_UNAVAILABLE, "AI API key is not configured.", {
      code: "CLAUDE_NOT_CONFIGURED",
    });
  }
  return new Anthropic({
    ...(key ? { apiKey: key } : { apiKey: null }),
    ...(token ? { authToken: token } : {}),
    timeout: options.timeout,
    maxRetries: options.maxRetries,
  });
};

export const hasClaudeCredentials = () => Boolean(apiKey() || authToken());
