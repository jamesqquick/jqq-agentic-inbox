/**
 * Notion API types and helpers for the To-Do database integration.
 *
 * Schema:
 *   Name        — title    (required)
 *   Status      — select   (Next Up, In Progress, Completed, Ongoing, Archived)
 *   Priority    — select   (High 🔥, Medium, Low)
 *   Due Date    — date     (ISO-8601)
 *   Assign      — person   (user IDs)
 *   Parent item — relation (self-relation)
 *   Sub-item    — relation (auto-populated)
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

export interface NotionTodoProperties {
	Name: NotionTitleProperty;
	Status?: NotionSelectProperty;
	Priority?: NotionSelectProperty;
	"Due Date"?: NotionDateProperty;
}

/** Block content to add as the page body. */
export interface NotionParagraphBlock {
	object: "block";
	type: "paragraph";
	paragraph: { rich_text: NotionRichText[] };
}

// ── API request / response types ───────────────────────────────────

export interface NotionCreatePageRequest {
	parent: { database_id: string };
	properties: NotionTodoProperties;
	children?: NotionParagraphBlock[];
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
		dueDate?: string;
		bodyText?: string;
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

	if (params.dueDate) {
		properties["Due Date"] = { date: { start: params.dueDate } };
	}

	const children: NotionParagraphBlock[] = [];
	if (params.bodyText?.trim()) {
		children.push({
			object: "block",
			type: "paragraph",
			paragraph: {
				rich_text: [{ type: "text", text: { content: params.bodyText } }],
			},
		});
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
		dueDate?: string;
		bodyText?: string;
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
