import type { ActionContext, ActionHandler } from "../types";
import type { CfpContentType, CfpTalkIdea } from "../../notion";
import { createCfpItem } from "../../notion";
import { sendEmail } from "../../../email-sender";
import { getMailboxStub, generateMessageId, escapeHtml, stripHtmlToText } from "../../email-helpers";
import { Folders } from "../../../../shared/folders";

const URL_REGEX = /https?:\/\/[^\s<>"]+/g;
const MAX_PAGE_TEXT_LENGTH = 8000;

/**
 * Extract URLs from the cleaned subject line and email body.
 */
function extractUrls(subject: string, body: string): string[] {
	const urls = new Set<string>();
	for (const match of subject.matchAll(URL_REGEX)) urls.add(match[0]);
	for (const match of body.matchAll(URL_REGEX)) urls.add(match[0]);
	return [...urls];
}

/**
 * Fetch a web page and return its text content.
 */
async function fetchPageText(url: string): Promise<string | null> {
	try {
		const response = await fetch(url, {
			headers: { "User-Agent": "Mozilla/5.0 (compatible; CFPTrackerBot/1.0)" },
			redirect: "follow",
		});

		if (!response.ok) {
			console.warn(`[CFP] Failed to fetch ${url}: ${response.status}`);
			return null;
		}

		const contentType = response.headers.get("content-type") || "";
		if (!contentType.includes("text/html") && !contentType.includes("text/plain")) {
			console.warn(`[CFP] Unsupported content type for ${url}: ${contentType}`);
			return null;
		}

		const html = await response.text();
		const text = stripHtmlToText(html);
		return text.slice(0, MAX_PAGE_TEXT_LENGTH);
	} catch (e) {
		console.error(`[CFP] Error fetching ${url}:`, (e as Error).message);
		return null;
	}
}

/**
 * Valid content type values for the CFP database.
 * Used to filter AI output to only valid multi_select options.
 */
const VALID_CONTENT_TYPES = new Set<CfpContentType>([
	"Talk", "Workshop", "Lightning Talk", "Panel", "Keynote", "Other",
]);

/**
 * Parse the AI response JSON, with fallback for malformed output.
 */
function parseAiResponse(raw: string): {
	title: string;
	deadline: string;
	description: string;
	contentTypes: CfpContentType[];
	notes: string;
} | null {
	try {
		const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
		const parsed = JSON.parse(cleaned);
		return {
			title: parsed.title || "",
			deadline: parsed.deadline || "",
			description: parsed.description || "",
			contentTypes: (parsed.contentTypes || []).filter((t: string) => VALID_CONTENT_TYPES.has(t as CfpContentType)),
			notes: parsed.notes || "",
		};
	} catch {
		return null;
	}
}

/**
 * Parse the brainstorming AI response into structured talk ideas.
 */
function parseTalkIdeas(raw: string): CfpTalkIdea[] {
	try {
		const cleaned = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
		const parsed = JSON.parse(cleaned);
		const ideas = Array.isArray(parsed) ? parsed : parsed.ideas || [];
		return ideas
			.filter((idea: any) => idea.title && idea.pitch)
			.map((idea: any) => ({
				title: String(idea.title),
				pitch: String(idea.pitch),
				contentType: idea.contentType ? String(idea.contentType) : undefined,
			}));
	} catch {
		return [];
	}
}

/**
 * Brainstorm talk ideas based on CFP details and speaker expertise.
 * Returns structured ideas or an empty array if AI fails.
 */
async function brainstormTalkIdeas(
	ai: any,
	cfpTitle: string,
	cfpDescription: string | undefined,
	cfpNotes: string | undefined,
	cfpContentTypes: CfpContentType[] | undefined,
): Promise<CfpTalkIdea[]> {
	const cfpContext = [
		`Conference: ${cfpTitle}`,
		cfpDescription ? `Description: ${cfpDescription}` : "",
		cfpNotes ? `Additional context: ${cfpNotes}` : "",
		cfpContentTypes?.length ? `Accepted formats: ${cfpContentTypes.join(", ")}` : "",
	].filter(Boolean).join("\n");

	try {
		const response = await ai.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
			messages: [
				{
					role: "system",
					content: `You are a talk proposal brainstorming assistant for a developer advocate and content creator.

The speaker's expertise areas:
- AI agents and agentic workflows (building with LLMs, tool calling, agent orchestration)
- Content creation with AI (automated pipelines, AI-assisted writing, video production)
- Cloudflare developer platform (Workers, Pages, D1, R2, Durable Objects, KV, AI Gateway, Agents SDK, Workflows)
- Web development and developer tooling (TypeScript, React, full-stack)
- Developer education and community building (YouTube, courses, workshops)

Generate 3-5 talk ideas that would be a strong fit for the conference described below. Each idea should connect the speaker's expertise to what the conference is looking for.

Return ONLY valid JSON (no markdown, no explanation):
[
  {
    "title": "Proposed talk title",
    "pitch": "1-2 sentence pitch explaining the angle and why it fits this conference",
    "contentType": "Talk, Workshop, Lightning Talk, etc. — pick the best format"
  }
]

Be creative and specific. Avoid generic titles. Each idea should have a distinct angle.`,
				},
				{
					role: "user",
					content: cfpContext,
				},
			],
		});

		const text = typeof response === "string" ? response : (response as { response?: string }).response || "";
		console.log(`[CFP] Brainstorming raw AI response: "${text.slice(0, 500)}"`);
		return parseTalkIdeas(text);
	} catch (e) {
		console.error("[CFP] Talk idea brainstorming failed:", (e as Error).message);
		return [];
	}
}

/**
 * [CFP] action handler.
 *
 * 1. Extracts a URL from the subject or body
 * 2. Fetches the CFP page content
 * 3. Uses AI to extract structured CFP details (title, deadline, description, content types, notes)
 * 4. Creates a CFP item in the Notion CFP database
 * 5. Sends a confirmation reply email
 */
export const handleCfp: ActionHandler = async (ctx: ActionContext) => {
	const notionApiKey = ctx.env.NOTION_API_KEY;
	if (!notionApiKey) {
		console.error("[CFP] NOTION_API_KEY secret is not configured, skipping");
		return;
	}

	const cfpDatabaseId = ctx.env.CFP_DB_ID;
	if (!cfpDatabaseId) {
		console.error("[CFP] CFP_DB_ID is not configured, skipping");
		return;
	}

	const urls = extractUrls(ctx.subject, ctx.body);
	if (urls.length === 0) {
		console.warn(`[CFP] No URL found in email ${ctx.emailId}, skipping`);
		return;
	}

	const cfpUrl = urls[0];
	console.log(`[CFP] Processing CFP URL: ${cfpUrl} (emailId: ${ctx.emailId}, sender: ${ctx.sender})`);

	// Fetch the CFP page
	const pageText = await fetchPageText(cfpUrl);

	// Build context for AI — use page text if available, fall back to email body
	const aiContext = pageText
		? `CFP Page URL: ${cfpUrl}\n\nPage content:\n${pageText}`
		: `CFP Page URL: ${cfpUrl}\n\nEmail body (page could not be fetched):\n${ctx.body}`;

	if (!pageText) {
		console.warn(`[CFP] Could not fetch page text from ${cfpUrl}, using email body as context`);
	}

	// Extract structured CFP details with AI
	console.log(`[CFP] Extracting CFP details with AI — context: ${aiContext.length} chars`);

	const aiResponse = await ctx.env.AI.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
		messages: [
			{
				role: "system",
				content: `You are a helpful assistant that extracts structured information from Call for Proposals (CFP) pages.

Extract the following fields and return ONLY valid JSON (no markdown, no explanation):
{
  "title": "Event or conference name",
  "deadline": "CFP closing date in YYYY-MM-DD format, or empty string if not found",
  "description": "Brief description of the event and what they're looking for (1-3 sentences)",
  "contentTypes": ["array of content types from ONLY these values: Talk, Workshop, Lightning Talk, Panel, Keynote, Other"],
  "notes": "Any other relevant details: topics of interest, speaker benefits, location, dates, audience size, etc."
}

Rules:
- For deadline, convert any date format to YYYY-MM-DD. If only a month/year is given, use the last day of that month. If no deadline is found, use an empty string.
- For contentTypes, only use values from the allowed list. If the page mentions presentations or talks generically, use "Talk". If unclear, use "Other".
- Keep description concise. Put additional details in notes.
- If a field cannot be determined, use an empty string (or empty array for contentTypes).`,
			},
			{
				role: "user",
				content: aiContext,
			},
		],
	});

	const aiText = typeof aiResponse === "string" ? aiResponse : (aiResponse as { response?: string }).response || "";
	const cfpDetails = parseAiResponse(aiText);

	if (!cfpDetails) {
		console.warn("[CFP] AI response did not contain valid JSON, using raw input as fallback");
	}

	// Build Notion params — use AI-extracted data with fallbacks
	const title = cfpDetails?.title || ctx.subject || "Untitled CFP";
	const deadline = cfpDetails?.deadline || undefined;
	const description = cfpDetails?.description || undefined;
	const contentTypes = cfpDetails?.contentTypes?.length ? cfpDetails.contentTypes : undefined;
	const bodyText = cfpDetails?.notes || (ctx.body.trim() ? ctx.body.trim().slice(0, 2000) : undefined);

	// Brainstorm talk ideas based on the extracted CFP details
	console.log(`[CFP] Brainstorming talk ideas for "${title}"`);
	const talkIdeas = await brainstormTalkIdeas(
		ctx.env.AI,
		title,
		description,
		cfpDetails?.notes,
		contentTypes,
	);
	console.log(`[CFP] Generated ${talkIdeas.length} talk idea(s)${talkIdeas.length > 0 ? `: ${talkIdeas.map((i) => `"${i.title}"`).join(", ")}` : ""}`);

	const notionParams = {
		title,
		status: "New" as const,
		deadline,
		url: cfpUrl,
		description,
		contentTypes,
		bodyText,
		talkIdeas: talkIdeas.length > 0 ? talkIdeas : undefined,
	};
	console.log(`[CFP] Creating Notion item — title: "${notionParams.title}", status: "${notionParams.status}", deadline: ${notionParams.deadline ?? "none"}, contentTypes: ${JSON.stringify(notionParams.contentTypes ?? [])}, talkIdeas: ${talkIdeas.length}`);

	let cfpItem;
	try {
		cfpItem = await createCfpItem(notionApiKey, cfpDatabaseId, notionParams);
	} catch (e) {
		console.error("[CFP] Failed to create CFP item:", (e as Error).message);
		return;
	}

	console.log(`[CFP] Created CFP item: ${cfpItem.id} — ${cfpItem.url}`);

	// Send a confirmation reply email
	const fromDomain = ctx.mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`[CFP] Invalid mailbox address: ${ctx.mailboxId}`);
		return;
	}

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = getMailboxStub(ctx.env, ctx.mailboxId);

	const replySubject = `CFP Tracked: ${title}`;
	const deadlineStr = deadline ? `\nDeadline: ${deadline}` : "";
	const contentTypesStr = contentTypes?.length ? `\nContent Types: ${contentTypes.join(", ")}` : "";

	const textBody = `CFP has been added to your tracker.\n\nTitle: ${title}${deadlineStr}${contentTypesStr}\nURL: ${cfpUrl}\n\nNotion: ${cfpItem.url}`;
	const escapedTitle = escapeHtml(title);
	const escapedUrl = escapeHtml(cfpUrl);
	const escapedDeadline = deadline ? escapeHtml(deadline) : null;

	const htmlBody = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>CFP has been added to your tracker.</p>
			<table style="border-collapse: collapse; margin: 12px 0;">
				<tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Title</td><td style="padding: 4px 0;">${escapedTitle}</td></tr>
				${escapedDeadline ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Deadline</td><td style="padding: 4px 0;">${escapedDeadline}</td></tr>` : ""}
				${contentTypes?.length ? `<tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">Content Types</td><td style="padding: 4px 0;">${escapeHtml(contentTypes.join(", "))}</td></tr>` : ""}
				<tr><td style="padding: 4px 12px 4px 0; font-weight: 600;">URL</td><td style="padding: 4px 0;"><a href="${escapedUrl}">${escapedUrl}</a></td></tr>
			</table>
			<p><a href="${escapeHtml(cfpItem.url)}">View in Notion</a></p>
		</div>
	`.trim();

	await stub.createEmail(Folders.SENT, {
		id: messageId,
		subject: replySubject,
		sender: ctx.mailboxId,
		recipient: ctx.sender,
		cc: null,
		bcc: null,
		date: new Date().toISOString(),
		body: htmlBody,
		in_reply_to: ctx.emailId,
		email_references: JSON.stringify([ctx.emailId]),
		thread_id: ctx.emailId,
		message_id: outgoingMessageId,
		raw_headers: JSON.stringify([
			{ key: "from", value: ctx.mailboxId },
			{ key: "to", value: ctx.sender },
			{ key: "subject", value: replySubject },
			{ key: "date", value: new Date().toISOString() },
			{ key: "message-id", value: `<${outgoingMessageId}>` },
			{ key: "in-reply-to", value: `<${ctx.emailId}>` },
			{ key: "references", value: `<${ctx.emailId}>` },
		]),
	}, []);

	await sendEmail(ctx.env.EMAIL, {
		to: ctx.sender,
		from: ctx.mailboxId,
		subject: replySubject,
		text: textBody,
		html: htmlBody,
		headers: {
			"In-Reply-To": `<${ctx.emailId}>`,
			References: `<${ctx.emailId}>`,
		},
	});

	console.log(`[CFP] Sent confirmation to ${ctx.sender} for "${title}"`);
};
