import type { ActionHandler } from "./types";
import { handleLog } from "./handlers/log";
import { handleSummary } from "./handlers/summary";
import { handleIdea } from "./handlers/idea";
import { handleTwitter } from "./handlers/twitter";
import { handleVideo } from "./handlers/video";
import { handleBlog } from "./handlers/blog";
import { handleShort } from "./handlers/short";
import { handleLinkedin } from "./handlers/linkedin";
import { handleCfp } from "./handlers/cfp";
import { handleResource } from "./handlers/resource";

/**
 * Hardcoded mapping of subject-line tags to action handlers.
 *
 * To add a new action:
 * 1. Create a handler in ./handlers/
 * 2. Add the tag → handler entry here
 * 3. Send an email with [TAG] in the subject
 */
const actionRegistry: Record<string, ActionHandler> = {
	LOG: handleLog,
	SUMMARY: handleSummary,
	IDEA: handleIdea,
	TWITTER: handleTwitter,
	VIDEO: handleVideo,
	BLOG: handleBlog,
	SHORT: handleShort,
	LINKEDIN: handleLinkedin,
	CFP: handleCfp,
	RESOURCE: handleResource,
};

const tagFolderNames: Record<string, string> = {
	LOG: "Logs",
	SUMMARY: "Summaries",
	IDEA: "Ideas",
	TWITTER: "Twitter",
	VIDEO: "Videos",
	BLOG: "Blog",
	SHORT: "Shorts",
	LINKEDIN: "LinkedIn",
	CFP: "CFPs",
	RESOURCE: "Resources",
};

export function getActionHandler(tag: string): ActionHandler | undefined {
	return actionRegistry[tag.toUpperCase()];
}

export function getActionFolderName(tag: string): string {
	const normalizedTag = tag.toUpperCase();
	return tagFolderNames[normalizedTag] || normalizedTag.charAt(0) + normalizedTag.slice(1).toLowerCase();
}
