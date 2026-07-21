/**
 * Morning Digest
 *
 * Sends a once-per-day email listing Notion Content items currently in
 * `Status = "Idea"` so you can decide which ones to move to the next stage.
 *
 * Triggered by the Worker's cron (see wrangler.jsonc `triggers.crons`).
 * Skips sending entirely when there are no Idea items.
 */
import type { Env } from "../types";
import { queryContentPipeline, type NotionQueryResponse } from "./notion";
import { sendEmail } from "../email-sender";
import { sendSms } from "./sent-sms";
import { escapeHtml } from "./email-helpers";

const DIGEST_RECIPIENT = "me@jamesqquick.com";
const DIGEST_SENDER = "agent@jamesqquick.com";
const MAX_ITEMS = 10;

interface DigestItem {
	title: string;
	url: string;
}

/**
 * Extract the title string from a Notion page result. Returns "(untitled)" if
 * the title is missing or empty.
 */
function extractTitle(page: NotionQueryResponse["results"][number]): string {
	const titleProp = page.properties?.Title;
	const parts = titleProp?.title as Array<{ plain_text?: string }> | undefined;
	if (!parts || parts.length === 0) return "(untitled)";
	const joined = parts.map((p) => p.plain_text ?? "").join("").trim();
	return joined.length > 0 ? joined : "(untitled)";
}

function renderTextBody(items: DigestItem[]): string {
	const lines = [
		`You have ${items.length} idea${items.length === 1 ? "" : "s"} ready for direction.`,
		"",
	];
	for (const item of items) {
		lines.push(`• ${item.title}`);
		lines.push(`  ${item.url}`);
	}
	return lines.join("\n");
}

function renderHtmlBody(items: DigestItem[]): string {
	const listItems = items
		.map(
			(item) =>
				`<li style="margin-bottom: 6px;"><a href="${escapeHtml(item.url)}">${escapeHtml(item.title)}</a></li>`,
		)
		.join("");

	return `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>You have <strong>${items.length}</strong> idea${items.length === 1 ? "" : "s"} ready for direction.</p>
			<ul style="padding-left: 20px;">${listItems}</ul>
		</div>
	`.trim();
}

/**
 * Run the morning digest: query Notion for Idea-status Content items, and
 * email a summary of up to MAX_ITEMS titles (linked) if any exist.
 */
export async function runMorningDigest(env: Env): Promise<void> {
	console.log("[Digest] Starting morning digest run");
	const apiKey = env.NOTION_API_KEY;
	if (!apiKey) {
		console.error("[Digest] NOTION_API_KEY is not configured, skipping");
		return;
	}

	const databaseId = env.CONTENT_PIPELINE_DB_ID;
	if (!databaseId) {
		console.error("[Digest] CONTENT_PIPELINE_DB_ID is not configured, skipping");
		return;
	}

	console.log("[Digest] Querying Content DB for Idea items");

	let response: NotionQueryResponse;
	try {
		response = await queryContentPipeline(apiKey, databaseId, { status: "Idea" });
	} catch (e) {
		console.error("[Digest] Notion query failed:", (e as Error).message);
		return;
	}

	const totalFound = response.results.length;
	console.log(`[Digest] Found ${totalFound} Idea item(s)${response.has_more ? " (more available, not fetched)" : ""}`);

	if (totalFound === 0) {
		console.log("[Digest] No Idea items, skipping send");
		return;
	}

	const items: DigestItem[] = response.results.slice(0, MAX_ITEMS).map((page) => ({
		title: extractTitle(page),
		url: page.url,
	}));

	const subject = `Morning Digest — ${items.length} idea${items.length === 1 ? "" : "s"} ready for direction`;
	const textBody = renderTextBody(items);
	const htmlBody = renderHtmlBody(items);

	try {
		const result = await sendEmail(env.EMAIL, {
			to: DIGEST_RECIPIENT,
			from: DIGEST_SENDER,
			subject,
			text: textBody,
			html: htmlBody,
		});
		console.log(`[Digest] Sent digest to ${DIGEST_RECIPIENT}, messageId=${result.messageId}`);
	} catch (e) {
		console.error("[Digest] Send failed:", (e as Error).message);
	}

	// Additive SMS nudge via Sent.dm. Never blocks the email above.
	if (!env.SENT_API_KEY || !env.SENT_TEMPLATE_ID || !env.DIGEST_SMS_RECIPIENT) {
		console.log("[Digest] Sent SMS not configured, skipping text notification");
		return;
	}

	try {
		const sms = await sendSms(env, {
			to: env.DIGEST_SMS_RECIPIENT,
			templateId: env.SENT_TEMPLATE_ID,
			parameters: { count: String(items.length) },
		});
		console.log(`[Digest] Sent SMS to ${env.DIGEST_SMS_RECIPIENT}, messageId=${sms.messageId}`);
	} catch (e) {
		console.error("[Digest] SMS send failed:", (e as Error).message);
	}
}
