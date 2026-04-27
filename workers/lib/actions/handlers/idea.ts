import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [IDEA] action handler.
 *
 * Saves a general idea to the Notion Content database with no category. A
 * single parent Content item is created at Status = "Idea"; format and
 * output-specific sub-pages are decided later in the pipeline.
 *
 * Usage: Send an email with subject "[IDEA] Your idea here"
 */
export const handleIdea: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		promptHint: "a general idea or concept",
	});
};
