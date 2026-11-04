export interface AppError extends Error {
  statusCode: number;
  code?: string;
  details?: unknown;
}

export const AppError = (
  statusCode: number,
  message: string,
  options?: { code?: string; details?: unknown },
): AppError => {
  const error = new Error(message) as AppError;
  error.name = "AppError";
  error.statusCode = statusCode;
  error.code = options?.code;
  error.details = options?.details;
  return error;
};

export const isAppError = (error: unknown): error is AppError =>
  error instanceof Error &&
  "statusCode" in error &&
  Number.isInteger((error as AppError).statusCode);
