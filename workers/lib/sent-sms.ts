import SentDm from "@sentdm/sentdm";
import type { Env } from "../types";

export interface SendSmsParams {
	to: string; // E.164, e.g. "+15125550123"
	templateId: string;
	parameters?: Record<string, string>;
	sandbox?: boolean;
}

export class SentSmsError extends Error {
	constructor(
		public readonly status: number,
		public readonly code: string | undefined,
		message: string,
	) {
		super(message);
		this.name = "SentSmsError";
	}
}

export async function sendSms(
	env: Env,
	params: SendSmsParams,
): Promise<{ messageId: string | undefined; status: string | undefined }> {
	const client = new SentDm({ apiKey: env.SENT_API_KEY });
	const sandbox = params.sandbox ?? (env.SENT_SANDBOX as string) === "true";

	console.log(
		`[SentSMS] Sending — to: ${params.to}, template: ${params.templateId}${sandbox ? " (sandbox)" : ""}`,
	);

	try {
		const response = await client.messages.send({
			to: [params.to],
			template: {
				id: params.templateId,
				...(params.parameters ? { parameters: params.parameters } : {}),
			},
			channel: ["sms", "whatsapp", "rcs"],
			...(sandbox ? { sandbox: true } : {}),
		});

		const messageId = response.data?.recipients?.[0]?.message_id;
		const status = response.data?.status;
		console.log(`[SentSMS] Sent — messageId: ${messageId}, status: ${status}`);
		return { messageId, status };
	} catch (err) {
		if (err instanceof SentDm.APIError) {
			throw new SentSmsError(err.status, err.constructor.name, err.message);
		}
		throw err;
	}
}
