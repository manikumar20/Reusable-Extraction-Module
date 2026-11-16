export const AUTH_LIMITS = {
  MIN_PASSWORD_LENGTH: 8,
  BCRYPT_ROUNDS: 12,
} as const;

export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password.";
