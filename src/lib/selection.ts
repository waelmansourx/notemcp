/**
 * Selecting text inside something that is also a link.
 *
 * The stream is made of thoughts you want to quote — but every entry is
 * wrapped in an <a>, so finishing a drag-select lands a click and throws you
 * onto the note page with the selection gone. Guarding the click keeps both:
 * a tap still opens the note, a drag that actually selected some of this
 * entry's text does not.
 */

/** Suppress a navigation whose click was really the end of a text selection
 *  inside this element. */
export function keepSelection(event: MouseEvent) {
	const sel = typeof window === 'undefined' ? null : window.getSelection();
	if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

	// A selection somewhere else on the page is unrelated — a plain click
	// collapses it before this fires, so anything still standing here and
	// anchored inside us is the drag that just ended.
	const el = event.currentTarget as HTMLElement | null;
	if (!el || !sel.anchorNode || !el.contains(sel.anchorNode)) return;

	event.preventDefault();
}
