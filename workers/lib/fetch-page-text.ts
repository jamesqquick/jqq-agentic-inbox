import { stripHtmlToText } from "./email-helpers";
import { redactUrlForLog, redactUrlsInText } from "./browser-markdown";

const MAX_FALLBACK_FETCH_BYTES = 200_000;
const FALLBACK_FETCH_TIMEOUT_MS = 10_000;
const MAX_PAGE_TEXT_LENGTH = 8000;

/**
 * Plain-fetch fallback for when Browser Run Quick Actions can't retrieve a page.
 *
 * Streams the response body with a byte-count guard to avoid OOM on large pages.
 * Returns stripped plain text (HTML tags removed), or null on any failure.
 */
export async function fetchPageText(
	url: string,
	logPrefix: string,
	userAgent = "Mozilla/5.0 (compatible; AgenticInboxBot/1.0)",
): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), FALLBACK_FETCH_TIMEOUT_MS);

	try {
		const response = await fetch(url, {
			headers: { "User-Agent": userAgent },
			redirect: "follow",
			signal: controller.signal,
		});

		if (!response.ok) {
			console.warn(`[${logPrefix}] Failed to fetch ${redactUrlForLog(url)}: ${response.status}`);
			return null;
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
			console.warn(`[${logPrefix}] Unsupported content type for ${redactUrlForLog(url)}: ${contentType}`);
			return null;
		}

		const contentLength = Number(response.headers.get("content-length") || 0);
		if (contentLength > MAX_FALLBACK_FETCH_BYTES) {
			console.warn(`[${logPrefix}] Fallback fetch response too large for ${redactUrlForLog(url)}: ${contentLength} bytes`);
			return null;
		}

		if (!response.body) return null;

		const reader = response.body.getReader();
		const chunks: Uint8Array[] = [];
		let bytesRead = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytesRead += value.byteLength;
			if (bytesRead > MAX_FALLBACK_FETCH_BYTES) {
				await reader.cancel();
				console.warn(`[${logPrefix}] Fallback fetch exceeded size limit for ${redactUrlForLog(url)}: ${bytesRead} bytes`);
				return null;
			}
			chunks.push(value);
		}

		const result = new Uint8Array(bytesRead);
		let offset = 0;
		for (const chunk of chunks) {
			result.set(chunk, offset);
			offset += chunk.byteLength;
		}

		const html = new TextDecoder().decode(result);
		const text = stripHtmlToText(html);
		return text.slice(0, MAX_PAGE_TEXT_LENGTH);
	} catch (e) {
		console.error(`[${logPrefix}] Error fetching ${redactUrlForLog(url)}:`, redactUrlsInText((e as Error).message));
		return null;
	} finally {
		clearTimeout(timeout);
	}
}
