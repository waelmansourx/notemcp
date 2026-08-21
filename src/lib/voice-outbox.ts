/**
 * A recording is too large for localStorage, but it still needs a crash mat
 * before the network sees it. IndexedDB can structured-clone Blobs, so a tab
 * close or offline upload leaves the actual audio here for the next app open.
 */

const DATABASE = 'notemcp-voice';
const STORE = 'captures';
const VERSION = 1;

export interface VoiceCapture {
	clientId: string;
	blob: Blob;
	durationMs: number;
	waveform: number[];
	tagNames: string[];
	parentId: string | null;
	queuedAt: string;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
	});
}

function openDatabase(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined')
		return Promise.reject(new Error('IndexedDB is unavailable'));

	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE, VERSION);
		request.onupgradeneeded = () => {
			const database = request.result;
			if (!database.objectStoreNames.contains(STORE)) {
				database.createObjectStore(STORE, { keyPath: 'clientId' });
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error ?? new Error('Could not open voice outbox'));
	});
}

async function transaction<T>(
	mode: IDBTransactionMode,
	work: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	const database = await openDatabase();
	try {
		const tx = database.transaction(STORE, mode);
		const result = await requestResult(work(tx.objectStore(STORE)));
		await new Promise<void>((resolve, reject) => {
			tx.oncomplete = () => resolve();
			tx.onerror = () => reject(tx.error ?? new Error('Voice outbox transaction failed'));
			tx.onabort = () => reject(tx.error ?? new Error('Voice outbox transaction aborted'));
		});
		return result;
	} finally {
		database.close();
	}
}

export async function storeVoiceCapture(capture: VoiceCapture): Promise<boolean> {
	try {
		await transaction('readwrite', (store) => store.put(capture));
		return true;
	} catch {
		return false;
	}
}

export async function removeVoiceCapture(clientId: string): Promise<void> {
	try {
		await transaction('readwrite', (store) => store.delete(clientId));
	} catch {
		// R2 already has the source of truth at the point this is called. A
		// stale local retry record is harmless and can be removed next time.
	}
}

export async function loadVoiceCaptures(): Promise<VoiceCapture[]> {
	try {
		return await transaction('readonly', (store) => store.getAll());
	} catch {
		return [];
	}
}
