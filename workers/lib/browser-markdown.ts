import puppeteer, { type BrowserWorker } from "@cloudflare/puppeteer";

const BROWSER_RENDER_TIMEOUT_MS = 10_000;
const MAX_HTML_INPUT_LENGTH = 200_000;
const MAX_MARKDOWN_INPUT_LENGTH = 8000;
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

type MarkdownConversionResult = {
	format?: string;
	data?: string;
	error?: string;
};

type BrowserSession = Awaited<ReturnType<typeof puppeteer.launch>>;

function browserWorkerFromFetcher(fetcher: Fetcher): BrowserWorker {
	return { fetch: fetcher.fetch.bind(fetcher) as typeof fetch };
}

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

export class BrowserMarkdownSession {
	private constructor(
		private readonly browser: BrowserSession,
		private readonly ai: Ai,
	) {}

	static async create(browserFetcher: Fetcher, ai: Ai): Promise<BrowserMarkdownSession> {
		const browser = await puppeteer.launch(browserWorkerFromFetcher(browserFetcher));
		return new BrowserMarkdownSession(browser, ai);
	}

	async fetchMarkdown(url: string, logPrefix: string): Promise<string | null> {
		let page: Awaited<ReturnType<BrowserSession["newPage"]>> | null = null;

		try {
			page = await this.browser.newPage();
			const response = await page.goto(url, {
				waitUntil: "domcontentloaded",
				timeout: BROWSER_RENDER_TIMEOUT_MS,
			});
			if (!response || !response.ok()) {
				console.warn(`[${logPrefix}] Browser Run received an unsuccessful response for ${redactUrlForLog(url)}: ${response?.status() ?? "no response"}`);
				return null;
			}
			const contentLength = Number(response.headers()["content-length"] || 0);
			if (contentLength > MAX_HTML_INPUT_LENGTH) {
				console.warn(`[${logPrefix}] Browser Run response too large for ${redactUrlForLog(url)}: ${contentLength} bytes`);
				return null;
			}

			const html = await page.evaluate((maxLength) => {
				const root = document.body || document.documentElement;
				const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				let text = "";

				while (text.length < maxLength) {
					const node = walker.nextNode();
					if (!node) break;

					const value = node.textContent?.replace(/\s+/g, " ").trim();
					if (!value) continue;

					const remaining = maxLength - text.length;
					text += `${value.slice(0, remaining)}\n`;
				}

				const escaped = text
					.replace(/&/g, "&amp;")
					.replace(/</g, "&lt;")
					.replace(/>/g, "&gt;")
					.replace(/"/g, "&quot;");

				return `<main><pre>${escaped}</pre></main>`;
			}, MAX_HTML_INPUT_LENGTH);
			if (!html.trim()) {
				console.warn(`[${logPrefix}] Browser Run returned no HTML for ${redactUrlForLog(url)}`);
				return null;
			}

			const markdown = await this.ai.toMarkdown({
				name: "page.html",
				blob: new Blob([html], { type: "text/html" }),
			}) as MarkdownConversionResult;

			if (!markdown.data?.trim()) {
				console.warn(`[${logPrefix}] AI markdown conversion returned no content for ${redactUrlForLog(url)}${markdown.error ? `: ${redactUrlsInText(markdown.error)}` : ""}`);
				return null;
			}

			return markdown.data.slice(0, MAX_MARKDOWN_INPUT_LENGTH);
		} catch (e) {
			console.warn(`[${logPrefix}] Browser Run binding error for ${redactUrlForLog(url)}:`, redactUrlsInText((e as Error).message));
			return null;
		} finally {
			if (page) {
				await page.close().catch((e) => {
					console.warn(`[${logPrefix}] Failed to close Browser Run page for ${redactUrlForLog(url)}:`, redactUrlsInText((e as Error).message));
				});
			}
		}
	}

	async close(logPrefix: string): Promise<void> {
		await this.browser.close().catch((e) => {
			console.warn(`[${logPrefix}] Failed to close Browser Run session:`, redactUrlsInText((e as Error).message));
		});
	}
}
