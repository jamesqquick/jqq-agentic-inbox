import type { Env } from "../../types";
import { getActionHandler } from "./registry";

const TAG_REGEX = /^\[([A-Z][A-Z0-9_]*)\]\s*/;

/**
 * Parse a `[TAG]` prefix from the beginning of an email subject line.
 * Returns the tag and the cleaned subject (tag stripped), or null if no tag found.
 */
export function parseSubjectTag(subject: string): { tag: string; cleanSubject: string } | null {
	const match = subject.match(TAG_REGEX);
	if (!match) return null;
	return { tag: match[1], cleanSubject: subject.slice(match[0].length) };
}

/**
 * Route an inbound email to a custom action handler based on its subject tag.
 * If no tag is present or no handler is registered, this is a no-op.
 */
export async function routeEmailAction(params: {
	emailId: string;
	subject: string;
	tag: string;
	cleanSubject: string;
	body: string;
	sender: string;
	recipient: string;
	mailboxId: string;
	env: Env;
}): Promise<void> {
	const handler = getActionHandler(params.tag);
	if (!handler) {
		console.log(`[Actions] Unknown tag: [${params.tag}], ignoring`);
		return;
	}

	console.log(`[Actions] Dispatching [${params.tag}] action for email ${params.emailId} (sender: ${params.sender}, subject: "${params.cleanSubject}")`);

	await handler({
		emailId: params.emailId,
		subject: params.cleanSubject,
		tag: params.tag,
		body: params.body,
		sender: params.sender,
		recipient: params.recipient,
		mailboxId: params.mailboxId,
		env: params.env,
	});

	console.log(`[Actions] [${params.tag}] action completed for email ${params.emailId}`);
}
