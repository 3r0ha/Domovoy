import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqlClient } from './sql.js';

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

/** Ключ блокировки на время миграции: реплики поднимаются одновременно. */
const MIGRATION_LOCK = 4_010_912;

/** Прогоняет миграции по порядку имён. */
export const applyMigrations = async (sql: SqlClient, directory = MIGRATIONS_DIR): Promise<string[]> => {
  await sql.query(
    'create table if not exists schema_migration (name text primary key, applied_at timestamptz not null default now())',
  );

  const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort();
  const executed: string[] = [];

  for (const name of files) {
    const applied = await inTransaction(sql, async (client) => {
      await client.query('select pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);

      const { rows } = await client.query<{ name: string }>('select name from schema_migration where name = $1', [
        name,
      ]);

      if (rows.length > 0) return false;

      await client.query(await readFile(join(directory, name), 'utf8'));
      await client.query('insert into schema_migration (name) values ($1)', [name]);

      return true;
    });

    if (applied) executed.push(name);
  }

  return executed;
};

const inTransaction = async <T>(sql: SqlClient, run: (client: SqlClient) => Promise<T>): Promise<T> => {
  if (sql.transaction) return sql.transaction(run);

  await sql.query('begin');

  try {
    const result = await run(sql);

    await sql.query('commit');
    return result;
  } catch (error) {
    await sql.query('rollback').catch(() => undefined);
    throw error;
  }
};

/** Очищает данные, оставляя схему. */
export const clearData = async (sql: SqlClient): Promise<void> => {
  const { rows } = await sql.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public' and tablename <> 'schema_migration'",
  );

  if (rows.length === 0) return;

  await sql.query(`truncate table ${rows.map((row) => `"${row.tablename}"`).join(', ')} restart identity cascade`);
};
