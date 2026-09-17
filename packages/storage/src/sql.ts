/** Минимум от клиента Postgres, который нужен хранилищу. */
export interface SqlClient {
  query<T = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>;
  /** Выполняет несколько запросов одним соединением и одной транзакцией. */
  transaction?<T>(run: (client: SqlClient) => Promise<T>): Promise<T>;
}

/** Транзакция поверх пула соединений. */
export interface ConnectionPool extends SqlClient {
  connect(): Promise<{ query: SqlClient['query']; release: () => void }>;
}

/** Клиент поверх пула, умеющий транзакции. Именно его получает хранилище. */
export const fromPool = (pool: ConnectionPool): SqlClient => ({
  query: (text, values) => pool.query(text, values),
  transaction: (run) => withTransaction(pool, run),
});

export const withTransaction = async <T>(
  pool: ConnectionPool,
  run: (client: SqlClient) => Promise<T>,
): Promise<T> => {
  const client = await pool.connect();

  try {
    await client.query('begin');
    const result = await run({ query: client.query.bind(client) });
    await client.query('commit');

    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};
