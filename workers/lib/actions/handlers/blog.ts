import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [BLOG] action handler.
 *
 * Saves a blog post content idea to Notion with Content Category "Blog Post".
 *
 * Usage: Send an email with subject "[BLOG] How to build an MCP server on Cloudflare"
 */
export const handleBlog: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "Blog Post",
		promptHint: "a blog post idea the user wants to write",
	});
};
