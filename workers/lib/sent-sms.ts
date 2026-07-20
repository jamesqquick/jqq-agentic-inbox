/**
 * SMS sending via the Sent.dm REST API (https://docs.sent.dm).
 *
 * Sent is template-based: you send to E.164 phone numbers referencing an
 * approved template ID plus parameters. Free-form text is not supported
 * outside a two-way conversation window.
 *
 * Endpoint: POST https://api.sent.dm/v3/messages  (auth via x-api-key header)
 */
import type { Env } from "../types";

const SENT_API_URL = "https://api.sent.dm/v3/messages";

export interface SendSmsParams {
	to: string; // E.164, e.g. "+15125550123"
	templateId: string;
	parameters?: Record<string, string>;
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

interface SentResponse {
	success: boolean;
	data?: { status?: string; recipients?: Array<{ message_id?: string }> };
	error?: { code?: string; message?: string } | null;
}

/**
 * Send a templated SMS via Sent.dm. Forces the `sms` channel.
 *
 * @param env     - Worker env (reads SENT_API_KEY)
 * @param params  - Recipient, template ID, and template parameters
 * @returns The Sent message ID and queue status
 * @throws SentSmsError on non-2xx responses (carries Sent's error code/message)
 */
export async function sendSms(
	env: Env,
	params: SendSmsParams,
): Promise<{ messageId: string | undefined; status: string | undefined }> {
	const body = {
		to: [params.to],
		template: {
			id: params.templateId,
			...(params.parameters ? { parameters: params.parameters } : {}),
		},
		channel: ["sms"],
	};

	console.log(`[SentSMS] Sending — to: ${params.to}, template: ${params.templateId}`);

	const res = await fetch(SENT_API_URL, {
		method: "POST",
		headers: {
			"x-api-key": env.SENT_API_KEY,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	const json = (await res.json().catch(() => null)) as SentResponse | null;

	if (!res.ok || !json?.success) {
		const code = json?.error?.code;
		const message = json?.error?.message ?? `Sent API returned ${res.status}`;
		throw new SentSmsError(res.status, code, message);
	}

	const messageId = json.data?.recipients?.[0]?.message_id;
	const status = json.data?.status;
	console.log(`[SentSMS] Sent — messageId: ${messageId}, status: ${status}`);
	return { messageId, status };
}
