import {
  PostgresJsExecutor,
  PostgresPresentationReadRepository
} from "../production-persistence";
import { ReadOnlyPresentationApi } from "./api";
import type { PresentationReadRepository } from "../ingestion/persistence";

export function composeReadOnlyPresentationApi(input: string | PresentationReadRepository) {
  if (typeof input !== "string") {
    return { api: new ReadOnlyPresentationApi(input), async close() {} };
  }
  const database = new PostgresJsExecutor(input);
  return {
    api: new ReadOnlyPresentationApi(
      new PostgresPresentationReadRepository(database)
    ),
    async close() { await database.close(); }
  };
}
