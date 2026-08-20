type JsonRecord = Record<string, unknown>;

type PresentedSource = {
	type: string | null;
	domain: string | null;
	title: string | null;
	url: string | null;
	image_available: boolean;
	description?: string | null;
};

export type McpToolResult = {
	content: ({ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string })[];
	structuredContent: JsonRecord;
	isError: boolean;
};

const LIST_NOTE_TOOLS = new Set(['search_notes', 'list_recent_notes']);

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const cleaned = value.replace(/\s+/g, ' ').trim();
	return cleaned || null;
}

function storedText(value: unknown): string | null {
	return typeof value === 'string' && value.trim() ? value : null;
}

function truncate(value: string | null, max: number): string | null {
	if (!value || value.length <= max) return value;
	return `${value.slice(0, max - 1).trimEnd()}…`;
}

function sourceDomain(value: unknown): string | null {
	const url = text(value);
	if (!url) return null;

	try {
		return new URL(url).hostname.toLowerCase().replace(/^www\./, '') || null;
	} catch {
		return null;
	}
}

/**
 * `preview` is a PostgREST computed column derived only from
 * `content_markdown`. Share capture stores the user's annotation there and
 * stores fetched page/Instagram copy in source_* fields, so imported metadata
 * can never accidentally become `user_text` here.
 */
function userText(note: JsonRecord): string | null {
	return text(note.preview);
}

function noteSource(note: JsonRecord, rich: boolean): PresentedSource | null {
	const type = text(note.source_type);
	const url = text(note.source_url);
	const domain = sourceDomain(url);
	const importedTitle =
		storedText(note.source_title) ?? (type === 'share' || url ? storedText(note.title) : null);
	const description = storedText(note.source_description);
	const image = storedText(note.source_image);

	if (!type && !url && !importedTitle && !description && !image) return null;

	const source: PresentedSource = {
		type,
		domain,
		title: rich ? importedTitle : truncate(text(importedTitle), 120),
		url,
		image_available: Boolean(image)
	};

	if (rich) source.description = description;

	return source;
}

/** The deliberately small default representation used by search and lists. */
export function compactMcpNote(value: unknown): JsonRecord {
	if (!isRecord(value)) return {};

	const authoredText = userText(value);
	const source = noteSource(value, false);
	// A share's stored title is imported source identity. Prefer the annotation
	// as its handle so a long caption cannot overpower the user's thought.
	const rawLabel =
		text(value.source_type) === 'share' && authoredText ? authoredText : text(value.label);
	const label = truncate(rawLabel ?? source?.title ?? '(untitled)', 80);

	return {
		id: value.id ?? null,
		label,
		user_text: authoredText,
		tags: Array.isArray(value.tags) ? value.tags : [],
		source,
		root_id: value.root_id ?? value.id ?? null,
		parent_id: value.parent_id ?? null,
		is_thread_head: value.is_thread_head ?? value.parent_id == null,
		thread_count: value.thread_count ?? 0,
		pinned: value.pinned ?? false,
		archived: value.archived ?? false,
		created_at: value.created_at ?? null,
		updated_at: value.updated_at ?? null
	};
}

/**
 * Rich notes use one canonical source shape. Legacy source_* fields, preview,
 * and title are intentionally not repeated: label is the note identity,
 * user_text is authored content, and source owns imported metadata.
 */
export function richMcpNote(value: unknown): unknown {
	if (!isRecord(value)) return value;
	const canonical = { ...value };
	for (const duplicate of [
		'title',
		'preview',
		'source_url',
		'source_type',
		'source_title',
		'source_description',
		'source_image'
	]) {
		delete canonical[duplicate];
	}

	const rich: JsonRecord = {
		...canonical,
		user_text: userText(value),
		source: noteSource(value, true)
	};

	if (Array.isArray(value.thread)) {
		rich.thread = value.thread.map(richMcpNote);
	}

	return rich;
}

export function presentMcpPayload(
	toolName: string,
	args: Record<string, unknown>,
	payload: unknown
): unknown {
	if (LIST_NOTE_TOOLS.has(toolName) && Array.isArray(payload)) {
		return payload.map(args.full === true ? richMcpNote : compactMcpNote);
	}

	if (toolName === 'get_note') return richMcpNote(payload);
	return payload;
}

function structuredContent(toolName: string, payload: unknown, isError: boolean): JsonRecord {
	if (isError) return isRecord(payload) ? payload : { error: String(payload) };
	if (LIST_NOTE_TOOLS.has(toolName)) return { notes: Array.isArray(payload) ? payload : [] };
	if (toolName === 'list_tags') return { tags: Array.isArray(payload) ? payload : [] };
	if (isRecord(payload)) return payload;
	return { result: payload };
}

/**
 * MCP 2025-06-18 supports native structuredContent. The text block remains the
 * exact serialized payload older NoteMCP clients already parse.
 */
export function toolResult(toolName: string, payload: unknown, isError = false): McpToolResult {
	return {
		content: [{ type: 'text', text: JSON.stringify(payload) }],
		structuredContent: structuredContent(toolName, payload, isError),
		isError
	};
}

export function imageToolResult(
	metadata: JsonRecord,
	image: { data: string; mimeType: string }
): McpToolResult {
	return {
		content: [
			{ type: 'text', text: JSON.stringify(metadata) },
			{ type: 'image', data: image.data, mimeType: image.mimeType }
		],
		structuredContent: metadata,
		isError: false
	};
}
