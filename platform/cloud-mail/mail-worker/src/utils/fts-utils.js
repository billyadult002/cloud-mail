// FTS5 query construction (WF-7 / WP-C).
// Turns a free-text user term into a safe FTS5 MATCH expression with prefix
// matching, so search is index-served instead of a leading-wildcard LIKE scan.
// Pure + testable.

// FTS5 special characters that must not leak into the query as operators.
const TOKEN = /[A-Za-z0-9À-￿]+/g;

export function buildFtsQuery(term) {
	if (!term) return '';
	const tokens = String(term).match(TOKEN);
	if (!tokens || tokens.length === 0) return '';
	// Each token becomes a quoted prefix term; AND-combined. Quoting neutralizes
	// FTS operators; the trailing * enables prefix search ("wo" matches "world").
	return tokens
		.slice(0, 16) // bound query size
		.map(tok => `"${tok.replace(/"/g, '')}"*`)
		.join(' AND ');
}

export default { buildFtsQuery };
