import { DatabaseSync } from "node:sqlite";

import { SqliteShadowPersistence } from "../ingestion";
import { ReadOnlyPresentationApi } from "./api";

export function composeShadowReadOnlyPresentationApi(databasePath: string) {
  const database = new DatabaseSync(databasePath, { readOnly: true, allowExtension: false });
  database.exec("PRAGMA query_only = ON");
  return {
    api: new ReadOnlyPresentationApi(new SqliteShadowPersistence(database).presentation),
    close() { database.close(); }
  };
}
