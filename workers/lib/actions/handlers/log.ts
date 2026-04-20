import type { ActionContext, ActionHandler } from "../types";

/**
 * Simple logging action — useful as a template for new handlers
 * and for testing that the routing system works end-to-end.
 */
export const handleLog: ActionHandler = async (ctx: ActionContext) => {
	console.log(`[Action:${ctx.tag}] From: ${ctx.sender}, Subject: "${ctx.subject}"`);
	console.log(`[Action:${ctx.tag}] Body preview: ${ctx.body.slice(0, 200)}`);
};
