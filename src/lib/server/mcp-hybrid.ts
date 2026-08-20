type RankedNote = Record<string, unknown> & { id?: unknown };

const RRF_K = 60;
const KEYWORD_WEIGHT = 0.55;
const SEMANTIC_WEIGHT = 0.45;

/** Reciprocal-rank fusion keeps either retriever useful while rewarding notes
 * that both lexical and semantic retrieval agree on. */
export function fuseNoteRanks(
	keyword: RankedNote[],
	semantic: RankedNote[],
	offset: number,
	limit: number
): RankedNote[] {
	const ranked = new Map<
		string,
		{ note: RankedNote; score: number; bestRank: number; insertion: number }
	>();
	let insertion = 0;

	function add(notes: RankedNote[], weight: number) {
		notes.forEach((note, index) => {
			if (typeof note.id !== 'string') return;
			const rank = index + 1;
			const current = ranked.get(note.id);
			if (current) {
				current.score += weight / (RRF_K + rank);
				current.bestRank = Math.min(current.bestRank, rank);
				return;
			}
			ranked.set(note.id, {
				note,
				score: weight / (RRF_K + rank),
				bestRank: rank,
				insertion: insertion++
			});
		});
	}

	add(keyword, KEYWORD_WEIGHT);
	add(semantic, SEMANTIC_WEIGHT);

	return [...ranked.values()]
		.sort((a, b) => b.score - a.score || a.bestRank - b.bestRank || a.insertion - b.insertion)
		.slice(Math.max(offset, 0), Math.max(offset, 0) + Math.max(limit, 0))
		.map(({ note }) => note);
}

export function hybridCandidateLimit(offset: number, limit: number): number {
	return Math.min(Math.max((Math.max(offset, 0) + Math.max(limit, 1)) * 3, 30), 100);
}
