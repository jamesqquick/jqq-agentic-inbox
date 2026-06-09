import { describe, it, expect, vi } from "vitest";
import { extractTitleFromMarkdown, generateIdeaSummary } from "./title";

/**
 * Build a fake Workers AI binding whose `run()` returns a fixed response.
 * Pass a string to simulate the `{ response }` shape Workers AI usually emits.
 */
function fakeAi(response: string | { response: string } | (() => never)) {
	return {
		run: vi.fn(async (_model: string, _options: { messages: { role: string; content: string }[] }) =>
			typeof response === "function" ? response() : response,
		),
	};
}

describe("extractTitleFromMarkdown", () => {
	it("returns the first markdown heading when present", () => {
		const md = "# Building a CLI with TypeScript\n\nsome body text";
		expect(extractTitleFromMarkdown(md)).toBe("Building a CLI with TypeScript");
	});

	it("falls back to the first non-empty line when there is no heading", () => {
		const md = "\n\nEdge caching performance tips\nmore content here";
		expect(extractTitleFromMarkdown(md)).toBe("Edge caching performance tips");
	});

	it("ignores lines of 5 characters or fewer", () => {
		const md = "hi\nok\nThis is the real first line";
		expect(extractTitleFromMarkdown(md)).toBe("This is the real first line");
	});

	it("truncates long titles to 80 characters", () => {
		const long = "A".repeat(200);
		const result = extractTitleFromMarkdown(`# ${long}`);
		expect(result).toHaveLength(80);
	});

	it("returns null when nothing usable is found", () => {
		expect(extractTitleFromMarkdown("\n  \nhi\nok")).toBeNull();
	});
});

describe("generateIdeaSummary", () => {
	const promptHint = "content the user wants to share on Twitter";

	it("uses the AI-generated title and description on a valid JSON response", async () => {
		const ai = fakeAi({
			response: '{"title": "Edge Computing Tips", "description": "A thread on edge perf."}',
		});

		const result = await generateIdeaSummary(ai, "(see body)", "", promptHint, "page content");

		expect(result).toEqual({
			title: "Edge Computing Tips",
			description: "A thread on edge perf.",
		});
	});

	it("includes the fetched page content in the AI prompt", async () => {
		const ai = fakeAi({ response: '{"title": "T", "description": "D"}' });

		await generateIdeaSummary(ai, "(see body)", "", promptHint, "UNIQUE_PAGE_MARKER");

		const [, options] = ai.run.mock.calls[0]!;
		const userMessage = options.messages.find((m) => m.role === "user");
		expect(userMessage?.content).toContain("UNIQUE_PAGE_MARKER");
		expect(userMessage?.content).toContain("Linked page content:");
	});

	it("falls back to a title extracted from page markdown when the AI returns junk", async () => {
		const ai = fakeAi({ response: "not json at all" });

		const result = await generateIdeaSummary(
			ai,
			"(see body)",
			"",
			promptHint,
			"# Real Page Title\n\nbody",
		);

		expect(result.title).toBe("Real Page Title");
	});

	it("falls back to the markdown title when the AI call throws", async () => {
		const ai = fakeAi(() => {
			throw new Error("AI unavailable");
		});

		const result = await generateIdeaSummary(
			ai,
			"(see body)",
			"",
			promptHint,
			"Edge caching deep dive\nmore",
		);

		expect(result.title).toBe("Edge caching deep dive");
	});

	it("falls back to the subject when there is no page markdown and AI fails", async () => {
		const ai = fakeAi({ response: "garbage" });

		const result = await generateIdeaSummary(
			ai,
			"Build a CLI for X",
			"",
			promptHint,
			null,
		);

		expect(result.title).toBe("Build a CLI for X");
	});

	it("does not use the '(see body)' placeholder as a title", async () => {
		const ai = fakeAi({ response: "garbage" });

		const result = await generateIdeaSummary(
			ai,
			"(see body)",
			"Some body text used to derive a title from",
			promptHint,
			null,
		);

		expect(result.title).not.toBe("(see body)");
		expect(result.title).toBe("Some body text used to derive a title from");
	});

	it("uses 'Untitled idea' as the last resort", async () => {
		const ai = fakeAi({ response: "garbage" });

		const result = await generateIdeaSummary(ai, "(see body)", "", promptHint, null);

		expect(result.title).toBe("Untitled idea");
	});
});
