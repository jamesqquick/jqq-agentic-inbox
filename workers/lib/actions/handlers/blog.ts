import type { ActionHandler } from "../types";
import { handleContentIdea } from "./content-idea";

/**
 * [BLOG] action handler.
 *
 * Saves a content idea to the Notion Content database with Category "Blog Post"
 * as an initial format hint. A single parent Content item is created at
 * Status = "Idea"; output-specific sub-pages are produced later in the pipeline.
 *
 * Usage: Send an email with subject "[BLOG] How to build an MCP server on Cloudflare"
 */
export const handleBlog: ActionHandler = async (ctx) => {
	await handleContentIdea(ctx, {
		category: "Blog Post",
		promptHint: "a blog post idea the user wants to write",
	});
};
