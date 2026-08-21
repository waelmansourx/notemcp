export interface Tag {
	id: string;
	name: string;
}

export type TranscriptionStatus = 'pending' | 'processing' | 'complete' | 'failed';

export interface VoiceNote {
	/** Null only while a freshly recorded blob is still being copied to R2. */
	media_id: string | null;
	duration_ms: number;
	waveform: number[];
	transcription_status: TranscriptionStatus;
	raw_text: string | null;
	error: string | null;
	language_code: string | null;
	/** Browser-only playback URL for a capture that has not reached R2 yet. */
	local_url?: string | null;
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
	/** The note this one continues, when it isn't the first thought in a
	 *  thread. Threads are flat: a continuation never has continuations. */
	parent_id: string | null;
	folder_id: string | null;
	pinned: boolean;
	archived: boolean;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	tags: Tag[];
	/** Present when the thought originated as a durable R2 voice recording. */
	voice_note?: VoiceNote | null;
	/** Thoughts appended to this one, oldest first. Only ever set on the note
	 *  at the head of a thread, and only by the loaders that assemble one. */
	children?: Note[];
}

export const QUICK_TAGS = ['inspo', 'blog', 'code', 'read', 'idea'] as const;

/**
 * Just enough of a thread to offer it as somewhere to write.
 *
 * The composer's recent strip needs a picture, a handle and a count — never a
 * note's body, which for a captured photo is a base64 data URL running to
 * megabytes. Built on the server from the `preview` computed column.
 */
export interface ThreadStub {
	id: string;
	label: string;
	image: string | null;
	source: string | null;
	/** Thoughts added since the first one. */
	count: number;
	at: string;
	/** The entity's tags, carried along so continuing it can inherit them
	 *  without a second round trip — see composer.svelte.ts's `attach`. */
	tags: Tag[];
}
