import { describe, expect, test } from "bun:test";
import { type FetchBinary, processSlackFiles } from "../slack-files.ts";

// A tiny 1x1 transparent PNG. Stable, known size, easy to hash.
const ONE_PX_PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function makeFetch(
	map: Record<string, { ok?: boolean; status?: number; text?: string; bytes?: Uint8Array }>,
): FetchBinary {
	return async (url: string, _token: string) => {
		const entry = map[url] ?? { ok: false, status: 404 };
		return {
			ok: entry.ok ?? true,
			status: entry.status ?? 200,
			text: async () => entry.text ?? "",
			bytes: async () => entry.bytes ?? new Uint8Array(),
		};
	};
}

describe("processSlackFiles", () => {
	test("returns empty result for no files", async () => {
		const result = await processSlackFiles([], "token");
		expect(result.text).toBe("");
		expect(result.attachments).toEqual([]);
	});

	test("downloads a text file as delimited content", async () => {
		const fetchFn = makeFetch({ "https://slack/file1": { text: "hello world" } });
		const result = await processSlackFiles(
			[{ name: "notes.txt", mimetype: "text/plain", size: 11, url_private_download: "https://slack/file1" }],
			"token",
			fetchFn,
		);
		expect(result.attachments).toEqual([]);
		expect(result.text).toContain("--- Attached file: notes.txt ---");
		expect(result.text).toContain("hello world");
	});

	test("downloads an image as a base64 attachment", async () => {
		const bytes = Buffer.from(ONE_PX_PNG_BASE64, "base64");
		const fetchFn = makeFetch({ "https://slack/img": { bytes: new Uint8Array(bytes) } });
		const result = await processSlackFiles(
			[{ name: "shot.png", mimetype: "image/png", size: bytes.length, url_private_download: "https://slack/img" }],
			"token",
			fetchFn,
		);
		expect(result.text).toBe("");
		expect(result.attachments.length).toBe(1);
		expect(result.attachments[0]).toEqual({
			kind: "image",
			mediaType: "image/png",
			dataBase64: ONE_PX_PNG_BASE64,
			name: "shot.png",
		});
	});

	test("normalizes image/jpg to image/jpeg for Anthropic compatibility", async () => {
		const fetchFn = makeFetch({ "https://slack/img": { bytes: new Uint8Array([1, 2, 3]) } });
		const result = await processSlackFiles(
			[{ name: "photo.jpg", mimetype: "image/jpg", size: 3, url_private_download: "https://slack/img" }],
			"token",
			fetchFn,
		);
		expect(result.attachments[0].mediaType).toBe("image/jpeg");
	});

	test("caps at 5 images per message", async () => {
		const fetchFn = makeFetch({
			"https://slack/img": { bytes: new Uint8Array([1, 2, 3]) },
		});
		const files = Array.from({ length: 7 }, (_, i) => ({
			name: `img${i}.png`,
			mimetype: "image/png",
			size: 3,
			url_private_download: "https://slack/img",
		}));
		const result = await processSlackFiles(files, "token", fetchFn);
		expect(result.attachments.length).toBe(5);
		expect(result.text).toContain("exceeds max of 5 images");
	});

	test("skips images that exceed the 5MB size limit", async () => {
		const fetchFn = makeFetch({ "https://slack/big": { bytes: new Uint8Array([0]) } });
		const result = await processSlackFiles(
			[
				{
					name: "huge.png",
					mimetype: "image/png",
					size: 10 * 1024 * 1024,
					url_private_download: "https://slack/big",
				},
			],
			"token",
			fetchFn,
		);
		expect(result.attachments).toEqual([]);
		expect(result.text).toContain("too large");
	});

	test("still supports text + image in the same message", async () => {
		const imgBytes = Buffer.from(ONE_PX_PNG_BASE64, "base64");
		const fetchFn = makeFetch({
			"https://slack/txt": { text: "logs here" },
			"https://slack/img": { bytes: new Uint8Array(imgBytes) },
		});
		const result = await processSlackFiles(
			[
				{ name: "log.txt", mimetype: "text/plain", size: 9, url_private_download: "https://slack/txt" },
				{ name: "shot.png", mimetype: "image/png", size: imgBytes.length, url_private_download: "https://slack/img" },
			],
			"token",
			fetchFn,
		);
		expect(result.text).toContain("logs here");
		expect(result.attachments.length).toBe(1);
		expect(result.attachments[0].mediaType).toBe("image/png");
	});

	test("reports an HTTP error instead of swallowing it", async () => {
		const fetchFn = makeFetch({ "https://slack/gone": { ok: false, status: 404 } });
		const result = await processSlackFiles(
			[{ name: "x.png", mimetype: "image/png", size: 10, url_private_download: "https://slack/gone" }],
			"token",
			fetchFn,
		);
		expect(result.attachments).toEqual([]);
		expect(result.text).toContain("HTTP 404");
	});

	test("skips unsupported binary formats with a placeholder (no download)", async () => {
		let fetchCalled = false;
		const fetchFn: FetchBinary = async () => {
			fetchCalled = true;
			return { ok: true, status: 200, text: async () => "", bytes: async () => new Uint8Array() };
		};
		const result = await processSlackFiles(
			[
				{
					name: "weird.bin",
					mimetype: "application/octet-stream",
					size: 100,
					url_private_download: "https://slack/bin",
				},
			],
			"token",
			fetchFn,
		);
		expect(fetchCalled).toBe(false);
		expect(result.attachments).toEqual([]);
		expect(result.text).toContain("unsupported format");
	});
});
