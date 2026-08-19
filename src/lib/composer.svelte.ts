import type { ThreadStub } from './types';

/**
 * What the composer is writing into.
 *
 * The expensive part of adding to an existing note was never the typing — it
 * was having to go and find the note first, by which point the thought is
 * gone. So the target comes to the composer instead: you pick a thread once,
 * and for the next half hour the composer stays attached to it the way a chat
 * window stays open. Detaching is one tap and always visible, because the
 * failure mode of a sticky context is writing into the wrong place.
 */

const KEY = 'notemcp:continuing';

/** How long a thread stays "the one you're in" without you saying so again.
 *  Long enough to cover a train of thought, short enough that tomorrow's
 *  first note is never quietly filed under yesterday's. */
const STICKY_MS = 30 * 60 * 1000;

interface Stored {
	stub: ThreadStub;
	at: number;
}

export const continuation = $state<{ target: ThreadStub | null; pendingOpen: boolean }>({
	target: null,
	/** Set by writeInto(), cleared by the composer when it opens. A request
	 *  rather than an event, so tapping "+" on the note page still opens the
	 *  sheet once you're back on a screen that has one. */
	pendingOpen: false
});

function persist(stub: ThreadStub | null) {
	if (typeof localStorage === 'undefined') return;
	try {
		if (!stub) {
			localStorage.removeItem(KEY);
			return;
		}
		// An embedded photo is a base64 data URL; it belongs nowhere near a
		// storage budget a queued capture might need.
		const image = stub.image?.startsWith('data:') ? null : stub.image;
		const payload: Stored = { stub: { ...stub, image }, at: Date.now() };
		localStorage.setItem(KEY, JSON.stringify(payload));
	} catch {
		/* full or unavailable — stickiness is a convenience, never state */
	}
}

/** Point the composer at a thread. */
export function attach(stub: ThreadStub) {
	continuation.target = stub;
	persist(stub);
}

/** Leave the thread. The next thought stands on its own again. */
export function detach() {
	continuation.target = null;
	persist(null);
}

/** Attach *and* open the sheet — what tapping "+" on a thread does. */
export function writeInto(stub: ThreadStub) {
	attach(stub);
	continuation.pendingOpen = true;
}

/** Keep the window open after saving into a thread: three thoughts in a row
 *  are one train of thought, not three separate decisions. */
export function touch() {
	if (continuation.target) persist(continuation.target);
}

/** Restore the thread you were in, if it was recent enough to still mean
 *  something. Called once, on mount. */
export function restore() {
	if (typeof localStorage === 'undefined') return;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return;
		const stored = JSON.parse(raw) as Stored;
		if (!stored?.stub?.id || Date.now() - stored.at > STICKY_MS) {
			localStorage.removeItem(KEY);
			return;
		}
		continuation.target = stored.stub;
	} catch {
		/* unreadable — start unattached, which is the safe default */
	}
}
