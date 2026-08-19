import type { Note } from './types';

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Today" / "Yesterday" / "Monday" / "11 Aug" / "11 Aug 2025" — the same day
 *  label the stream groups notes under, factored out so anything else that
 *  buckets by day (the tags list, in particular) reads identically. */
export function dayLabel(dateMs: number): string {
	const today = startOfDay(new Date());
	const yesterday = today - 86_400_000;
	const weekAgo = today - 6 * 86_400_000;
	const thisYear = new Date().getFullYear();
	const day = startOfDay(new Date(dateMs));
	const date = new Date(day);

	if (day === today) return 'Today';
	if (day === yesterday) return 'Yesterday';
	if (day > weekAgo) return date.toLocaleDateString(undefined, { weekday: 'long' });
	return date.toLocaleDateString(undefined, {
		day: 'numeric',
		month: 'short',
		year: date.getFullYear() === thisYear ? undefined : 'numeric'
	});
}

export interface DayGroup {
	/** Stable key for {#each} — the day's epoch ms. */
	key: number;
	label: string;
	notes: Note[];
}

/** The moment the stream sorts and groups by. A note you edited today belongs
 *  under Today — where you'll look for it — not under the day you first had
 *  the thought. */
export function streamDate(note: Note): string {
	return note.updated_at || note.created_at;
}

export function groupByDay(notes: Note[]): DayGroup[] {
	const buckets = new Map<number, Note[]>();
	for (const note of notes) {
		const day = startOfDay(new Date(streamDate(note)));
		const bucket = buckets.get(day);
		if (bucket) bucket.push(note);
		else buckets.set(day, [note]);
	}

	return [...buckets.entries()]
		.sort((a, b) => b[0] - a[0])
		.map(([day, dayNotes]) => ({ key: day, label: dayLabel(day), notes: dayNotes }));
}

/** "7:42 PM" — the inline form used on today's entries. */
export function timeOfDay(iso: string): string {
	return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** Full stamp, for when someone actually asks for the metadata. */
export function fullTimestamp(iso: string): string {
	return new Date(iso).toLocaleString(undefined, {
		weekday: 'short',
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: 'numeric',
		minute: '2-digit'
	});
}

export function relativeTime(iso: string): string {
	const diffMs = Date.now() - new Date(iso).getTime();
	const diffMin = Math.round(diffMs / 60_000);
	if (diffMin < 1) return 'now';
	if (diffMin < 60) return `${diffMin}m`;
	const diffHr = Math.round(diffMin / 60);
	if (diffHr < 24) return `${diffHr}h`;
	const diffDay = Math.round(diffHr / 24);
	if (diffDay < 7) return `${diffDay}d`;
	return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function hostname(url: string): string {
	try {
		return new URL(url).hostname.replace(/^www\./, '');
	} catch {
		return url;
	}
}
