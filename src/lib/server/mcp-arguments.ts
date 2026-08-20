type RpcArgs = Record<string, unknown>;

/**
 * Copy only arguments the caller actually sent. Postgres distinguishes an
 * omitted optional parameter from an explicit null, so undefined/null values
 * must not be forwarded into the RPC body.
 */
export function pickDefined(
	args: Record<string, unknown>,
	mapping: Record<string, string>,
	into: RpcArgs
): RpcArgs {
	for (const [arg, param] of Object.entries(mapping)) {
		if (args[arg] !== undefined && args[arg] !== null) into[param] = args[arg];
	}
	return into;
}

export function searchNotesRpcArgs(
	token: string,
	args: Record<string, unknown>,
	limit: number,
	offset?: number
): RpcArgs {
	const result = pickDefined(
		args,
		{
			tags: 'p_tags',
			offset: 'p_offset',
			archived: 'p_archived',
			full: 'p_full',
			source_type: 'p_source_type',
			source_domain: 'p_source_domain',
			has_source: 'p_has_source',
			has_photos: 'p_has_photos',
			created_after: 'p_created_after',
			created_before: 'p_created_before',
			updated_after: 'p_updated_after',
			updated_before: 'p_updated_before',
			root_id: 'p_root_id'
		},
		{ p_token: token, p_query: String(args.query ?? ''), p_limit: limit }
	);
	if (offset !== undefined) result.p_offset = offset;
	return result;
}

export function semanticSearchNotesRpcArgs(
	token: string,
	args: Record<string, unknown>,
	embedding: number[],
	limit: number,
	offset?: number
): RpcArgs {
	const result = pickDefined(
		args,
		{
			tags: 'p_tags',
			offset: 'p_offset',
			archived: 'p_archived',
			full: 'p_full',
			source_type: 'p_source_type',
			source_domain: 'p_source_domain',
			has_source: 'p_has_source',
			has_photos: 'p_has_photos',
			created_after: 'p_created_after',
			created_before: 'p_created_before',
			updated_after: 'p_updated_after',
			updated_before: 'p_updated_before',
			root_id: 'p_root_id'
		},
		{ p_token: token, p_query_embedding: embedding, p_limit: limit }
	);
	if (offset !== undefined) result.p_offset = offset;
	return result;
}
