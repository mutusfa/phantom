/**
 * Retry utilities for transient failures.
 *
 * Distinguishes errors worth retrying (network blips, rate limits) from
 * errors that will never succeed on retry (auth failures, bad requests).
 * Inspired by the tenacity-based retry logic in meta-harness-tbench2.
 */

export interface RetryOptions {
	/** Maximum number of attempts including the first. Default: 3 */
	maxAttempts?: number;
	/** Base delay in ms for exponential backoff. Default: 1000 */
	baseDelayMs?: number;
	/** Maximum delay cap in ms. Default: 30000 */
	maxDelayMs?: number;
}

// Patterns in error messages that indicate a transient failure worth retrying.
const TRANSIENT_PATTERNS = [
	"rate limit",
	"rate_limit_exceeded",
	"too many requests",
	"429",
	"503",
	"502",
	"econnreset",
	"econnrefused",
	"etimedout",
	"enotfound",
	"socket hang up",
	"fetch failed",
	"network socket disconnected",
	"connect etimedout",
	"request timeout",
] as const;

// Patterns that indicate a permanent failure - retrying wastes time and budget.
const PERMANENT_PATTERNS = [
	"401",
	"403",
	"invalid api key",
	"invalid_api_key",
	"authentication failed",
	"authentication_error",
	"permission denied",
	"unauthorized",
	"not found",
	"404",
	"invalid_request_error",
] as const;

/**
 * Returns true if the error is likely transient and worth retrying.
 * Permanent errors (auth, not found, bad request) return false immediately.
 */
export function isTransientError(err: unknown): boolean {
	const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();

	// Permanent errors take precedence - never retry these.
	for (const pattern of PERMANENT_PATTERNS) {
		if (msg.includes(pattern)) return false;
	}

	for (const pattern of TRANSIENT_PATTERNS) {
		if (msg.includes(pattern)) return true;
	}

	return false;
}

/**
 * Retries an async function on transient errors with exponential backoff.
 * Non-transient errors (auth, not found) are re-thrown immediately without retry.
 */
export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
	const maxAttempts = options.maxAttempts ?? 3;
	const baseDelayMs = options.baseDelayMs ?? 1000;
	const maxDelayMs = options.maxDelayMs ?? 30_000;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (err: unknown) {
			const isLast = attempt === maxAttempts;

			// Non-transient errors or last attempt: give up immediately.
			if (!isTransientError(err) || isLast) {
				throw err;
			}

			// Exponential backoff: 1s, 2s, 4s, ... capped at maxDelayMs.
			const delay = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
			await new Promise<void>((resolve) => setTimeout(resolve, delay));
		}
	}

	// Unreachable: the loop always returns or throws.
	throw new Error("withRetry: exhausted all attempts");
}
