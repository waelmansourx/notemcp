export type LinkPreviewSnapshot = {
	url: string | null;
	title: string | null;
	description: string | null;
	image: string | null;
};

const emptyPreview = (): LinkPreviewSnapshot => ({
	url: null,
	title: null,
	description: null,
	image: null
});

/** Shared link state for every writing surface. A newer request always wins. */
export class LinkPreview {
	url = $state<string | null>(null);
	title = $state<string | null>(null);
	description = $state<string | null>(null);
	image = $state<string | null>(null);
	loading = $state(false);
	#request = 0;

	constructor(initial: Partial<LinkPreviewSnapshot> = {}) {
		this.restore({ ...emptyPreview(), ...initial });
	}

	restore(snapshot: LinkPreviewSnapshot) {
		this.#request++;
		this.loading = false;
		this.url = snapshot.url;
		this.title = snapshot.title;
		this.description = snapshot.description;
		this.image = snapshot.image;
	}

	snapshot(): LinkPreviewSnapshot {
		return {
			url: this.url,
			title: this.title,
			description: this.description,
			image: this.image
		};
	}

	clear() {
		this.restore(emptyPreview());
	}

	async fetch(url: string) {
		const request = ++this.#request;
		this.url = url;
		this.title = null;
		this.description = null;
		this.image = null;
		this.loading = true;

		try {
			const response = await globalThis.fetch(`/api/link-preview?url=${encodeURIComponent(url)}`);
			if (!response.ok || request !== this.#request) return;
			const preview = await response.json();
			if (request !== this.#request) return;
			this.title = preview.title ?? null;
			this.description = preview.description ?? null;
			this.image = preview.image ?? null;
		} catch {
			// A URL remains useful even when its richer metadata cannot be fetched.
		} finally {
			if (request === this.#request) this.loading = false;
		}
	}
}
