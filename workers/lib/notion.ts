/**
 * Notion API types and helpers for the To-Do database integration.
 *
 * Schema:
 *   Name             — title    (required)
 *   Status           — select   (Next Up, In Progress, Completed, Ongoing, Archived, Idea)
 *   Priority         — select   (High 🔥, Medium, Low)
 *   Content Category — select   (Blog Post, LinkedIn, YouTube Short, YouTube, Twitter)
 *   Due Date         — date     (ISO-8601)
 *   Assign           — person   (user IDs)
 *   Parent item      — relation (self-relation)
 *   Sub-item         — relation (auto-populated)
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

// ── API request / response types ───────────────────────────────────

export interface NotionCreatePageRequest {
	parent: { database_id: string };
	properties: NotionTodoProperties;
	children?: NotionBlock[];
}

export interface NotionCreatePageResponse {
	id: string;
	url: string;
	created_time: string;
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
	},
): Promise<NotionCreatePageResponse> {
	const body = buildCreateTodoRequest(databaseId, params);

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
