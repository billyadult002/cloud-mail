import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('local_d1_non_finite_number');
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString('hex')}'`;
  return `'${String(value).replaceAll("'", "''")}'`;
}

function render(sql, values) {
  let implicit = 0;
  return sql.replace(/\?(\d+)?/g, (_match, explicit) => {
    const index = explicit ? Number(explicit) - 1 : implicit++;
    if (index < 0 || index >= values.length) throw new Error('local_d1_parameter_missing');
    return sqlLiteral(values[index]);
  });
}

function resultEnvelope(payload) {
  const result = Array.isArray(payload) ? payload.at(-1) : payload;
  if (!result?.success) throw new Error('local_d1_remote_query_failed');
  return { results: result.results || [], meta: result.meta || {} };
}

export function createRemoteD1Adapter({ database = 'cloud-mail', cwd = process.cwd(), profile } = {}) {
  async function execute(sql) {
    const args = ['d1', 'execute', database, '--remote', '--command', sql, '--json'];
    if (profile) args.push('--profile', profile);
    const { stdout } = await execFileAsync('npx', ['wrangler', ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return resultEnvelope(JSON.parse(stdout));
  }
  function statement(sql, values = []) {
    return {
      __localD1Statement: true,
      sql,
      values,
      bind(...next) { return statement(sql, next); },
      async all() { return execute(render(sql, values)); },
      async first(column) { const row = (await execute(render(sql, values))).results[0] || null; return column && row ? row[column] : row; },
      async run() { return execute(render(sql, values)); },
    };
  }
  return {
    prepare(sql) { return statement(sql); },
    async batch(statements) {
      if (!statements.every(x => x?.__localD1Statement)) throw new TypeError('local_d1_batch_statement_required');
      const sql = ['BEGIN IMMEDIATE', ...statements.map(x => render(x.sql, x.values)), 'COMMIT'].join(';');
      return [await execute(sql)];
    },
  };
}
