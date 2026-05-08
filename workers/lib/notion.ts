/**
 * Notion API types and helpers for database integrations.
 *
 * Content Database Schema (live):
 *   Title            — title       (required)
 *   Status           — status      (Idea, In progress, Drafting, Outlining, Published)
 *   Category         — multi_select (Demo, YouTube, Blog Post, Twitter, LinkedIn, YouTube Short)
 *   Direction        — select      (Tutorial, Opinion, Comparison, Walkthrough, Explainer)
 *   Target Audience  — select      (Beginner, Intermediate, Advanced)
 *   Hook             — rich_text
 *   Priority         — select      (High, Medium, Low)
 *   Target Date      — date
 *
 *   Any links from the inbound email are added to a References section in the
 *   page body rather than a dedicated property.
 *
 *   Output-specific artifacts (video script, blog draft, tweet copy, etc.) are
 *   created as child pages under a given Content item. Ingestion only creates
 *   the parent item; child pages are produced later in the pipeline.
 *
 * CFP Database Schema:
 *   Title            — title       (required)
 *   Status           — status      (New, Submitted, Accepted, Rejected, Expired)
 *   Deadline         — date
 *   URL              — url
 *   Description      — rich_text
 *   Content Types    — multi_select (Talk, Workshop, Lightning Talk, Panel, Keynote, Other)
 *
 *   Notes are added to the page body rather than a dedicated property.
 *
 * Resources Database Schema:
 *   Name             — title       (required)
 *   URL              — url
 *   Type             — select      (Article, Tool, Video, Course, Repo, Tweet, Podcast, Book)
 *   Category         — multi_select (Design, Dev Tools, Articles, Inspiration, AI, Cloudflare, Tutorials, Books)
 *   Tags             — multi_select (React, TypeScript, CSS, Cloudflare, AI, Notion, Productivity)
 *   Status           — select      (To Review, Reviewed, Using, Archived)
 *   Notes            — rich_text
 *   Date Added       — created_time (auto)
 */

// ── Notion property value types ────────────────────────────────────

export interface NotionRichText {
	type: "text";
	text: { content: string; link?: { url: string } | null };
}

export interface NotionTitleProperty {
	title: NotionRichText[];
}

export interface NotionSelectProperty {
	select: { name: string };
}

export interface NotionMultiSelectProperty {
	multi_select: { name: string }[];
}

export interface NotionDateProperty {
	date: { start: string; end?: string | null };
}

export interface NotionStatusProperty {
	status: { name: string };
}

export interface NotionUrlProperty {
	url: string;
}

export interface NotionRichTextProperty {
	rich_text: NotionRichText[];
}

// ── Content database specific types ───────────────────────────────

export type ContentStatus =
	| "Idea"
	| "In progress"
	| "Drafting"
	| "Outlining"
	| "Published";

export type ContentCategory =
	| "Demo"
	| "YouTube"
	| "Blog Post"
	| "Twitter"
	| "LinkedIn"
	| "YouTube Short";

export type ContentDirection =
	| "Tutorial"
	| "Opinion"
	| "Comparison"
	| "Walkthrough"
	| "Explainer";

export type ContentAudience = "Beginner" | "Intermediate" | "Advanced";

export type ContentPriority = "High" | "Medium" | "Low";

export interface ContentReference {
	url: string;
	note?: string;
}

// ── CFP database specific types ──────────────────────────────────

export type CfpStatus = "New" | "Submitted" | "Accepted" | "Rejected" | "Expired";

export type CfpContentType = "Talk" | "Workshop" | "Lightning Talk" | "Panel" | "Keynote" | "Other";

export interface CfpProperties {
	Title: NotionTitleProperty;
	Status?: NotionStatusProperty;
	Deadline?: NotionDateProperty;
	URL?: NotionUrlProperty;
	Description?: NotionRichTextProperty;
	"Content Types"?: NotionMultiSelectProperty;
}

// ── Resources database specific types ────────────────────────────

export type ResourceType =
	| "Article"
	| "Tool"
	| "Video"
	| "Course"
	| "Repo"
	| "Tweet"
	| "Podcast"
	| "Book";

export type ResourceCategory =
	| "Design"
	| "Dev Tools"
	| "Articles"
	| "Inspiration"
	| "AI"
	| "Cloudflare"
	| "Tutorials"
	| "Books";

export type ResourceTag =
	| "React"
	| "TypeScript"
	| "CSS"
	| "Cloudflare"
	| "AI"
	| "Notion"
	| "Productivity";

export type ResourceStatus = "To Review" | "Reviewed" | "Using" | "Archived";

export interface ResourceProperties {
	Name: NotionTitleProperty;
	URL?: NotionUrlProperty;
	Type?: NotionSelectProperty;
	Category?: NotionMultiSelectProperty;
	Tags?: NotionMultiSelectProperty;
	Status?: NotionSelectProperty;
	Notes?: NotionRichTextProperty;
}

// ── Property interfaces ──────────────────────────────────────────

export interface ContentProperties {
	Title: NotionTitleProperty;
	Status?: NotionStatusProperty;
	Category?: NotionMultiSelectProperty;
	Direction?: NotionSelectProperty;
	"Target Audience"?: NotionSelectProperty;
	Hook?: NotionRichTextProperty;
	Priority?: NotionSelectProperty;
	"Target Date"?: NotionDateProperty;
}

/** Block content types for the page body. */
export interface NotionParagraphBlock {
	object: "block";
	type: "paragraph";
	paragraph: { rich_text: NotionRichText[] };
}

export interface NotionHeadingBlock {
	object: "block";
	type: "heading_2";
	heading_2: { rich_text: NotionRichText[] };
}

export interface NotionBulletedListBlock {
	object: "block";
	type: "bulleted_list_item";
	bulleted_list_item: { rich_text: NotionRichText[] };
}

export type NotionBlock = NotionParagraphBlock | NotionHeadingBlock | NotionBulletedListBlock;

// ── API request / response types ───────────────────────────────────

export interface NotionCreatePageRequest {
	parent: { database_id: string } | { page_id: string };
	properties: ContentProperties | CfpProperties | ResourceProperties | { title: NotionRichText[] };
	children?: NotionBlock[];
}

export interface NotionCreatePageResponse {
	id: string;
	url: string;
	created_time: string;
}

export interface NotionUpdatePageRequest {
	properties: Partial<ContentProperties>;
}

export interface NotionQueryResponse {
	results: Array<{
		id: string;
		url: string;
		properties: Record<string, any>;
	}>;
	has_more: boolean;
	next_cursor: string | null;
}

// ── Content helpers ───────────────────────────────────────────────

/**
 * Build a create-page request for the Content database.
 */
export function buildCreateContentItemRequest(
	databaseId: string,
	params: {
		title: string;
		status?: ContentStatus;
		categories?: ContentCategory[];
		direction?: ContentDirection;
		audience?: ContentAudience;
		hook?: string;
		priority?: ContentPriority;
		targetDate?: string;
		bodyText?: string;
		links?: Array<string | ContentReference>;
	},
): NotionCreatePageRequest {
	const properties: ContentProperties = {
		Title: {
			title: [{ type: "text", text: { content: params.title } }],
		},
	};

	if (params.status) {
		properties.Status = { status: { name: params.status } };
	}

	if (params.categories && params.categories.length > 0) {
		properties.Category = {
			multi_select: params.categories.map((name) => ({ name })),
		};
	}

	if (params.direction) {
		properties.Direction = { select: { name: params.direction } };
	}

	if (params.audience) {
		properties["Target Audience"] = { select: { name: params.audience } };
	}

	if (params.hook) {
		properties.Hook = {
			rich_text: [{ type: "text", text: { content: params.hook } }],
		};
	}

	if (params.priority) {
		properties.Priority = { select: { name: params.priority } };
	}

	if (params.targetDate) {
		properties["Target Date"] = { date: { start: params.targetDate } };
	}

	const children: NotionBlock[] = [];

	if (params.bodyText?.trim()) {
		children.push({
			object: "block",
			type: "paragraph",
			paragraph: {
				rich_text: [{ type: "text", text: { content: params.bodyText } }],
			},
		});
	}

	if (params.links && params.links.length > 0) {
		// Add a blank line before the references section
		children.push({
			object: "block",
			type: "paragraph",
			paragraph: { rich_text: [] },
		});

		children.push({
			object: "block",
			type: "heading_2",
			heading_2: {
				rich_text: [{ type: "text", text: { content: "References" } }],
			},
		});

		for (const link of params.links) {
			const reference = typeof link === "string" ? { url: link } : link;
			const note = reference.note?.trim();
			children.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [
						{ type: "text", text: { content: reference.url, link: { url: reference.url } } },
						...(note ? [{ type: "text" as const, text: { content: `\nNotes: ${note.slice(0, 1800)}` } }] : []),
					],
				},
			});
		}
	}

	return {
		parent: { database_id: databaseId },
		properties,
		children: children.length > 0 ? children : undefined,
	};
}

// ── API calls ──────────────────────────────────────────────────────

const NOTION_API_VERSION = "2022-06-28";
const URL_REGEX = /https?:\/\/[^\s<>"]+/g;

function redactUrlForLog(url: string): string {
	try {
		const parsed = new URL(url);
		parsed.username = "";
		parsed.password = "";
		parsed.search = "";
		parsed.hash = "";
		return parsed.toString();
	} catch {
		return "[invalid-url]";
	}
}

function redactUrlsInText(text: string): string {
	return text.replace(URL_REGEX, (url) => redactUrlForLog(url));
}

/**
 * Create a new Content item in Notion.
 */
export async function createContentItem(
	apiKey: string,
	databaseId: string,
	params: Parameters<typeof buildCreateContentItemRequest>[1],
): Promise<NotionCreatePageResponse> {
	const body = buildCreateContentItemRequest(databaseId, params);
	const response = await notionRequest(apiKey, "POST", "https://api.notion.com/v1/pages", body);
	return response as NotionCreatePageResponse;
}

// ── CFP helpers ──────────────────────────────────────────────────

/**
 * Build a create-page request for the CFP database.
 */
export interface CfpTalkIdea {
	title: string;
	pitch: string;
	contentType?: string;
}

export function buildCreateCfpItemRequest(
	databaseId: string,
	params: {
		title: string;
		status?: CfpStatus;
		deadline?: string;
		url?: string;
		description?: string;
		contentTypes?: CfpContentType[];
		bodyText?: string;
		talkIdeas?: CfpTalkIdea[];
	},
): NotionCreatePageRequest {
	const properties: CfpProperties = {
		Title: {
			title: [{ type: "text", text: { content: params.title } }],
		},
	};

	if (params.status) {
		properties.Status = { status: { name: params.status } };
	}

	if (params.deadline) {
		properties.Deadline = { date: { start: params.deadline } };
	}

	if (params.url) {
		properties.URL = { url: params.url };
	}

	if (params.description) {
		properties.Description = {
			rich_text: [{ type: "text", text: { content: params.description.slice(0, 2000) } }],
		};
	}

	if (params.contentTypes && params.contentTypes.length > 0) {
		properties["Content Types"] = {
			multi_select: params.contentTypes.map((name) => ({ name })),
		};
	}

	const children: NotionBlock[] = [];

	if (params.bodyText?.trim()) {
		for (const chunk of splitTextIntoChunks(params.bodyText, 2000)) {
			children.push({
				object: "block",
				type: "paragraph",
				paragraph: {
					rich_text: [{ type: "text", text: { content: chunk } }],
				},
			});
		}
	}

	if (params.talkIdeas && params.talkIdeas.length > 0) {
		// Blank line before the section
		children.push({
			object: "block",
			type: "paragraph",
			paragraph: { rich_text: [] },
		});

		children.push({
			object: "block",
			type: "heading_2",
			heading_2: {
				rich_text: [{ type: "text", text: { content: "Talk Ideas" } }],
			},
		});

		for (const idea of params.talkIdeas) {
			const typeLabel = idea.contentType ? ` (${idea.contentType})` : "";
			const text = `${idea.title}${typeLabel} — ${idea.pitch}`;
			children.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [{ type: "text", text: { content: text.slice(0, 2000) } }],
				},
			});
		}
	}

	return {
		parent: { database_id: databaseId },
		properties,
		children: children.length > 0 ? children : undefined,
	};
}

/**
 * Create a new CFP item in Notion.
 */
export async function createCfpItem(
	apiKey: string,
	databaseId: string,
	params: Parameters<typeof buildCreateCfpItemRequest>[1],
): Promise<NotionCreatePageResponse> {
	const body = buildCreateCfpItemRequest(databaseId, params);
	const response = await notionRequest(apiKey, "POST", "https://api.notion.com/v1/pages", body);
	return response as NotionCreatePageResponse;
}

// ── Resources helpers ────────────────────────────────────────────

/**
 * Build a create-page request for the Resources database.
 */
export function buildCreateResourceItemRequest(
	databaseId: string,
	params: {
		name: string;
		url?: string;
		type?: ResourceType;
		categories?: ResourceCategory[];
		tags?: ResourceTag[];
		status?: ResourceStatus;
		notes?: string;
	},
): NotionCreatePageRequest {
	const properties: ResourceProperties = {
		Name: {
			title: [{ type: "text", text: { content: params.name } }],
		},
	};

	if (params.url) {
		properties.URL = { url: params.url };
	}

	if (params.type) {
		properties.Type = { select: { name: params.type } };
	}

	if (params.categories && params.categories.length > 0) {
		properties.Category = {
			multi_select: params.categories.map((name) => ({ name })),
		};
	}

	if (params.tags && params.tags.length > 0) {
		properties.Tags = {
			multi_select: params.tags.map((name) => ({ name })),
		};
	}

	if (params.status) {
		properties.Status = { select: { name: params.status } };
	}

	if (params.notes?.trim()) {
		// Notion rich_text values cap at 2000 chars per text block.
		properties.Notes = {
			rich_text: [{ type: "text", text: { content: params.notes.slice(0, 2000) } }],
		};
	}

	return {
		parent: { database_id: databaseId },
		properties,
	};
}

/**
 * Create a new Resource item in Notion.
 */
export async function createResourceItem(
	apiKey: string,
	databaseId: string,
	params: Parameters<typeof buildCreateResourceItemRequest>[1],
): Promise<NotionCreatePageResponse> {
	const body = buildCreateResourceItemRequest(databaseId, params);
	const response = await notionRequest(apiKey, "POST", "https://api.notion.com/v1/pages", body);
	return response as NotionCreatePageResponse;
}

/**
 * Update properties on an existing Content item.
 */
export async function updateNotionPage(
	apiKey: string,
	pageId: string,
	properties: Record<string, any>,
): Promise<NotionCreatePageResponse> {
	const response = await notionRequest(apiKey, "PATCH", `https://api.notion.com/v1/pages/${pageId}`, {
		properties,
	});
	return response as NotionCreatePageResponse;
}

/**
 * Create a child page under an existing Content item. Used later in the
 * pipeline to store output-specific artifacts (video script, blog draft, etc.).
 */
export async function createChildPage(
	apiKey: string,
	parentPageId: string,
	title: string,
	content: string,
): Promise<NotionCreatePageResponse> {
	// Split content into chunks of ~2000 chars to stay within Notion's rich text limits
	const chunks = splitTextIntoChunks(content, 2000);

	const children: NotionBlock[] = chunks.map((chunk) => ({
		object: "block" as const,
		type: "paragraph" as const,
		paragraph: {
			rich_text: [{ type: "text" as const, text: { content: chunk } }],
		},
	}));

	const body = {
		parent: { page_id: parentPageId },
		properties: {
			title: [{ type: "text", text: { content: title } }],
		},
		children,
	};

	const response = await notionRequest(apiKey, "POST", "https://api.notion.com/v1/pages", body);
	return response as NotionCreatePageResponse;
}

/**
 * Query the Content database with optional filters.
 */
export async function queryContentPipeline(
	apiKey: string,
	databaseId: string,
	filter?: {
		status?: ContentStatus;
		category?: ContentCategory;
	},
): Promise<NotionQueryResponse> {
	const filterConditions: any[] = [];

	if (filter?.status) {
		filterConditions.push({
			property: "Status",
			status: { equals: filter.status },
		});
	}

	if (filter?.category) {
		filterConditions.push({
			property: "Category",
			multi_select: { contains: filter.category },
		});
	}

	const body: any = {
		sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
	};

	if (filterConditions.length === 1) {
		body.filter = filterConditions[0];
	} else if (filterConditions.length > 1) {
		body.filter = { and: filterConditions };
	}

	const response = await notionRequest(
		apiKey,
		"POST",
		`https://api.notion.com/v1/databases/${databaseId}/query`,
		body,
	);
	return response as NotionQueryResponse;
}

// ── Shared Notion API helpers ─────────────────────────────────────

async function notionRequest(
	apiKey: string,
	method: string,
	url: string,
	body?: any,
): Promise<any> {
	const endpoint = url.replace("https://api.notion.com", "");
	console.log(`[Notion] ${method} ${endpoint}${body ? ` — payload keys: ${Object.keys(body).join(", ")}` : ""}`);

	const response = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Notion-Version": NOTION_API_VERSION,
			"Content-Type": "application/json",
		},
		body: body ? JSON.stringify(body) : undefined,
	});

	if (!response.ok) {
		const errorBody = await response.text();
		const redactedError = redactUrlsInText(errorBody);
		console.error(`[Notion] ${method} ${endpoint} failed — ${response.status}: ${redactedError}`);
		throw new Error(`Notion API error ${response.status}: ${redactedError}`);
	}

	console.log(`[Notion] ${method} ${endpoint} — ${response.status} OK`);
	return response.json();
}

/**
 * Split text into chunks that fit within Notion's rich text content limit.
 * Splits on paragraph boundaries when possible.
 */
function splitTextIntoChunks(text: string, maxChunkSize: number): string[] {
	if (text.length <= maxChunkSize) return [text];

	const chunks: string[] = [];
	let remaining = text;

	while (remaining.length > 0) {
		if (remaining.length <= maxChunkSize) {
			chunks.push(remaining);
			break;
		}

		// Try to split on a paragraph boundary
		let splitIndex = remaining.lastIndexOf("\n\n", maxChunkSize);
		if (splitIndex === -1 || splitIndex < maxChunkSize * 0.5) {
			// Fall back to splitting on a newline
			splitIndex = remaining.lastIndexOf("\n", maxChunkSize);
		}
		if (splitIndex === -1 || splitIndex < maxChunkSize * 0.5) {
			// Fall back to splitting at maxChunkSize
			splitIndex = maxChunkSize;
		}

		chunks.push(remaining.slice(0, splitIndex));
		remaining = remaining.slice(splitIndex).replace(/^\n+/, "");
	}

	return chunks;
}
