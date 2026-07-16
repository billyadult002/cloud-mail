// Runtime adapter only: it preserves the Worker D1 prepared-statement and batch
// contract while moving transport to the documented D1 HTTP Query API.
function result(value) {
  if (!value?.success || !Array.isArray(value.result)) throw new Error('d1_http_query_failed');
  return value.result;
}

export function createD1TransactionalHttpTransport({ accountId, databaseId, apiToken, fetchImpl = fetch }) {
  if (!accountId || !databaseId || !apiToken) throw new Error('d1_http_transport_configuration_required');
  const url = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  async function query(body) {
    const response = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`d1_http_status_${response.status}`);
    return result(await response.json());
  }
  function statement(sql, params = []) {
    return {
      __d1HttpStatement: true, sql, params,
      bind(...next) { return statement(sql, next); },
      async all() { const [entry] = await query({ sql, params }); return entry; },
      async first(column) { const row = (await this.all()).results?.[0] ?? null; return column && row ? row[column] : row; },
      async run() { const [entry] = await query({ sql, params }); return entry; },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      if (!statements.every(x => x?.__d1HttpStatement)) throw new TypeError('d1_http_batch_statement_required');
      return query({ batch: statements.map(({ sql, params }) => ({ sql, params })) });
    },
  };
}
