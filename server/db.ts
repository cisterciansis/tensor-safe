// Storage behind the small prepared-statement API the routes use.
// SQLite for local and self-hosted single-node use; Postgres when the server
// has no durable disk (a Nitro enclave), via DATABASE_URL.
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import postgres from 'postgres';

type Value = string | number | null;
type Changes = { meta: { changes: number } };
export type Statement = {
  sql: string;
  values: Value[];
  bind(...values: Value[]): Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<Changes>;
};
export type Database = {
  prepare(sql: string): Statement;
  /** Runs every statement in one transaction; any failure rolls all back. */
  batch(statements: Statement[]): Promise<Changes[]>;
};
type Backend = {
  query(
    sql: string,
    values: Value[],
  ): Promise<{ rows: unknown[]; changes: number }>;
  transaction(statements: Statement[]): Promise<Changes[]>;
};

function statements(backend: Backend) {
  const prepare = (sql: string, values: Value[] = []): Statement => ({
    sql,
    values,
    bind: (...next) => prepare(sql, next),
    first: async <T>() =>
      ((await backend.query(sql, values)).rows[0] as T | undefined) ?? null,
    all: async <T>() => ({
      results: (await backend.query(sql, values)).rows as T[],
    }),
    run: async () => ({
      meta: { changes: (await backend.query(sql, values)).changes },
    }),
  });
  return { prepare, batch: (list: Statement[]) => backend.transaction(list) };
}

export function openSqlite(path: string, migrations: string): Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new DatabaseSync(path);
  sqlite.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  const exec = (sql: string, values: Value[]) => {
    const statement = sqlite.prepare(sql);
    // Reads return rows; writes (including RETURNING) report changes too.
    if (statement.columns().length) {
      const rows = statement.all(...(values as SQLInputValue[]));
      return { rows, changes: rows.length };
    }
    const r = statement.run(...(values as SQLInputValue[]));
    return { rows: [], changes: Number(r.changes) };
  };
  const inTransaction = <T>(work: () => T) => {
    sqlite.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      sqlite.exec('COMMIT');
      return result;
    } catch (e) {
      sqlite.exec('ROLLBACK');
      throw e;
    }
  };
  const current = Number(
    (sqlite.prepare('PRAGMA user_version').get() as { user_version: number })
      .user_version,
  );
  for (const [version, sql] of pending(migrations, current))
    inTransaction(() => {
      sqlite.exec(sql);
      sqlite.exec(`PRAGMA user_version = ${version}`);
    });
  return statements({
    query: async (sql, values) => exec(sql, values),
    transaction: async (list) =>
      inTransaction(() =>
        list.map((s) => ({ meta: { changes: exec(s.sql, s.values).changes } })),
      ),
  });
}

/** Postgres with `?` placeholders rewritten to $n (no SQL here contains a literal ?). */
export async function openPostgres(
  url: string,
  migrations: string,
): Promise<Database> {
  // TLS comes from the URL, e.g. ?sslmode=verify-full for a managed database.
  const sql = postgres(url, { max: 10, onnotice: () => {} });
  const numbered = (text: string) => {
    let n = 0;
    return text.replace(/\?/g, () => `$${++n}`);
  };
  const run = async (
    client: postgres.Sql | postgres.TransactionSql,
    text: string,
    values: Value[],
  ) => {
    const result = await client.unsafe(numbered(text), values);
    return { rows: [...result], changes: result.count };
  };
  await sql`CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY)`;
  const [{ current }] = await sql<
    { current: number }[]
  >`SELECT coalesce(max(version), 0)::int AS current FROM schema_migrations`;
  for (const [version, text] of pending(migrations, current))
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`INSERT INTO schema_migrations(version) VALUES (${version})`;
    });
  return statements({
    query: (text, values) => run(sql, text, values),
    transaction: async (list) =>
      (await sql.begin(async (tx) => {
        const out: Changes[] = [];
        for (const s of list)
          out.push({
            meta: { changes: (await run(tx, s.sql, s.values)).changes },
          });
        return out;
      })) as Changes[],
  });
}

// Numbered .sql files apply once, in order.
function pending(dir: string, current: number): [number, string][] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map(
      (f) =>
        [Number(f.slice(0, 4)), readFileSync(join(dir, f), 'utf8')] as [
          number,
          string,
        ],
    )
    .filter(([version]) => version > current);
}
