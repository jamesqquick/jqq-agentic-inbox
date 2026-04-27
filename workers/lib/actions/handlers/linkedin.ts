import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [LINKEDIN] action handler.
 *
 * Saves a content idea to the Notion Content database with Category "LinkedIn"
 * as an initial format hint. A single parent Content item is created at
 * Status = "Idea"; output-specific sub-pages are produced later in the pipeline.
 *
 * Usage: Send an email with subject "[LINKEDIN] Post about our new AI workflow"
 */
export const handleLinkedin: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "LinkedIn",
		promptHint: "content the user wants to share or promote on LinkedIn",
	});
};
