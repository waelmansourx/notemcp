export interface Tag {
	id: string;
	name: string;
}

export interface Note {
	id: string;
	user_id: string;
	/** The id the capturing client generated, when there was one. Lets a
	 *  locally-queued note be matched to its saved row without guessing. */
	client_id?: string | null;
	title: string;
	content_markdown: string;
	source_url: string | null;
	source_type: string | null;
	source_title: string | null;
	source_description: string | null;
	source_image: string | null;
	/** Legacy. Notes used to hang off one another, which gave a group a head
	 *  and made everything else read as a comment on it. The container is the
	 *  tag now; nothing writes this any more and no read path looks at it. The
	 *  column stays so the notes already carrying one aren't rewritten — they
	 *  are simply ordinary peers inside whatever tags they have. */
	parent_id: string | null;
	folder_id: string | null;
	pinned: boolean;
	archived: boolean;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	tags: Tag[];
}

export const QUICK_TAGS = ['inspo', 'blog', 'code', 'read', 'idea'] as const;

/**
 * A tag seen as the thing it actually is: a container with notes in it.
 *
 * This is what the composer files into and what the editor reads a note
 * inside. It carries weight and recency because that is what makes a tag feel
 * like a place you're in rather than a label you applied.
 */
export interface GroupStub {
	name: string;
	/** How many notes carry it, within the window the loader looked at. */
	count: number;
	/** When anything in it was last touched. */
	at: string;
}

/**
 * One note, card-sized: a picture, a handle, a time.
 *
 * Deliberately never a body — a captured photo's is a base64 data URL running
 * to megabytes, and a list of those is how the tags page once shipped several
 * megabytes of text into the HTML and fell over.
 */
export interface NoteStub {
	id: string;
	label: string;
	image: string | null;
	source: string | null;
	at: string;
}
