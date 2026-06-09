const MAX_MARKDOWN_LENGTH = 8000;
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

export function redactUrlForLog(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return "[invalid-url]";
	}
}

export function redactUrlsInText(text: string): string {
	return text.replace(URL_REGEX, (url) => redactUrlForLog(url));
}

/**
 * Fetch a web page's content as Markdown via the Browser Run `/markdown` Quick Action.
 * Returns null if the fetch fails or returns empty content.
 */
export async function fetchMarkdown(
	browser: BrowserRun,
	url: string,
	logPrefix: string,
): Promise<string | null> {
	try {
		const response = await browser.quickAction("markdown", {
			url,
			gotoOptions: { waitUntil: "domcontentloaded" },
		});

		if (!response.ok) {
			console.warn(`[${logPrefix}] Browser Run markdown Quick Action failed for ${redactUrlForLog(url)}: HTTP ${response.status}`);
			return null;
		}

		const body = await response.json<BrowserRunMarkdownSuccessResponse | BrowserRunErrorResponse>();
		if (!body.success || !("result" in body) || !body.result?.trim()) {
			const errorMsg = !body.success && "errors" in body
				? body.errors.map((e) => e.message).join("; ")
				: "empty result";
			console.warn(`[${logPrefix}] Browser Run markdown Quick Action returned no content for ${redactUrlForLog(url)}: ${errorMsg}`);
			return null;
		}

		return body.result.slice(0, MAX_MARKDOWN_LENGTH);
	} catch (e) {
		console.warn(`[${logPrefix}] Browser Run markdown Quick Action error for ${redactUrlForLog(url)}:`, redactUrlsInText((e as Error).message));
		return null;
	}
}

/**
 * Fetch structured JSON data from a web page via the Browser Run `/json` Quick Action.
 * Navigates to the URL, renders the page, and uses AI to extract structured data
 * matching the provided prompt and JSON schema in a single call.
 *
 * Returns the parsed result object, or null if extraction fails.
 */
export async function fetchJson<T = Record<string, unknown>>(
	browser: BrowserRun,
	url: string,
	prompt: string,
	schema: Record<string, unknown>,
	logPrefix: string,
): Promise<T | null> {
	try {
		const response = await browser.quickAction("json", {
			url,
			prompt,
			response_format: { type: "json_schema", json_schema: { name: "extraction", schema } },
			gotoOptions: { waitUntil: "domcontentloaded" },
		});

		if (!response.ok) {
			console.warn(`[${logPrefix}] Browser Run json Quick Action failed for ${redactUrlForLog(url)}: HTTP ${response.status}`);
			return null;
		}

		const body = await response.json<BrowserRunJsonSuccessResponse | BrowserRunErrorResponse>();
		if (!body.success || !("result" in body) || !body.result) {
			const errorMsg = !body.success && "errors" in body
				? body.errors.map((e) => e.message).join("; ")
				: "empty result";
			console.warn(`[${logPrefix}] Browser Run json Quick Action returned no data for ${redactUrlForLog(url)}: ${errorMsg}`);
			return null;
		}

		return body.result as T;
	} catch (e) {
		console.warn(`[${logPrefix}] Browser Run json Quick Action error for ${redactUrlForLog(url)}:`, redactUrlsInText((e as Error).message));
		return null;
	}
}
