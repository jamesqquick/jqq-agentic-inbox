import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [VIDEO] action handler.
 *
 * Saves a content idea to the Notion Content database with Category "YouTube"
 * as an initial format hint. A single parent Content item is created at
 * Status = "Idea"; output-specific sub-pages are produced later in the pipeline.
 *
 * Usage: Send an email with subject "[VIDEO] Cool video idea about edge computing"
 */
export const handleVideo: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "YouTube",
		promptHint: "a YouTube video idea the user wants to create",
	});
};
