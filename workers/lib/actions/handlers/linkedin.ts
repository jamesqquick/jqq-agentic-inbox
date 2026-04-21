import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [LINKEDIN] action handler.
 *
 * Saves a LinkedIn content idea to Notion with Content Category "LinkedIn".
 *
 * Usage: Send an email with subject "[LINKEDIN] Post about our new AI workflow"
 */
export const handleLinkedin: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "LinkedIn",
		promptHint: "content the user wants to share or promote on LinkedIn",
	});
};
