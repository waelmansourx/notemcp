const PREFIX = 'notemcp:editor-handoff:';

export interface EditorHandoff {
	content: string;
	tags: string[];
	parentId: string | null;
	sourceUrl: string | null;
	sourceTitle: string | null;
	sourceDescription: string | null;
	sourceImage: string | null;
}

function key(id: string) {
	return PREFIX + id;
}

/** Move a quick capture into the full editor without putting its contents in
 * the URL. The payload contains only text and already-signed media references,
 * never image bytes. */
export function saveEditorHandoff(handoff: EditorHandoff): string | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const id = crypto.randomUUID();
		sessionStorage.setItem(key(id), JSON.stringify(handoff));
		return id;
	} catch {
		return null;
	}
}

/** Handoffs are single-use. Once the editor has adopted one, a refresh should
 * recover the editor's normal draft instead of replaying the import. */
export function takeEditorHandoff(id: string): EditorHandoff | null {
	if (typeof sessionStorage === 'undefined') return null;
	try {
		const storageKey = key(id);
		const raw = sessionStorage.getItem(storageKey);
		sessionStorage.removeItem(storageKey);
		if (!raw) return null;
		const value = JSON.parse(raw) as Partial<EditorHandoff>;
		if (typeof value.content !== 'string' || !Array.isArray(value.tags)) return null;
		return {
			content: value.content,
			tags: value.tags.filter((tag): tag is string => typeof tag === 'string'),
			parentId: typeof value.parentId === 'string' ? value.parentId : null,
			sourceUrl: typeof value.sourceUrl === 'string' ? value.sourceUrl : null,
			sourceTitle: typeof value.sourceTitle === 'string' ? value.sourceTitle : null,
			sourceDescription:
				typeof value.sourceDescription === 'string' ? value.sourceDescription : null,
			sourceImage: typeof value.sourceImage === 'string' ? value.sourceImage : null
		};
	} catch {
		return null;
	}
}
