import type { Tag } from './types';
import { loadRecentTags, saveRecentTags } from './cache';

/**
 * The tag row every capture surface offers.
 *
 * It comes from the root layout, which streams it rather than blocking
 * navigation on it (see +layout.server.ts) — so the composer and the share
 * sheet read it from here instead of from `page.data`, and open with the row
 * you had last time rather than with an empty one that fills in a moment
 * later. On the share sheet that's the difference between having your tags and
 * not: you're on that screen for two seconds.
 *
 * Initialised straight from storage rather than in an effect, because the
 * surfaces that read it are often mounted before the layout gets a chance to.
 */
export const suggestions = $state<{ recent: Tag[] }>({ recent: loadRecentTags() ?? [] });

export function setSuggestions(recent: Tag[]) {
	suggestions.recent = recent;
	saveRecentTags(recent);
}
