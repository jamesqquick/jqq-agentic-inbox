import type { ActionHandler } from "./types";
import { handleLog } from "./handlers/log";
import { handleSummary } from "./handlers/summary";

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
};

export function getActionHandler(tag: string): ActionHandler | undefined {
	return actionRegistry[tag.toUpperCase()];
}
