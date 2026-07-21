/**
 * Inbound SMS webhook handler for sent.dm.
 *
 * sent.dm POSTs a `message.received` event to /webhooks/sms whenever someone
 * texts one of your provisioned numbers. This module verifies the HMAC-SHA256
 * signature, parses the SMS text for a [TAG] prefix, and dispatches to the
 * same action handlers used by the email tag pipeline.
 *
 * Expected SMS format (same as email subject): "[TAG] content"
 * e.g. "[IDEA] Video about Cloudflare Workers AI"
 *
 * Because there is no stored email to move or mark read, routeSmsAction()
 * calls the handler directly and skips the mailbox bookkeeping that
 * routeEmailAction() does after the handler returns.
 *
 * References:
 *   https://docs.sent.dm/start/webhooks/event-types
 *   https://docs.sent.dm/start/webhooks/signature-verification
 */

import type { Env } from "../types";
import { parseSubjectTag } from "./actions";
import { getActionHandler } from "./actions/registry";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentMessageReceivedPayload {
	account_id: string;
	from: string;
	to: string;
	text: string | null;
	channel: string;
	provider: string;
	received_at: string;
}

interface SentWebhookEvent {
	field: string;
	event?: string;
	timestamp: string;
	payload: unknown;
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

const WHSEC_PREFIX = "whsec_";
/** Maximum age of a webhook request before it is rejected as a replay. */
const MAX_TIMESTAMP_AGE_MS = 5 * 60 * 1000;

/**
 * Verify a sent.dm webhook HMAC-SHA256 signature.
 *
 * Algorithm:
 *   1. Strip the "whsec_" prefix and base64-decode the remainder to get raw key bytes.
 *   2. Build the signed payload: "{webhookId}.{timestamp}.{rawBody}"
 *   3. HMAC-SHA256 the payload with the raw key, base64-encode the result, prefix "v1,".
 *   4. Timing-safe compare against the provided signature.
 *   5. Reject if the timestamp is more than MAX_TIMESTAMP_AGE_MS old (replay protection).
 */
export async function verifySentSignature(params: {
	secret: string;
	webhookId: string;
	timestamp: string;
	rawBody: string;
	signature: string;
}): Promise<boolean> {
	const { secret, webhookId, timestamp, rawBody, signature } = params;

	// Replay protection: reject if timestamp is too old or in the future.
	const timestampMs = Number(timestamp) * 1000;
	if (Number.isNaN(timestampMs)) return false;
	const age = Date.now() - timestampMs;
	if (age > MAX_TIMESTAMP_AGE_MS || age < -MAX_TIMESTAMP_AGE_MS) return false;

	// Decode the signing secret.
	const rawSecret = secret.startsWith(WHSEC_PREFIX) ? secret.slice(WHSEC_PREFIX.length) : secret;
	let keyBytes: Uint8Array<ArrayBuffer>;
	try {
		const binary = atob(rawSecret);
		keyBytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) keyBytes[i] = binary.charCodeAt(i);
	} catch {
		return false;
	}

	// Import the key for HMAC-SHA256.
	const key = await globalThis.crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);

	// Build the signed content and compute the expected signature.
	const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
	const mac = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signedContent));
	const expected = `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;

	// Timing-safe compare: pad both strings to the same length to avoid length leaks.
	const a = new TextEncoder().encode(expected.padEnd(512, "\0"));
	const b = new TextEncoder().encode(signature.padEnd(512, "\0"));
	if (a.length !== b.length) return false;

	let mismatch = 0;
	for (let i = 0; i < a.length; i++) {
		mismatch |= a[i] ^ b[i];
	}
	return mismatch === 0;
}

// ---------------------------------------------------------------------------
// Action routing (SMS variant)
// ---------------------------------------------------------------------------

/**
 * Dispatch an SMS-triggered tag action.
 *
 * Unlike routeEmailAction(), this does NOT move or mark an email — there is no
 * stored email in the mailbox. The handler is called directly with a synthetic
 * ActionContext where sender and mailboxId both point to SENT_SMS_MAILBOX_ID,
 * so any confirmation email the handler sends will land in the owner's inbox.
 */
export async function routeSmsAction(params: {
	tag: string;
	cleanText: string;
	from: string;
	env: Env;
}): Promise<void> {
	const { tag, cleanText, from, env } = params;

	const handler = getActionHandler(tag);
	if (!handler) {
		console.log(`[SmsWebhook] Unknown tag: [${tag}], ignoring SMS from ${from}`);
		return;
	}

	const mailboxId = env.SENT_SMS_MAILBOX_ID;
	// Generate a stable-enough synthetic ID to satisfy the ActionContext shape.
	// The handlers store this as in_reply_to / thread_id on the sent confirmation email.
	const syntheticEmailId = crypto.randomUUID();

	console.log(`[SmsWebhook] Dispatching [${tag}] action for SMS from ${from} (text: "${cleanText}")`);

	await handler({
		emailId: syntheticEmailId,
		subject: cleanText,
		tag,
		body: "",
		// Use the mailbox address as sender so the handler's confirmation email
		// is addressed back to the owner's inbox rather than to the phone number.
		sender: mailboxId,
		recipient: mailboxId,
		mailboxId,
		env,
	});

	console.log(`[SmsWebhook] [${tag}] action completed for SMS from ${from}`);
}

// ---------------------------------------------------------------------------
// HTTP handler
// ---------------------------------------------------------------------------

/**
 * Handle a POST /webhooks/sms request from sent.dm.
 *
 * Returns 200 for every valid (authenticated) request regardless of whether a
 * handler was found — this prevents sent.dm from retrying non-actionable events.
 * Returns 401 for missing/invalid signatures and 400 for unparseable bodies.
 */
export async function receiveSms(
	request: Request,
	env: Env,
	ctx: ExecutionContext,
): Promise<Response> {
	if (!env.SENT_WEBHOOK_SECRET) {
		console.error("[SmsWebhook] SENT_WEBHOOK_SECRET is not configured");
		return new Response("Webhook not configured", { status: 401 });
	}

	// Read the raw body as text before any JSON parsing — we need it for signature verification.
	const rawBody = await request.text();

	const webhookId = request.headers.get("x-webhook-id") ?? "";
	const timestamp = request.headers.get("x-webhook-timestamp") ?? "";
	const signature = request.headers.get("x-webhook-signature") ?? "";

	console.log(`[SmsWebhook] Webhook received — webhookId: ${webhookId}`);

	if (!webhookId || !timestamp || !signature) {
		return new Response("Missing webhook headers", { status: 401 });
	}

	const valid = await verifySentSignature({
		secret: env.SENT_WEBHOOK_SECRET,
		webhookId,
		timestamp,
		rawBody,
		signature,
	});

	if (!valid) {
		console.warn(`[SmsWebhook] Signature verification failed — webhookId: ${webhookId}`);
		return new Response("Invalid signature", { status: 401 });
	}

	console.log(`[SmsWebhook] Signature verified — webhookId: ${webhookId}`);

	let event: SentWebhookEvent;
	try {
		event = JSON.parse(rawBody) as SentWebhookEvent;
	} catch {
		return new Response("Invalid JSON body", { status: 400 });
	}

	// Only act on inbound message events; acknowledge everything else silently.
	if (event.field !== "message" || event.event !== "message.received") {
		console.log(`[SmsWebhook] Ignoring event — field: ${event.field}, event: ${event.event ?? "(none)"}`);
		return new Response("OK", { status: 200 });
	}

	const payload = event.payload as Partial<SentMessageReceivedPayload> | null;
	const text = payload?.text?.trim() ?? "";
	const from = payload?.from ?? "(unknown)";

	if (!text) {
		console.log("[SmsWebhook] Received empty SMS body, ignoring");
		return new Response("OK", { status: 200 });
	}

	const parsed = parseSubjectTag(text);
	if (!parsed) {
		console.log(`[SmsWebhook] No [TAG] found in SMS from ${from}, ignoring`);
		return new Response("OK", { status: 200 });
	}

	if (!env.SENT_SMS_MAILBOX_ID) {
		console.error("[SmsWebhook] SENT_SMS_MAILBOX_ID is not configured — cannot route SMS action");
		return new Response("OK", { status: 200 });
	}

	ctx.waitUntil(
		routeSmsAction({
			tag: parsed.tag,
			cleanText: parsed.cleanSubject,
			from,
			env,
		}).catch((err: unknown) => {
			const msg = err instanceof Error ? err.message : String(err);
			const stack = err instanceof Error ? err.stack : undefined;
			console.error(`[SmsWebhook] [${parsed.tag}] action failed:`, msg, stack);
		}),
	);

	return new Response("OK", { status: 200 });
}
