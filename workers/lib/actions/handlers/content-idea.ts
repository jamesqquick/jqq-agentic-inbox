import type { ActionContext } from "../types";
import type { NotionContentCategory } from "../../notion";
import { createNotionTodo, createContentItem } from "../../notion";
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

		console.warn("[ContentIdea] AI response did not contain valid JSON, using raw input");
	} catch (e) {
		console.warn("[ContentIdea] AI summary generation failed, using raw input:", (e as Error).message);
	}

	// Fallback: use subject if available, otherwise truncate body for title
	const fallbackTitle = subject && subject !== "(see body)"
		? subject
		: body.substring(0, 80).trim() || "Untitled idea";
	return { title: fallbackTitle, description: body || "" };
}

export interface ContentIdeaOptions {
	/** Notion Content Category value (e.g. "Twitter", "Blog Post"). Omit for uncategorized ideas. */
	category?: NotionContentCategory;
	/** Context hint for the AI prompt (e.g. "content the user wants to share on Twitter"). */
	promptHint: string;
}

/**
 * Shared handler for content idea actions ([IDEA], [VIDEO], [BLOG], [TWITTER], etc.).
 *
 * 1. Extracts links from the email subject + body
 * 2. Uses Workers AI to generate a concise title and description
 * 3. Creates a Content Pipeline item in Notion (status "Idea") with reference links
 * 4. Creates a linked To-Do item ("Decide direction: {title}") for visibility in the todo list
 * 5. Sends a confirmation reply email with links to both Notion pages
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

	const todoDatabaseId = ctx.env.NOTION_DATABASE_ID;
	if (!todoDatabaseId) {
		console.error(`[${ctx.tag}] NOTION_DATABASE_ID is not configured, skipping`);
		return;
	}

	const pipelineDatabaseId = ctx.env.CONTENT_PIPELINE_DB_ID;
	if (!pipelineDatabaseId) {
		console.error(`[${ctx.tag}] CONTENT_PIPELINE_DB_ID is not configured, skipping`);
		return;
	}

	const rawSubject = ctx.subject.trim();
	const hasSubject = rawSubject.length > 0;
	const hasBody = ctx.body.trim().length > 0;

	if (!hasSubject && !hasBody) {
		console.warn(`[${ctx.tag}] Empty subject and body for email ${ctx.emailId}, skipping`);
		return;
	}

	console.log(`[${ctx.tag}] Processing: subject="${rawSubject || "(empty)"}", body=${ctx.body.length} chars (emailId: ${ctx.emailId}, sender: ${ctx.sender})`);
	if (hasBody) {
		console.log(`[${ctx.tag}] Body preview: "${ctx.body.substring(0, 200)}"`);
	}

	// Extract any URLs from the email
	const links = extractLinks(rawSubject, ctx.body);
	console.log(`[${ctx.tag}] Extracted ${links.length} link(s) from subject+body${links.length > 0 ? `: ${links.join(", ")}` : ""}`);

	// Generate a concise title and description with AI
	// Use body as the primary input if subject is empty
	const aiSubjectInput = hasSubject ? rawSubject : "(see body)";
	const aiBodyInput = ctx.body;
	const { title: ideaTitle, description: ideaDescription } = await generateIdeaSummary(
		ctx.env.AI,
		aiSubjectInput,
		aiBodyInput,
		options.promptHint,
	);

	// Step 1: Create the Content Pipeline item
	const sourceUrl = links[0] || undefined;
	console.log(`[${ctx.tag}] Source URL for Notion: ${sourceUrl ?? "(none)"}`);

	let contentItem;
	try {
		contentItem = await createContentItem(notionApiKey, pipelineDatabaseId, {
			title: ideaTitle,
			pipelineStatus: "Idea",
			category: options.category,
			source: sourceUrl,
			bodyText: ideaDescription || undefined,
			links: links.length > 0 ? links : undefined,
			inputEmails: ctx.emailId,
		});
	} catch (e) {
		console.error(`[${ctx.tag}] Failed to create Content Pipeline item:`, (e as Error).message);
		return;
	}

	console.log(`[${ctx.tag}] Created Content Pipeline item: ${contentItem.id} — ${contentItem.url}`);

	// Step 2: Create a linked To-Do item for the todo list view
	let todoItem;
	try {
		todoItem = await createNotionTodo(notionApiKey, todoDatabaseId, {
			name: `Decide direction: ${ideaTitle}`,
			status: "Next Up",
			category: options.category,
			bodyText: ideaDescription || undefined,
			contentItemId: contentItem.id,
		});
	} catch (e) {
		// Non-fatal: the content pipeline item was created, todo is a nice-to-have
		console.error(`[${ctx.tag}] Failed to create linked To-Do item:`, (e as Error).message);
	}

	if (todoItem) {
		console.log(`[${ctx.tag}] Created linked To-Do item: ${todoItem.id} — ${todoItem.url}`);
	}

	// Step 3: Send a confirmation reply email
	const fromDomain = ctx.mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`[${ctx.tag}] Invalid mailbox address: ${ctx.mailboxId}`);
		return;
	}

	const replySubject = `Saved: ${ideaTitle}`;
	const escapedTitle = escapeHtml(ideaTitle);
	const escapedDescription = escapeHtml(ideaDescription);
	const escapedContentUrl = escapeHtml(contentItem.url);
	const escapedTodoUrl = todoItem ? escapeHtml(todoItem.url) : "";
	const categoryLabel = options.category ? ` (${options.category})` : "";

	const textBody = [
		`Saved to Content Pipeline${categoryLabel}: "${ideaTitle}"`,
		"",
		ideaDescription,
		"",
		`Content Pipeline: ${contentItem.url}`,
		todoItem ? `To-Do Item: ${todoItem.url}` : "",
	].filter(Boolean).join("\n");

	const htmlBody = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>Saved to Content Pipeline${escapeHtml(categoryLabel)}: <strong>${escapedTitle}</strong></p>
			${escapedDescription ? `<p style="color: #555;">${escapedDescription}</p>` : ""}
			<p><a href="${escapedContentUrl}">View in Content Pipeline</a></p>
			${todoItem ? `<p><a href="${escapedTodoUrl}">View To-Do Item</a></p>` : ""}
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
