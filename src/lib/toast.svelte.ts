// A single shared toast, mounted once (see Toast.svelte in the root layout)
// and triggered from anywhere via showToast(). Reactive state lives here
// rather than in the component so any module can call showToast() without
// needing a reference to a mounted instance.

const state = $state<{ message: string | null; id: number }>({ message: null, id: 0 });

let morphTimer: ReturnType<typeof setTimeout> | null = null;
let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function toastMessage(): string | null {
	return state.message;
}

/** Shows `message`, optionally morphing into `then` after `morphDelay`ms,
 *  then auto-hiding after `duration`ms (measured from the start, not from
 *  the morph). */
export function showToast(
	message: string,
	opts: { then?: string; morphDelay?: number; duration?: number } = {}
) {
	if (morphTimer) clearTimeout(morphTimer);
	if (hideTimer) clearTimeout(hideTimer);

	const id = ++state.id;
	state.message = message;

	if (opts.then) {
		morphTimer = setTimeout(() => {
			if (state.id === id) state.message = opts.then!;
		}, opts.morphDelay ?? 350);
	}

	hideTimer = setTimeout(() => {
		if (state.id === id) state.message = null;
	}, opts.duration ?? 1800);
}
