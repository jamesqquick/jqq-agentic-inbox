import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [TWITTER] action handler.
 *
 * Saves a content idea to the Notion Content database with Category "Twitter"
 * as an initial format hint. A single parent Content item is created at
 * Status = "Idea"; output-specific sub-pages are produced later in the pipeline.
 *
 * Usage: Send an email with subject "[TWITTER] Cool thread about edge computing https://x.com/..."
 */
export const handleTwitter: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "Twitter",
		promptHint: "content the user wants to share or promote on Twitter",
	});
};
