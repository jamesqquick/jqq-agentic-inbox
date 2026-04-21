import type { ActionContext } from "../types";
import type { NotionContentCategory } from "../../notion";
import { createNotionTodo } from "../../notion";
import { sendEmail } from "../../../email-sender";
import { getMailboxStub, generateMessageId, escapeHtml } from "../../email-helpers";
import { Folders } from "../../../../shared/folders";

const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

/**
 * Extract unique URLs from the email subject and body.
 */
function extractLinks(subject: string, body: string): string[] {
	const urls = new Set<string>();
	for (const match of subject.matchAll(URL_REGEX)) urls.add(match[0]);
	for (const match of body.matchAll(URL_REGEX)) urls.add(match[0]);
	return [...urls];
}

/**
 * Use Workers AI to generate a concise title and description from the raw
 * email subject and body. Falls back to the raw subject if AI fails.
 */
async function generateIdeaSummary(
	ai: any,
	subject: string,
	body: string,
	promptHint: string,
): Promise<{ title: string; description: string }> {
	try {
		const prompt = `Given the following idea submitted via email (this is ${promptHint}), generate:
1. A short title (max 10 words, concise and actionable)
2. A brief description (1-2 sentences summarizing the core idea)

Subject: ${subject}
${body ? `Body: ${body}` : ""}

Respond in JSON format only, no other text: {"title": "...", "description": "..."}`;

		const aiResponse = await ai.run("@cf/meta/llama-3.1-8b-instruct-fast" as any, {
			messages: [
				{
					role: "system",
					content: "You generate concise titles and descriptions for ideas. Always respond with valid JSON only.",
				},
				{ role: "user", content: prompt },
			],
		});

		const raw = typeof aiResponse === "string"
			? aiResponse
			: (aiResponse as { response?: string }).response || "";

		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed.title && parsed.description) {
				console.log(`[ContentIdea] AI generated title: "${parsed.title}"`);
				return { title: parsed.title, description: parsed.description };
			}
		}

		console.warn("[ContentIdea] AI response did not contain valid JSON, using raw subject");
	} catch (e) {
		console.warn("[ContentIdea] AI summary generation failed, using raw subject:", (e as Error).message);
	}

	return { title: subject, description: body || "" };
}

export interface ContentIdeaOptions {
	/** Notion Content Category value (e.g. "Twitter", "Blog Post"). Omit for uncategorized ideas. */
	category?: NotionContentCategory;
	/** Context hint for the AI prompt (e.g. "content the user wants to share on Twitter"). */
	promptHint: string;
}

/**
 * Shared handler for content idea actions ([IDEA], [TWITTER], etc.).
 *
 * 1. Extracts links from the email subject + body
 * 2. Uses Workers AI to generate a concise title and description
 * 3. Creates a Notion To-Do page with status "Idea", optional category, and reference links
 * 4. Sends a confirmation reply email with the Notion page link
 */
export async function handleContentIdea(
	ctx: ActionContext,
	options: ContentIdeaOptions,
): Promise<void> {
	const notionApiKey = ctx.env.NOTION_API_KEY;
	if (!notionApiKey) {
		console.error(`[${ctx.tag}] NOTION_API_KEY secret is not configured, skipping`);
		return;
	}

	const notionDatabaseId = ctx.env.NOTION_DATABASE_ID;
	if (!notionDatabaseId) {
		console.error(`[${ctx.tag}] NOTION_DATABASE_ID is not configured, skipping`);
		return;
	}

	const rawSubject = ctx.subject.trim();
	if (!rawSubject) {
		console.warn(`[${ctx.tag}] Empty subject after tag removal for email ${ctx.emailId}, skipping`);
		return;
	}

	console.log(`[${ctx.tag}] Processing: "${rawSubject}" (emailId: ${ctx.emailId}, sender: ${ctx.sender})`);

	// Extract any URLs from the email
	const links = extractLinks(rawSubject, ctx.body);
	if (links.length > 0) {
		console.log(`[${ctx.tag}] Found ${links.length} reference link(s): ${links.join(", ")}`);
	}

	// Generate a concise title and description with AI
	const { title: ideaTitle, description: ideaDescription } = await generateIdeaSummary(
		ctx.env.AI,
		rawSubject,
		ctx.body,
		options.promptHint,
	);

	// Create the Notion To-Do item
	let result;
	try {
		result = await createNotionTodo(notionApiKey, notionDatabaseId, {
			name: ideaTitle,
			status: "Idea",
			category: options.category,
			bodyText: ideaDescription || undefined,
			links: links.length > 0 ? links : undefined,
		});
	} catch (e) {
		console.error(`[${ctx.tag}] Failed to create Notion page:`, (e as Error).message);
		return;
	}

	console.log(`[${ctx.tag}] Created Notion page: ${result.id} — ${result.url}`);

	// Send a confirmation reply email
	const fromDomain = ctx.mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`[${ctx.tag}] Invalid mailbox address: ${ctx.mailboxId}`);
		return;
	}

	const replySubject = `Saved: ${ideaTitle}`;
	const escapedTitle = escapeHtml(ideaTitle);
	const escapedDescription = escapeHtml(ideaDescription);
	const escapedUrl = escapeHtml(result.url);
	const categoryLabel = options.category ? ` (${options.category})` : "";

	const textBody = `Saved to Notion${categoryLabel}: "${ideaTitle}"\n\n${ideaDescription}\n\nView it here: ${result.url}`;
	const htmlBody = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>Saved to Notion${escapeHtml(categoryLabel)}: <strong>${escapedTitle}</strong></p>
			${escapedDescription ? `<p style="color: #555;">${escapedDescription}</p>` : ""}
			<p><a href="${escapedUrl}">View in Notion</a></p>
		</div>
	`.trim();

	const { messageId, outgoingMessageId } = generateMessageId(fromDomain);
	const stub = getMailboxStub(ctx.env, ctx.mailboxId);

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

	console.log(`[${ctx.tag}] Sent confirmation to ${ctx.sender}`);
}
