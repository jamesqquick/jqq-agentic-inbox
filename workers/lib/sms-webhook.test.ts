import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { verifySentSignature, receiveSms, routeSmsAction } from "./sms-webhook";
import { getActionHandler } from "./actions/registry";
import type { Env } from "../types";

// vi.mock is hoisted by Vitest before imports — the factory must be a static callback.
vi.mock("./actions/registry", () => ({
	getActionHandler: vi.fn(),
	getActionFolderName: vi.fn(() => "Ideas"),
}));

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

// A base64-encoded signing secret (decodes to "test-secret-key-123").
const TEST_SECRET = "whsec_dGVzdC1zZWNyZXQta2V5LTEyMw==";
const TEST_WEBHOOK_ID = "wh_test_abc123";

function nowTimestamp(): string {
	return String(Math.floor(Date.now() / 1000));
}

/** Re-implements the sent.dm signing algorithm for generating valid test signatures. */
async function sign(secret: string, webhookId: string, timestamp: string, body: string): Promise<string> {
	const rawSecret = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
	const keyBytes = Uint8Array.from(atob(rawSecret), (c) => c.charCodeAt(0));
	const key = await globalThis.crypto.subtle.importKey(
		"raw",
		keyBytes,
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const content = `${webhookId}.${timestamp}.${body}`;
	const mac = await globalThis.crypto.subtle.sign("HMAC", key, new TextEncoder().encode(content));
	return `v1,${btoa(String.fromCharCode(...new Uint8Array(mac)))}`;
}

function fakeEnv(overrides: Partial<Env> = {}): Env {
	return {
		SENT_WEBHOOK_SECRET: TEST_SECRET,
		SENT_SMS_MAILBOX_ID: "james@example.com",
		...overrides,
	} as unknown as Env;
}

function fakeCtx() {
	const promises: Promise<unknown>[] = [];
	return {
		waitUntil: (p: Promise<unknown>) => { promises.push(p); },
		/** Flush all waitUntil promises so side-effects run synchronously in tests. */
		flush: () => Promise.all(promises),
	};
}

function makeRequest(body: string, headers: Record<string, string> = {}): Request {
	return new Request("https://worker.example.com/webhooks/sms", {
		method: "POST",
		headers: { "Content-Type": "application/json", ...headers },
		body,
	});
}

async function makeValidRequest(body: string, overrideTimestamp?: string): Promise<Request> {
	const timestamp = overrideTimestamp ?? nowTimestamp();
	const sig = await sign(TEST_SECRET, TEST_WEBHOOK_ID, timestamp, body);
	return makeRequest(body, {
		"x-webhook-id": TEST_WEBHOOK_ID,
		"x-webhook-timestamp": timestamp,
		"x-webhook-signature": sig,
	});
}

const MESSAGE_RECEIVED_PAYLOAD = {
	field: "message",
	event: "message.received",
	timestamp: new Date().toISOString(),
	payload: {
		account_id: "acct_001",
		from: "+15125550100",
		to: "+15125550200",
		text: "[IDEA] Cool video about Workers AI",
		channel: "sms",
		provider: "twilio",
		received_at: new Date().toISOString(),
	},
};

// ---------------------------------------------------------------------------
// verifySentSignature
// ---------------------------------------------------------------------------

describe("verifySentSignature", () => {
	it("returns true for a valid signature", async () => {
		const timestamp = nowTimestamp();
		const body = JSON.stringify({ test: true });
		const signature = await sign(TEST_SECRET, TEST_WEBHOOK_ID, timestamp, body);

		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp,
			rawBody: body,
			signature,
		});

		expect(result).toBe(true);
	});

	it("works with a secret that lacks the whsec_ prefix", async () => {
		const bareSecret = TEST_SECRET.slice("whsec_".length);
		const timestamp = nowTimestamp();
		const body = "{}";
		const signature = await sign(TEST_SECRET, TEST_WEBHOOK_ID, timestamp, body);

		const result = await verifySentSignature({
			secret: bareSecret,
			webhookId: TEST_WEBHOOK_ID,
			timestamp,
			rawBody: body,
			signature,
		});

		expect(result).toBe(true);
	});

	it("returns false when the body is tampered", async () => {
		const timestamp = nowTimestamp();
		const body = JSON.stringify({ test: true });
		const signature = await sign(TEST_SECRET, TEST_WEBHOOK_ID, timestamp, body);

		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp,
			rawBody: body + " tampered",
			signature,
		});

		expect(result).toBe(false);
	});

	it("returns false when the signature is tampered", async () => {
		const timestamp = nowTimestamp();
		const body = "{}";
		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp,
			rawBody: body,
			signature: "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
		});

		expect(result).toBe(false);
	});

	it("returns false for a timestamp more than 5 minutes in the past", async () => {
		const staleTimestamp = String(Math.floor(Date.now() / 1000) - 6 * 60);
		const body = "{}";
		const signature = await sign(TEST_SECRET, TEST_WEBHOOK_ID, staleTimestamp, body);

		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp: staleTimestamp,
			rawBody: body,
			signature,
		});

		expect(result).toBe(false);
	});

	it("returns false for a timestamp more than 5 minutes in the future", async () => {
		const futureTimestamp = String(Math.floor(Date.now() / 1000) + 6 * 60);
		const body = "{}";
		const signature = await sign(TEST_SECRET, TEST_WEBHOOK_ID, futureTimestamp, body);

		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp: futureTimestamp,
			rawBody: body,
			signature,
		});

		expect(result).toBe(false);
	});

	it("returns false for an invalid (non-numeric) timestamp", async () => {
		const result = await verifySentSignature({
			secret: TEST_SECRET,
			webhookId: TEST_WEBHOOK_ID,
			timestamp: "not-a-number",
			rawBody: "{}",
			signature: "v1,anything",
		});

		expect(result).toBe(false);
	});

	it("returns false when the secret base64 is malformed", async () => {
		const result = await verifySentSignature({
			secret: "whsec_!!!not-valid-base64!!!",
			webhookId: TEST_WEBHOOK_ID,
			timestamp: nowTimestamp(),
			rawBody: "{}",
			signature: "v1,anything",
		});

		expect(result).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// receiveSms
// ---------------------------------------------------------------------------

describe("receiveSms", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("returns 401 when SENT_WEBHOOK_SECRET is not configured", async () => {
		const body = JSON.stringify(MESSAGE_RECEIVED_PAYLOAD);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();
		const env = fakeEnv({ SENT_WEBHOOK_SECRET: "" });

		const res = await receiveSms(req, env, ctx as unknown as ExecutionContext);
		expect(res.status).toBe(401);
	});

	it("returns 401 when webhook headers are missing", async () => {
		const body = JSON.stringify(MESSAGE_RECEIVED_PAYLOAD);
		const req = makeRequest(body); // no x-webhook-* headers
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(401);
	});

	it("returns 401 when the signature is invalid", async () => {
		const body = JSON.stringify(MESSAGE_RECEIVED_PAYLOAD);
		const req = makeRequest(body, {
			"x-webhook-id": TEST_WEBHOOK_ID,
			"x-webhook-timestamp": nowTimestamp(),
			"x-webhook-signature": "v1,invalidsignature",
		});
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(401);
	});

	it("returns 200 and does nothing for non-message.received events", async () => {
		const deliveredEvent = {
			field: "message",
			event: "message.delivered",
			timestamp: new Date().toISOString(),
			payload: { message_id: "msg_001", message_status: "DELIVERED" },
		};
		const body = JSON.stringify(deliveredEvent);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);
		await ctx.flush();
	});

	it("returns 200 and ignores SMS without a [TAG]", async () => {
		const noTagPayload = {
			...MESSAGE_RECEIVED_PAYLOAD,
			payload: { ...MESSAGE_RECEIVED_PAYLOAD.payload, text: "Hey what time is it?" },
		};
		const body = JSON.stringify(noTagPayload);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);
	});

	it("returns 200 and ignores empty SMS body", async () => {
		const emptyPayload = {
			...MESSAGE_RECEIVED_PAYLOAD,
			payload: { ...MESSAGE_RECEIVED_PAYLOAD.payload, text: "" },
		};
		const body = JSON.stringify(emptyPayload);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);
	});

	it("returns 200 and ignores null SMS text", async () => {
		const nullPayload = {
			...MESSAGE_RECEIVED_PAYLOAD,
			payload: { ...MESSAGE_RECEIVED_PAYLOAD.payload, text: null },
		};
		const body = JSON.stringify(nullPayload);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);
	});

	it("returns 200 and dispatches the correct tag and text via routeSmsAction", async () => {
		const handlerMock = vi.fn().mockResolvedValue(undefined);
		vi.mocked(getActionHandler).mockReturnValue(handlerMock);

		const body = JSON.stringify(MESSAGE_RECEIVED_PAYLOAD);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();

		const res = await receiveSms(req, fakeEnv(), ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);

		// Flush waitUntil so routeSmsAction runs synchronously in the test.
		await ctx.flush();

		expect(handlerMock).toHaveBeenCalledOnce();
		const [actionCtx] = handlerMock.mock.calls[0] as [{ tag: string; subject: string }];
		expect(actionCtx.tag).toBe("IDEA");
		expect(actionCtx.subject).toBe("Cool video about Workers AI");
	});

	it("returns 200 even when SENT_SMS_MAILBOX_ID is not configured (graceful degradation)", async () => {
		const body = JSON.stringify(MESSAGE_RECEIVED_PAYLOAD);
		const req = await makeValidRequest(body);
		const ctx = fakeCtx();
		const env = fakeEnv({ SENT_SMS_MAILBOX_ID: "" });

		const res = await receiveSms(req, env, ctx as unknown as ExecutionContext);
		expect(res.status).toBe(200);
		// waitUntil should NOT be called since mailboxId is missing
		await ctx.flush();
	});
});

// ---------------------------------------------------------------------------
// routeSmsAction
// ---------------------------------------------------------------------------

describe("routeSmsAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("calls the action handler with the correct context", async () => {
		const handlerMock = vi.fn().mockResolvedValue(undefined);
		vi.mocked(getActionHandler).mockReturnValue(handlerMock);

		const env = fakeEnv();

		await routeSmsAction({ tag: "IDEA", cleanText: "My video idea", from: "+15125550100", env });

		expect(handlerMock).toHaveBeenCalledOnce();
		const [ctx] = handlerMock.mock.calls[0] as [{ tag: string; subject: string; sender: string; mailboxId: string; body: string }];
		expect(ctx.tag).toBe("IDEA");
		expect(ctx.subject).toBe("My video idea");
		expect(ctx.body).toBe("");
		// sender and mailboxId should both be the configured mailbox address
		expect(ctx.sender).toBe("james@example.com");
		expect(ctx.mailboxId).toBe("james@example.com");
	});

	it("does nothing when no handler is registered for the tag", async () => {
		vi.mocked(getActionHandler).mockReturnValue(undefined);

		const env = fakeEnv();
		// Should not throw
		await expect(
			routeSmsAction({ tag: "UNKNOWN", cleanText: "test", from: "+15125550100", env }),
		).resolves.toBeUndefined();
	});
});
