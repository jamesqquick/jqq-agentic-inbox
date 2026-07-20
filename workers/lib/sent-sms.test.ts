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

function mockFetch(status: number, body: unknown) {
	return vi.fn().mockResolvedValue({
		ok: status >= 200 && status < 300,
		status,
		json: () => Promise.resolve(body),
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("sendSms", () => {
	it("returns messageId and status on a successful response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(202, {
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
		const fetchMock = mockFetch(202, {
			success: true,
			data: { status: "QUEUED", recipients: [{ message_id: "msg_params" }] },
		});
		vi.stubGlobal("fetch", fetchMock);

		await sendSms(fakeEnv(), {
			to: "+15125550123",
			templateId: "tmpl_001",
			parameters: { count: "5" },
		});

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		const sentBody = JSON.parse(init.body as string);
		expect(sentBody.template.parameters).toEqual({ count: "5" });
	});

	it("throws SentSmsError with status and code on a non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(422, {
				success: false,
				error: { code: "VALIDATION_001", message: "Invalid phone number" },
			}),
		);

		await expect(
			sendSms(fakeEnv(), { to: "bad-number", templateId: "tmpl_001" }),
		).rejects.toMatchObject({
			name: "SentSmsError",
			status: 422,
			code: "VALIDATION_001",
			message: "Invalid phone number",
		});
	});

	it("throws SentSmsError when success is false even on a 200 response", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(200, {
				success: false,
				error: { code: "BUSINESS_003", message: "Insufficient balance" },
			}),
		);

		await expect(
			sendSms(fakeEnv(), { to: "+15125550123", templateId: "tmpl_001" }),
		).rejects.toMatchObject({
			name: "SentSmsError",
			code: "BUSINESS_003",
		});
	});

	it("sends the API key in the x-api-key header", async () => {
		const fetchMock = mockFetch(202, {
			success: true,
			data: { status: "QUEUED", recipients: [{ message_id: "msg_hdr" }] },
		});
		vi.stubGlobal("fetch", fetchMock);

		await sendSms(fakeEnv({ SENT_API_KEY: "my-secret-key" }), {
			to: "+15125550123",
			templateId: "tmpl_001",
		});

		const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect((init.headers as Record<string, string>)["x-api-key"]).toBe("my-secret-key");
	});

	it("returns undefined messageId when recipients array is missing", async () => {
		vi.stubGlobal(
			"fetch",
			mockFetch(202, {
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
