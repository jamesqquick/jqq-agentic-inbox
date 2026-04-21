import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [IDEA] action handler.
 *
 * Saves a general idea to Notion with no content category.
 *
 * Usage: Send an email with subject "[IDEA] Your idea here"
 */
export const handleIdea: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		promptHint: "a general idea or concept",
	});
};
