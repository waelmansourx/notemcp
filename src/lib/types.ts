export interface Tag {
	id: string;
	name: string;
}

export interface Note {
	id: string;
	user_id: string;
	title: string;
	content_markdown: string;
	source_url: string | null;
	source_type: string | null;
	folder_id: string | null;
	pinned: boolean;
	archived: boolean;
	created_at: string;
	updated_at: string;
	deleted_at: string | null;
	tags: Tag[];
}

export const QUICK_TAGS = ['inspo', 'blog', 'code', 'read', 'idea'] as const;
