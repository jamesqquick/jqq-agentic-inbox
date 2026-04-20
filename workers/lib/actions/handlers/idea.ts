import type { ActionContext, ActionHandler } from "../types";
import { createNotionTodo } from "../../notion";
import { sendEmail } from "../../../email-sender";
import { getMailboxStub, generateMessageId, escapeHtml } from "../../email-helpers";
import { Folders } from "../../../../shared/folders";

/**
 * [IDEA] action handler.
 *
 * Saves an idea to the Notion To-Do database and sends a confirmation
 * email back to the sender with a link to the Notion page.
 *
 * Usage: Send an email with subject "[IDEA] Your idea title here"
 * The email body (if any) is added as page content in Notion.
 */
export const handleIdea: ActionHandler = async (ctx: ActionContext) => {
	const notionApiKey = ctx.env.NOTION_API_KEY;
	if (!notionApiKey) {
		console.error("[Idea] NOTION_API_KEY secret is not configured, skipping");
		return;
	}

	const ideaTitle = ctx.subject.trim();
	if (!ideaTitle) {
		console.warn(`[Idea] Empty subject after tag removal for email ${ctx.emailId}, skipping`);
		return;
	}

	console.log(`[Idea] Saving idea: "${ideaTitle}"`);

	// Create the Notion To-Do item
	const result = await createNotionTodo(notionApiKey, {
		name: ideaTitle,
		status: "Next Up",
		priority: "Medium",
		bodyText: ctx.body || undefined,
	});

	console.log(`[Idea] Created Notion page: ${result.url}`);

	// Send a confirmation reply email
	const fromDomain = ctx.mailboxId.split("@")[1];
	if (!fromDomain) {
		console.error(`[Idea] Invalid mailbox address: ${ctx.mailboxId}`);
		return;
	}

	const replySubject = `Saved: ${ideaTitle}`;
	const escapedTitle = escapeHtml(ideaTitle);
	const escapedUrl = escapeHtml(result.url);

	const textBody = `Saved to Notion: "${ideaTitle}"\n\nView it here: ${result.url}`;
	const htmlBody = `
		<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px;">
			<p>Saved to Notion: <strong>${escapedTitle}</strong></p>
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
