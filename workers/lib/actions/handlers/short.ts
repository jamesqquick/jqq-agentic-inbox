import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [SHORT] action handler.
 *
 * Saves a content idea to the Notion Content database with Category "YouTube Short"
 * as an initial format hint. A single parent Content item is created at
 * Status = "Idea"; output-specific sub-pages are produced later in the pipeline.
 *
 * Usage: Send an email with subject "[SHORT] Quick tip about TypeScript generics"
 */
export const handleShort: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "YouTube Short",
		promptHint: "a short-form vertical video idea (YouTube Short, Reel, or TikTok)",
	});
};
