import type { Note } from './types';

function startOfDay(d: Date): number {
	return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function groupByRecency(notes: Note[]) {
	const today = startOfDay(new Date());
	const weekAgo = today - 6 * 86_400_000;

	const groups: { label: string; notes: Note[] }[] = [
		{ label: 'Today', notes: [] },
		{ label: 'This week', notes: [] },
		{ label: 'Earlier', notes: [] }
	];

	for (const note of notes) {
		const day = startOfDay(new Date(note.created_at));
		if (day >= today) groups[0].notes.push(note);
		else if (day >= weekAgo) groups[1].notes.push(note);
		else groups[2].notes.push(note);
	}

	return groups.filter((g) => g.notes.length > 0);
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
