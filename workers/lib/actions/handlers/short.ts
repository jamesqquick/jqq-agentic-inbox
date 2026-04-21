import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [SHORT] action handler.
 *
 * Saves a YouTube Short / Reels / TikTok content idea to Notion with Content Category "YouTube Short".
 *
 * Usage: Send an email with subject "[SHORT] Quick tip about TypeScript generics"
 */
export const handleShort: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "YouTube Short",
		promptHint: "a short-form vertical video idea (YouTube Short, Reel, or TikTok)",
	});
};
