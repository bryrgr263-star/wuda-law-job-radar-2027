import { composeGitReadOnlyPresentationApi } from "../presentation-read-api/git-runtime";
import type { PresentationReadModel } from "../ingestion/domain/presentation";
import { toPresentationDisplayJob } from "./model";

export async function loadPresentationBoard(repositoryPath: string,
  streamId = "initial-production-source-activation") {
  const api = composeGitReadOnlyPresentationApi(repositoryPath, streamId);
  const models: PresentationReadModel[] = [];
  let total = 0;
  do {
    const response = await api.handle(new Request(
      `http://presentation.local/api/presentation/v1/opportunities?offset=${models.length}&limit=100`
    ));
    if (!response.ok) throw new Error("Presentation public collection unavailable");
    const page = await response.json() as { opportunities: PresentationReadModel[]; pagination: { total: number } };
    total = page.pagination.total;
    if (!page.opportunities.length && models.length < total) throw new Error("Incomplete Presentation public collection");
    models.push(...page.opportunities);
  } while (models.length < total);
  const jobs = models.map(toPresentationDisplayJob);
  if (new Set(jobs.map((job) => job.positionId)).size !== jobs.length) {
    throw new Error("Ambiguous Presentation current position collection");
  }
  return jobs;
}
