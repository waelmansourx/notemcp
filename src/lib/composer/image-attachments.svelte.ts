import { beginMediaUpload, compressImage, type PendingMedia } from '$lib/media';

export type ImageAttachment = {
	key: string;
	dataUrl: string;
	mediaId: string | null;
	uploadStart: Promise<PendingMedia> | null;
	uploadError: boolean;
	processing: boolean;
};

export type ImageAttachmentOptions = {
	maxCount?: number;
	maxSourceBytes?: number;
	maxBytes?: number;
	onPrepared?: () => void;
};

export function imageFilesFrom(data: DataTransfer | null): File[] {
	if (!data) return [];
	const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
	if (files.length > 0) return files;
	return Array.from(data.items)
		.filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
		.map((item) => item.getAsFile())
		.filter((file): file is File => file !== null);
}

function dataUrlFor(blob: Blob): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(reader.result as string);
		reader.onerror = () => reject(reader.error);
		reader.readAsDataURL(blob);
	});
}

export class ImageAttachments {
	items = $state<ImageAttachment[]>([]);
	error = $state<string | null>(null);
	dragging = $state(false);
	#preparations = new Set<Promise<void>>();
	#maxCount: number;
	#maxSourceBytes: number;
	#maxBytes: number;
	#onPrepared?: () => void;

	constructor(options: ImageAttachmentOptions = {}) {
		this.#maxCount = options.maxCount ?? 10;
		this.#maxSourceBytes = options.maxSourceBytes ?? 25 * 1024 * 1024;
		this.#maxBytes = options.maxBytes ?? 4 * 1024 * 1024;
		this.#onPrepared = options.onPrepared;
	}

	attach(sources: Blob[]) {
		const images = sources.filter((source) => source.type.startsWith('image/'));
		if (images.length === 0) return;
		this.error = null;
		const remaining = this.#maxCount - this.items.length;
		if (remaining <= 0) {
			this.error = `You can attach up to ${this.#maxCount} image${this.#maxCount === 1 ? '' : 's'}.`;
			return;
		}
		if (images.length > remaining) {
			this.error = `You can attach up to ${this.#maxCount} image${this.#maxCount === 1 ? '' : 's'}.`;
		}

		for (const source of images.slice(0, remaining)) {
			if (source.size > this.#maxSourceBytes) {
				this.error = 'One of those images is too large to process (25MB max).';
				continue;
			}

			const attachment = $state<ImageAttachment>({
				key: crypto.randomUUID(),
				dataUrl: '',
				mediaId: null,
				uploadStart: null,
				uploadError: false,
				processing: true
			});
			this.items.push(attachment);

			const preparation = (async () => {
				try {
					const { blob } = await compressImage(source, { maxBytes: this.#maxBytes });
					if (blob.size > this.#maxBytes) {
						attachment.uploadError = true;
						this.error = 'One image is still over 4MB after compression.';
						return;
					}
					attachment.dataUrl = await dataUrlFor(blob);
					const started = beginMediaUpload(blob, 'image');
					attachment.uploadStart = started;
					started
						.then(({ id, whenUploaded }) => {
							attachment.mediaId = id;
							whenUploaded.catch(() => {
								attachment.mediaId = null;
								attachment.uploadError = true;
							});
						})
						.catch(() => (attachment.uploadError = true));
				} catch {
					attachment.uploadError = true;
				} finally {
					attachment.processing = false;
					this.#onPrepared?.();
				}
			})();
			this.#preparations.add(preparation);
			preparation.finally(() => this.#preparations.delete(preparation));
		}
	}

	remove(key: string) {
		this.items = this.items.filter((item) => item.key !== key);
		if (this.items.every((item) => !item.uploadError)) this.error = null;
	}

	clear() {
		this.items = [];
		this.error = null;
		this.dragging = false;
	}

	async waitForIds() {
		await Promise.allSettled([...this.#preparations]);
		await Promise.allSettled(
			this.items
				.filter((item) => !item.mediaId && !item.uploadError)
				.map((item) => item.uploadStart)
		);
	}

	async waitForUploads(items = this.items) {
		await this.waitForIds();
		await Promise.allSettled(
			items.map(async (item) => {
				const pending = await item.uploadStart;
				if (pending) await pending.whenUploaded;
			})
		);
	}

	markdown(alt = ''): string {
		return this.items
			.filter((item) => item.mediaId)
			.map((item) => `![${alt}](/api/media/${item.mediaId})`)
			.join('\n\n');
	}
}
