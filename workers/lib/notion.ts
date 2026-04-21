/**
 * Notion API types and helpers for the To-Do and Content Pipeline database integrations.
 *
 * To-Do Database Schema:
 *   Name             — title    (required)
 *   Status           — select   (Next Up, In Progress, Completed, Ongoing, Archived, Idea)
 *   Priority         — select   (High 🔥, Medium, Low)
 *   Content Category — select   (Blog Post, LinkedIn, YouTube Short, YouTube, Twitter)
 *   Due Date         — date     (ISO-8601)
 *   Assign           — person   (user IDs)
 *   Parent item      — relation (self-relation)
 *   Sub-item         — relation (auto-populated)
 *   Content Item     — relation (→ Content Pipeline, two-way)
 *
 * Content Pipeline Database Schema:
 *   Title            — title    (required)
 *   Pipeline Status  — status   (Idea, Direction, Outline, Script, Review, Ready, Recording, Published)
 *   Content Category — select   (YouTube, Blog Post, Twitter, LinkedIn, YouTube Short)
 *   Source           — url
 *   Direction        — select   (Tutorial, Opinion, Comparison, Walkthrough, Explainer)
 *   Target Audience  — select   (Beginner, Intermediate, Advanced)
 *   Hook             — rich_text
 *   Priority         — select   (High, Medium, Low)
 *   Target Date      — date
 *   Todo Item        — relation (→ To-Do Items, two-way)
 *   Input Emails     — rich_text
 *
 *   Long-form artifacts (outline, script, blog, transcript, etc.) are stored as child pages.
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

export interface NotionDateProperty {
	date: { start: string; end?: string | null };
}

// ── To-Do database specific types ──────────────────────────────────

export type NotionTodoStatus =
	| "Next Up"
	| "In Progress"
	| "Completed"
	| "Ongoing"
	| "Archived"
	| "Idea";

export type NotionTodoPriority = "High 🔥" | "Medium" | "Low";

export type NotionContentCategory =
	| "Blog Post"
	| "LinkedIn"
	| "YouTube Short"
	| "YouTube"
	| "Twitter";

export interface NotionTodoProperties {
	Name: NotionTitleProperty;
	Status?: NotionSelectProperty;
	Priority?: NotionSelectProperty;
	"Content Category"?: NotionSelectProperty;
	"Due Date"?: NotionDateProperty;
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

// ── Content Pipeline database specific types ──────────────────────

export type PipelineStatus =
	| "Idea"
	| "Direction"
	| "Outline"
	| "Script"
	| "Review"
	| "Ready"
	| "Recording"
	| "Published";

export type ContentDirection =
	| "Tutorial"
	| "Opinion"
	| "Comparison"
	| "Walkthrough"
	| "Explainer";

export type ContentAudience =
	| "Beginner"
	| "Intermediate"
	| "Advanced";

export type ContentPriority = "High" | "Medium" | "Low";

export interface NotionUrlProperty {
	url: string;
}

export interface NotionRichTextProperty {
	rich_text: NotionRichText[];
}

export interface NotionRelationProperty {
	relation: { id: string }[];
}

export interface NotionStatusProperty {
	status: { name: string };
}

export interface ContentPipelineProperties {
	Title: NotionTitleProperty;
	"Pipeline Status"?: NotionStatusProperty;
	"Content Category"?: NotionSelectProperty;
	Source?: NotionUrlProperty;
	Direction?: NotionSelectProperty;
	"Target Audience"?: NotionSelectProperty;
	Hook?: NotionRichTextProperty;
	Priority?: NotionSelectProperty;
	"Target Date"?: NotionDateProperty;
	"Todo Item"?: NotionRelationProperty;
	"Input Emails"?: NotionRichTextProperty;
}

// ── API request / response types ───────────────────────────────────

export interface NotionCreatePageRequest {
	parent: { database_id: string } | { page_id: string };
	properties: NotionTodoProperties | ContentPipelineProperties | { title: NotionRichText[] };
	children?: NotionBlock[];
}

export interface NotionCreatePageResponse {
	id: string;
	url: string;
	created_time: string;
}

export interface NotionUpdatePageRequest {
	properties: Partial<ContentPipelineProperties> | Partial<NotionTodoProperties>;
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

// ── Helper to build a create-page request ──────────────────────────

export function buildCreateTodoRequest(
	databaseId: string,
	params: {
		name: string;
		status?: NotionTodoStatus;
		priority?: NotionTodoPriority;
		category?: NotionContentCategory;
		dueDate?: string;
		bodyText?: string;
		links?: string[];
	},
): NotionCreatePageRequest {
	const properties: NotionTodoProperties = {
		Name: {
			title: [{ type: "text", text: { content: params.name } }],
		},
	};

	if (params.status) {
		properties.Status = { select: { name: params.status } };
	}

	if (params.priority) {
		properties.Priority = { select: { name: params.priority } };
	}

	if (params.category) {
		properties["Content Category"] = { select: { name: params.category } };
	}

	if (params.dueDate) {
		properties["Due Date"] = { date: { start: params.dueDate } };
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
			children.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [{ type: "text", text: { content: link, link: { url: link } } }],
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

// ── API call ───────────────────────────────────────────────────────

const NOTION_API_VERSION = "2022-06-28";

export async function createNotionTodo(
	apiKey: string,
	databaseId: string,
	params: {
		name: string;
		status?: NotionTodoStatus;
		priority?: NotionTodoPriority;
		category?: NotionContentCategory;
		dueDate?: string;
		bodyText?: string;
		links?: string[];
		contentItemId?: string;
	},
): Promise<NotionCreatePageResponse> {
	const body = buildCreateTodoRequest(databaseId, params);

	// Add Content Item relation if provided
	if (params.contentItemId) {
		(body.properties as NotionTodoProperties & { "Content Item"?: NotionRelationProperty })["Content Item"] = {
			relation: [{ id: params.contentItemId }],
		};
	}

	const response = await fetch("https://api.notion.com/v1/pages", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${apiKey}`,
			"Notion-Version": NOTION_API_VERSION,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		throw new Error(
			`Notion API error ${response.status}: ${errorBody}`,
		);
	}

	return response.json() as Promise<NotionCreatePageResponse>;
}

// ── Content Pipeline helpers ──────────────────────────────────────

/**
 * Build a create-page request for the Content Pipeline database.
 */
export function buildCreateContentItemRequest(
	databaseId: string,
	params: {
		title: string;
		pipelineStatus?: PipelineStatus;
		category?: NotionContentCategory;
		source?: string;
		direction?: ContentDirection;
		audience?: ContentAudience;
		hook?: string;
		priority?: ContentPriority;
		targetDate?: string;
		todoItemId?: string;
		inputEmails?: string;
		bodyText?: string;
		links?: string[];
	},
): NotionCreatePageRequest {
	const properties: ContentPipelineProperties = {
		Title: {
			title: [{ type: "text", text: { content: params.title } }],
		},
	};

	if (params.pipelineStatus) {
		properties["Pipeline Status"] = { status: { name: params.pipelineStatus } };
	}

	if (params.category) {
		properties["Content Category"] = { select: { name: params.category } };
	}

	if (params.source) {
		properties.Source = { url: params.source };
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

	if (params.todoItemId) {
		properties["Todo Item"] = {
			relation: [{ id: params.todoItemId }],
		};
	}

	if (params.inputEmails) {
		properties["Input Emails"] = {
			rich_text: [{ type: "text", text: { content: params.inputEmails } }],
		};
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
			children.push({
				object: "block",
				type: "bulleted_list_item",
				bulleted_list_item: {
					rich_text: [{ type: "text", text: { content: link, link: { url: link } } }],
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
 * Create a new Content Pipeline item in Notion.
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

/**
 * Update properties on an existing Notion page (works for both To-Do and Content Pipeline items).
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
 * Create a child page under an existing page (used for storing long-form artifacts like scripts, outlines, etc.).
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
 * Query the Content Pipeline database with optional filters.
 */
export async function queryContentPipeline(
	apiKey: string,
	databaseId: string,
	filter?: {
		pipelineStatus?: PipelineStatus;
		category?: NotionContentCategory;
	},
): Promise<NotionQueryResponse> {
	const filterConditions: any[] = [];

	if (filter?.pipelineStatus) {
		filterConditions.push({
			property: "Pipeline Status",
			status: { equals: filter.pipelineStatus },
		});
	}

	if (filter?.category) {
		filterConditions.push({
			property: "Content Category",
			select: { equals: filter.category },
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
		throw new Error(`Notion API error ${response.status}: ${errorBody}`);
	}

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
