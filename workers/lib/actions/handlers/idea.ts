import type { ActionContext, ActionHandler } from "../types";
import { createNotionTodo } from "../../notion";
import { sendEmail } from "../../../email-sender";
import { getMailboxStub, generateMessageId, escapeHtml } from "../../email-helpers";
import { Folders } from "../../../../shared/folders";

/**
 * Use Workers AI to generate a concise title and description from the raw
 * email subject and body. Falls back to the raw subject if AI fails.
 */
async function generateIdeaSummary(
	ai: any,
	subject: string,
	body: string,
): Promise<{ title: string; description: string }> {
	try {
		const prompt = `Given the following idea submitted via email, generate:
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

		// Extract JSON from the response (in case the model wraps it in markdown)
		const jsonMatch = raw.match(/\{[\s\S]*\}/);
		if (jsonMatch) {
			const parsed = JSON.parse(jsonMatch[0]);
			if (parsed.title && parsed.description) {
				console.log(`[Idea] AI generated title: "${parsed.title}"`);
				return { title: parsed.title, description: parsed.description };
			}
		}

		console.warn("[Idea] AI response did not contain valid JSON, using raw subject");
	} catch (e) {
		console.warn("[Idea] AI summary generation failed, using raw subject:", (e as Error).message);
	}

	// Fallback: use the raw subject as title, body as description
	return { title: subject, description: body || "" };
}

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
 * [IDEA] action handler.
 *
 * Uses Workers AI to generate a concise title and description, then saves
 * the idea to the Notion To-Do database with status "Idea" and sends a
 * confirmation email back to the sender with a link to the Notion page.
 * Any URLs found in the email are added as a "References" section.
 *
 * Usage: Send an email with subject "[IDEA] Your idea details here"
 * The email body (if any) provides additional context for the AI.
 */
export const handleIdea: ActionHandler = async (ctx: ActionContext) => {
	const notionApiKey = ctx.env.NOTION_API_KEY;
	if (!notionApiKey) {
		console.error("[Idea] NOTION_API_KEY secret is not configured, skipping");
		return;
	}

	const notionDatabaseId = ctx.env.NOTION_DATABASE_ID;
	if (!notionDatabaseId) {
		console.error("[Idea] NOTION_DATABASE_ID is not configured, skipping");
		return;
	}

	const rawSubject = ctx.subject.trim();
	if (!rawSubject) {
		console.warn(`[Idea] Empty subject after tag removal for email ${ctx.emailId}, skipping`);
		return;
	}

	console.log(`[Idea] Processing idea: "${rawSubject}" (emailId: ${ctx.emailId}, sender: ${ctx.sender})`);

	// Extract any URLs from the email
	const links = extractLinks(rawSubject, ctx.body);
	if (links.length > 0) {
		console.log(`[Idea] Found ${links.length} reference link(s): ${links.join(", ")}`);
	}

	// Generate a concise title and description with AI
	const { title: ideaTitle, description: ideaDescription } = await generateIdeaSummary(
		ctx.env.AI,
		rawSubject,
		ctx.body,
	);

	// Create the Notion To-Do item
	let result;
	try {
		result = await createNotionTodo(notionApiKey, notionDatabaseId, {
			name: ideaTitle,
			status: "Idea",
			bodyText: ideaDescription || undefined,
			links: links.length > 0 ? links : undefined,
		});
	} catch (e) {
		console.error(`[Idea] Failed to create Notion page:`, (e as Error).message);
		return;
	}

	console.log(`[Idea] Created Notion page: ${result.id} — ${result.url}`);

	// Send a confirmation reply email
	const fromDomain = ctx.mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`[Idea] Invalid mailbox address: ${ctx.mailboxId}`);
		return;
	}

	const replySubject = `Saved: ${ideaTitle}`;
	const escapedTitle = escapeHtml(ideaTitle);
	const escapedDescription = escapeHtml(ideaDescription);
	const escapedUrl = escapeHtml(result.url);

	const textBody = `Saved to Notion: "${ideaTitle}"\n\n${ideaDescription}\n\nView it here: ${result.url}`;
	const htmlBody = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>Saved to Notion: <strong>${escapedTitle}</strong></p>
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

	console.log(`[Idea] Sent confirmation to ${ctx.sender}`);
};
