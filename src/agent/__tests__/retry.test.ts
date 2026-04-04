import { describe, expect, test } from "bun:test";
import { isTransientError, withRetry } from "../retry.ts";

describe("isTransientError", () => {
	test("identifies rate limit errors as transient", () => {
		expect(isTransientError(new Error("rate limit exceeded"))).toBe(true);
		expect(isTransientError(new Error("rate_limit_exceeded"))).toBe(true);
		expect(isTransientError(new Error("Too Many Requests"))).toBe(true);
		expect(isTransientError(new Error("HTTP 429"))).toBe(true);
	});

	test("identifies network errors as transient", () => {
		expect(isTransientError(new Error("ECONNRESET"))).toBe(true);
		expect(isTransientError(new Error("ECONNREFUSED"))).toBe(true);
		expect(isTransientError(new Error("ETIMEDOUT"))).toBe(true);
		expect(isTransientError(new Error("socket hang up"))).toBe(true);
		expect(isTransientError(new Error("fetch failed"))).toBe(true);
	});

	test("identifies server errors as transient", () => {
		expect(isTransientError(new Error("HTTP 503 Service Unavailable"))).toBe(true);
		expect(isTransientError(new Error("502 Bad Gateway"))).toBe(true);
	});

	test("identifies auth errors as permanent", () => {
		expect(isTransientError(new Error("401 Unauthorized"))).toBe(false);
		expect(isTransientError(new Error("403 Forbidden"))).toBe(false);
		expect(isTransientError(new Error("invalid api key"))).toBe(false);
		expect(isTransientError(new Error("authentication failed"))).toBe(false);
		expect(isTransientError(new Error("authentication_error"))).toBe(false);
	});

	test("identifies not found as permanent", () => {
		expect(isTransientError(new Error("404 not found"))).toBe(false);
		expect(isTransientError(new Error("resource not found"))).toBe(false);
	});

	test("identifies bad request as permanent", () => {
		expect(isTransientError(new Error("invalid_request_error: bad input"))).toBe(false);
	});

	test("permanent patterns take precedence over transient patterns", () => {
		// A message that contains both a permanent and transient pattern.
		// Should NOT retry - permanent wins.
		expect(isTransientError(new Error("401 rate limit on this key"))).toBe(false);
	});

	test("returns false for unknown error patterns", () => {
		expect(isTransientError(new Error("something totally unexpected happened"))).toBe(false);
		expect(isTransientError(new Error(""))).toBe(false);
	});

	test("works with non-Error values", () => {
		expect(isTransientError("ECONNRESET")).toBe(true);
		expect(isTransientError("invalid api key")).toBe(false);
		expect(isTransientError(42)).toBe(false);
	});

	test("is case-insensitive", () => {
		expect(isTransientError(new Error("RATE LIMIT EXCEEDED"))).toBe(true);
		expect(isTransientError(new Error("Invalid API Key"))).toBe(false);
	});
});

describe("withRetry", () => {
	test("returns result when function succeeds on first attempt", async () => {
		const result = await withRetry(() => Promise.resolve(42));
		expect(result).toBe(42);
	});

	test("retries on transient error and returns result on second attempt", async () => {
		let attempts = 0;
		const result = await withRetry(
			() => {
				attempts++;
				if (attempts === 1) return Promise.reject(new Error("ECONNRESET"));
				return Promise.resolve("success");
			},
			{ baseDelayMs: 0 },
		);
		expect(result).toBe("success");
		expect(attempts).toBe(2);
	});

	test("does not retry on permanent error", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				() => {
					attempts++;
					return Promise.reject(new Error("401 Unauthorized"));
				},
				{ baseDelayMs: 0 },
			),
		).rejects.toThrow("401 Unauthorized");
		expect(attempts).toBe(1);
	});

	test("gives up after maxAttempts on persistent transient error", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				() => {
					attempts++;
					return Promise.reject(new Error("socket hang up"));
				},
				{ maxAttempts: 3, baseDelayMs: 0 },
			),
		).rejects.toThrow("socket hang up");
		expect(attempts).toBe(3);
	});

	test("respects custom maxAttempts", async () => {
		let attempts = 0;
		await expect(
			withRetry(
				() => {
					attempts++;
					return Promise.reject(new Error("ETIMEDOUT"));
				},
				{ maxAttempts: 5, baseDelayMs: 0 },
			),
		).rejects.toThrow();
		expect(attempts).toBe(5);
	});

	test("succeeds after multiple transient failures", async () => {
		let attempts = 0;
		const result = await withRetry(
			() => {
				attempts++;
				if (attempts < 3) return Promise.reject(new Error("rate limit exceeded"));
				return Promise.resolve("done");
			},
			{ maxAttempts: 5, baseDelayMs: 0 },
		);
		expect(result).toBe("done");
		expect(attempts).toBe(3);
	});

	test("re-throws the last error type on exhaustion", async () => {
		class CustomError extends Error {
			constructor() {
				super("fetch failed");
				this.name = "CustomError";
			}
		}
		await expect(
			withRetry(() => Promise.reject(new CustomError()), { maxAttempts: 2, baseDelayMs: 0 }),
		).rejects.toBeInstanceOf(CustomError);
	});
});
