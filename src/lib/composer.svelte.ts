/**
 * What the composer is filing into.
 *
 * The expensive part of adding to something you already wrote was never the
 * typing — it was having to go and find the thing first, by which point the
 * thought is gone. So the container comes to the composer instead: you pick a
 * tag once, and for the next half hour the composer stays in it the way a chat
 * window stays open. Leaving is one tap and always visible, because the
 * failure mode of a sticky container is quietly writing into the wrong one.
 *
 * This used to hold a *note* — the one you were continuing. A tag holds the
 * same gesture without the asymmetry: filing into `#dental` doesn't make some
 * earlier thought the thing this one is a comment on.
 */

const KEY = 'notemcp:filing';

/** How long a tag stays "the one you're in" without you saying so again. Long
 *  enough to cover a train of thought, short enough that tomorrow's first note
 *  is never quietly filed under yesterday's. */
const STICKY_MS = 30 * 60 * 1000;

interface Stored {
	tag: string;
	at: number;
}

export const filing = $state<{ tag: string | null; pendingOpen: boolean }>({
	tag: null,
	/** Set by openIn(), cleared by the composer when it opens. A request rather
	 *  than an event, so tapping "+" on a screen with no composer still opens
	 *  the sheet once you're back on one that has it. */
	pendingOpen: false
});

function persist(tag: string | null) {
	if (typeof localStorage === 'undefined') return;
	try {
		if (!tag) {
			localStorage.removeItem(KEY);
			return;
		}
		const payload: Stored = { tag, at: Date.now() };
		localStorage.setItem(KEY, JSON.stringify(payload));
	} catch {
		/* full or unavailable — stickiness is a convenience, never state */
	}
}

/** Put the composer in a tag. Also restarts the sticky window, so writing
 *  three thoughts in a row keeps you where you are. */
export function fileInto(tag: string) {
	filing.tag = tag;
	persist(tag);
}

/** Leave. The next thought stands on its own again. */
export function unfile() {
	filing.tag = null;
	persist(null);
}

/** File *and* open the sheet — what tapping "+" on a group does. */
export function openIn(tag: string) {
	fileInto(tag);
	filing.pendingOpen = true;
}

/** Restore the tag you were in, if it was recent enough to still mean
 *  something. Called once, on mount. */
export function restore() {
	if (typeof localStorage === 'undefined') return;
	try {
		const raw = localStorage.getItem(KEY);
		if (!raw) return;
		const stored = JSON.parse(raw) as Stored;
		if (!stored?.tag || Date.now() - stored.at > STICKY_MS) {
			localStorage.removeItem(KEY);
			return;
		}
		filing.tag = stored.tag;
	} catch {
		/* unreadable — start unfiled, which is the safe default */
	}
}
