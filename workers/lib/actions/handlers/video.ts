import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [VIDEO] action handler.
 *
 * Saves a YouTube video content idea to Notion with Content Category "YouTube".
 *
 * Usage: Send an email with subject "[VIDEO] Cool video idea about edge computing"
 */
export const handleVideo: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "YouTube",
		promptHint: "a YouTube video idea the user wants to create",
	});
};
