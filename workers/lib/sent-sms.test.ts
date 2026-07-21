import { describe, it, expect, vi, afterEach } from "vitest";
import { sendSms, SentSmsError } from "./sent-sms";
import type { Env } from "../types";

function fakeEnv(overrides: Partial<Env> = {}): Env {
	return {
		SENT_API_KEY: "test-api-key",
		SENT_TEMPLATE_ID: "",
		DIGEST_SMS_RECIPIENT: "",
		SENT_SANDBOX: "false",
		...overrides,
	} as unknown as Env;
}

/**
 * Return a proper Response object so the SDK's header/content-type parsing works.
 */
function mockFetch(status: number, body: unknown) {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify(body), {
			status,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("sendSms", () => {
	it("returns messageId and status on a successful response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(200, {
				success: true,
				data: {
					status: "QUEUED",
					recipients: [{ message_id: "msg_abc123" }],
				},
			}),
		);

		const result = await sendSms(fakeEnv(), {
			to: "+15125550123",
			templateId: "tmpl_001",
		});

		expect(result).toEqual({ messageId: "msg_abc123", status: "QUEUED" });
	});

	it("passes parameters in the template object when provided", async () => {
		const fetchMock = mockFetch(200, {
			success: true,
			data: { status: "QUEUED", recipients: [{ message_id: "msg_params" }] },
		});
		vi.stubGlobal("fetch", fetchMock);

		await sendSms(fakeEnv(), {
			to: "+15125550123",
			templateId: "tmpl_001",
			parameters: { count: "5" },
		});

		const call = fetchMock.mock.calls[0];
		// SDK passes a Request object as the first argument
		const req = call[0] instanceof Request ? call[0] : null;
		const sentBody = req ? JSON.parse(await req.text()) : JSON.parse(call[1].body as string);
		expect(sentBody.template.parameters).toEqual({ count: "5" });
	});

	it("uses multi-channel routing", async () => {
		const fetchMock = mockFetch(200, {
			success: true,
			data: { status: "QUEUED", recipients: [{ message_id: "msg_ch" }] },
		});
		vi.stubGlobal("fetch", fetchMock);

		await sendSms(fakeEnv(), {
			to: "+15125550123",
			templateId: "tmpl_001",
		});

		const call = fetchMock.mock.calls[0];
		const req = call[0] instanceof Request ? call[0] : null;
		const sentBody = req ? JSON.parse(await req.text()) : JSON.parse(call[1].body as string);
		expect(sentBody.channel).toEqual(["sms", "whatsapp", "rcs"]);
	});

	it("throws SentSmsError on a non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(422, {
				error: { message: "Invalid phone number" },
			}),
		);

		const err = await sendSms(fakeEnv(), { to: "bad-number", templateId: "tmpl_001" }).catch(
			(e) => e,
		);

		expect(err).toBeInstanceOf(SentSmsError);
		expect(err.status).toBe(422);
	});

	it("sends the API key in the request headers", async () => {
		const fetchMock = mockFetch(200, {
			success: true,
			data: { status: "QUEUED", recipients: [{ message_id: "msg_hdr" }] },
		});
		vi.stubGlobal("fetch", fetchMock);

		await sendSms(fakeEnv({ SENT_API_KEY: "my-secret-key" }), {
			to: "+15125550123",
			templateId: "tmpl_001",
		});

		const call = fetchMock.mock.calls[0];
		const req = call[0] instanceof Request ? call[0] : null;
		// The SDK wraps headers in a NullableHeaders object { values: Headers }
		// falling back to a plain Headers or Request if the shape changes.
		const headersObj = req ? req.headers : (call[1]?.headers as any);
		const apiKey =
			headersObj?.values?.get?.("x-api-key") ??
			headersObj?.get?.("x-api-key") ??
			headersObj?.["x-api-key"];
		expect(apiKey).toBe("my-secret-key");
	});

	it("returns undefined messageId when recipients array is missing", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(200, {
				success: true,
				data: { status: "QUEUED" },
			}),
		);

		const result = await sendSms(fakeEnv(), {
			to: "+15125550123",
			templateId: "tmpl_001",
		});

		expect(result.messageId).toBeUndefined();
		expect(result.status).toBe("QUEUED");
	});
});
