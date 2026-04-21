import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [TWITTER] action handler.
 *
 * Saves a Twitter content idea to Notion with Content Category "Twitter".
 *
 * Usage: Send an email with subject "[TWITTER] Cool thread about edge computing https://x.com/..."
 */
export const handleTwitter: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "Twitter",
		promptHint: "content the user wants to share or promote on Twitter",
	});
};
