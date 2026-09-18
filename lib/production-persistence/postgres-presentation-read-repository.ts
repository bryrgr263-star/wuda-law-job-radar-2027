import {
  assertPresentationReadModelIntegrity,
  type PresentationReadModel,
  type PresentationReadRepository
} from "../ingestion";
import type { PostgresExecutor } from "./contracts";

export class PostgresPresentationReadRepository
implements PresentationReadRepository {
  readonly #database: PostgresExecutor;

  constructor(database: PostgresExecutor) {
    this.#database = database;
  }

  async listCurrentReadModels(): Promise<readonly PresentationReadModel[]> {
    const result = await this.#database.query<{ record_json: unknown }>(`
      select projection.record_json
      from trusted_chain.presentation_read_model_projections projection
      where projection.scope = 'PRODUCTION'
        and not exists (
          select 1
          from trusted_chain.presentation_read_model_projections later
          where later.scope = projection.scope
            and later.opportunity_candidate_id = projection.opportunity_candidate_id
            and later.decision_revision > projection.decision_revision
        )
      order by (projection.record_json->>'updated_at')::timestamptz desc,
        projection.presentation_read_model_id asc
    `);
    return result.rows.map((row) => {
      const record = typeof row.record_json === "string"
        ? JSON.parse(row.record_json) as PresentationReadModel
        : structuredClone(row.record_json) as PresentationReadModel;
      return assertPresentationReadModelIntegrity(record);
    });
  }
}
