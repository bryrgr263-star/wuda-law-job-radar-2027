import postgres, { type Sql } from "postgres";

import type { PostgresExecutor } from "./contracts";

export class PostgresJsExecutor implements PostgresExecutor {
  readonly #sql: Sql;
  readonly #ownsConnection: boolean;

  constructor(connection: string | Sql) {
    this.#ownsConnection = typeof connection === "string";
    this.#sql = typeof connection === "string"
      ? postgres(connection, { max: 4, prepare: true })
      : connection;
  }

  async query<Row>(sql: string, parameters: readonly unknown[] = []) {
    const rows = await this.#sql.unsafe<Row[]>(sql, [...parameters] as never[]);
    return { rows: [...rows] };
  }

  async transaction<Result>(
    work: (executor: PostgresExecutor) => Promise<Result>
  ): Promise<Result> {
    return this.#sql.begin(async (transaction) => {
      return work(new PostgresJsExecutor(transaction));
    }) as Promise<Result>;
  }

  async close() {
    if (this.#ownsConnection) await this.#sql.end({ timeout: 5 });
  }
}
