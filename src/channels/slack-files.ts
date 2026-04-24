// Pure helpers for processing Slack file attachments. Kept out of slack.ts so
// the logic can be unit tested without the Bolt app or a live socket.

import type { MessageAttachment } from "./types.ts";

const TEXT_MIMETYPES = ["text/", "application/json", "application/xml", "application/yaml"];
const IMAGE_MIMETYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"];
const TEXT_MAX_SIZE = 200 * 1024; // 200 KB
const IMAGE_MAX_SIZE = 5 * 1024 * 1024; // 5 MB per image
const MAX_IMAGES_PER_MESSAGE = 5;

export type SlackFile = {
	name?: string;
	mimetype?: string;
	size?: number;
	url_private?: string;
	url_private_download?: string;
};

export type ProcessedSlackFiles = {
	text: string;
	attachments: MessageAttachment[];
};

// Anthropic's image content block uses image/jpeg (not image/jpg). Slack
// occasionally reports image/jpg, so normalize that here.
function normalizeImageMediaType(mimetype: string): string {
	return mimetype === "image/jpg" ? "image/jpeg" : mimetype;
}

function isText(mimetype: string): boolean {
	return TEXT_MIMETYPES.some((t) => mimetype.startsWith(t));
}

function isImage(mimetype: string): boolean {
	return IMAGE_MIMETYPES.includes(mimetype);
}

export type FetchBinary = (
	url: string,
	token: string,
) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; bytes: () => Promise<Uint8Array> }>;

export const defaultFetchBinary: FetchBinary = async (url, token) => {
	const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
	return {
		ok: res.ok,
		status: res.status,
		text: () => res.text(),
		bytes: async () => new Uint8Array(await res.arrayBuffer()),
	};
};

// Processes a list of Slack file objects: downloads text files inline (as
// delimited text) and images as base64 attachments. Binaries that are neither
// text nor a supported image become a short placeholder line so the agent
// still knows the file existed.
export async function processSlackFiles(
	files: unknown[],
	botToken: string,
	fetchFn: FetchBinary = defaultFetchBinary,
): Promise<ProcessedSlackFiles> {
	const textParts: string[] = [];
	const attachments: MessageAttachment[] = [];
	let imageCount = 0;

	for (const file of files) {
		const f = file as SlackFile;
		const name = f.name ?? "file";
		const mimetype = f.mimetype ?? "";
		const size = f.size ?? 0;
		const url = f.url_private_download ?? f.url_private ?? "";

		if (!url) continue;

		if (isImage(mimetype)) {
			if (imageCount >= MAX_IMAGES_PER_MESSAGE) {
				textParts.push(`[Image "${name}" skipped - exceeds max of ${MAX_IMAGES_PER_MESSAGE} images per message]`);
				continue;
			}
			if (size > IMAGE_MAX_SIZE) {
				textParts.push(`[Image "${name}" skipped - too large (${Math.round(size / 1024)}KB, limit 5MB)]`);
				continue;
			}
			try {
				const res = await fetchFn(url, botToken);
				if (!res.ok) {
					textParts.push(`[Image "${name}" could not be downloaded: HTTP ${res.status}]`);
					continue;
				}
				const bytes = await res.bytes();
				const dataBase64 = Buffer.from(bytes).toString("base64");
				attachments.push({
					kind: "image",
					mediaType: normalizeImageMediaType(mimetype),
					dataBase64,
					name,
				});
				imageCount++;
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				textParts.push(`[Image "${name}" download failed: ${msg}]`);
			}
			continue;
		}

		if (isText(mimetype)) {
			if (size > TEXT_MAX_SIZE) {
				textParts.push(`[File "${name}" skipped - too large (${Math.round(size / 1024)}KB)]`);
				continue;
			}
			try {
				const res = await fetchFn(url, botToken);
				if (!res.ok) {
					textParts.push(`[File "${name}" could not be downloaded: HTTP ${res.status}]`);
					continue;
				}
				const content = await res.text();
				textParts.push(`--- Attached file: ${name} ---\n${content}\n--- End of ${name} ---`);
			} catch (err: unknown) {
				const msg = err instanceof Error ? err.message : String(err);
				textParts.push(`[File "${name}" download failed: ${msg}]`);
			}
			continue;
		}

		textParts.push(`[File "${name}" skipped - unsupported format (${mimetype})]`);
	}

	return { text: textParts.join("\n\n"), attachments };
}
