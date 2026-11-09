import { AppError, HTTP_STATUS } from "../../utils/errors/index.js";

/** Map Anthropic SDK / HTTP failures to AppError for API responses. */
export const mapClaudeError = (error: unknown): AppError => {
  const status =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  const message =
    error instanceof Error ? error.message : "AI request failed.";

  if (status === 401 || /invalid x-api-key|authentication_error/i.test(message)) {
    return AppError(
      HTTP_STATUS.SERVICE_UNAVAILABLE,
      "Anthropic rejected the API key. Use a Console API key from https://console.anthropic.com/settings/keys (usually starts with sk-ant-api). Claude.ai / Claude Code user keys (sk-ant-usr-…) do not work with this API.",
      { code: "CLAUDE_AUTH_FAILED" },
    );
  }
  if (status === 429 || /rate.?limit/i.test(message)) {
    return AppError(HTTP_STATUS.TOO_MANY_REQUESTS, "AI rate limit reached. Try again shortly.", {
      code: "CLAUDE_RATE_LIMITED",
    });
  }
  if (status === 413 || /too large|request_too_large/i.test(message)) {
    return AppError(HTTP_STATUS.PAYLOAD_TOO_LARGE, "Document is too large for AI processing.", {
      code: "CLAUDE_PAYLOAD_TOO_LARGE",
    });
  }

  return AppError(HTTP_STATUS.INTERNAL_SERVER_ERROR, "AI request failed.", {
    code: "CLAUDE_REQUEST_FAILED",
    details: message.slice(0, 300),
  });
};
