import type { Env } from "../../types";

export interface ActionContext {
	emailId: string;
	/** The subject line with the [TAG] prefix stripped. */
	subject: string;
	/** The matched tag, e.g. "SUMMARY". */
	tag: string;
	/** Plain-text email body. */
	body: string;
	sender: string;
	recipient: string;
	mailboxId: string;
	env: Env;
}

export type ActionHandler = (ctx: ActionContext) => Promise<void>;
