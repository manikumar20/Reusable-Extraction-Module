import {
  CLAUDE_MAX_RETRIES,
  DEFAULT_CLAUDE_CONCURRENCY,
} from "./constants.js";

export { CLAUDE_MAX_RETRIES };

/**
 * Cap on simultaneous Claude requests, shared by extraction and any other
 * caller that imports withClaudeSlot. Call configureClaudeLimiter once at
 * startup. A finished call hands its slot straight to the next waiter.
 */
let maxConcurrency = DEFAULT_CLAUDE_CONCURRENCY;
let running = 0;
const waiting: (() => void)[] = [];

export const configureClaudeLimiter = (maxConcurrencyValue: number) => {
  maxConcurrency = Math.max(1, Math.floor(maxConcurrencyValue) || 1);
};

const acquire = (): Promise<void> => {
  if (running < maxConcurrency) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
};

const release = () => {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
};

export const withClaudeSlot = async <T>(run: () => Promise<T>): Promise<T> => {
  await acquire();
  try {
    return await run();
  } finally {
    release();
  }
};
