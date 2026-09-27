import { GitAppendOnlyExecutionStore } from "../production-persistence/git-append-only-execution-store";
import { ReadOnlyPresentationApi } from "./api";

export function composeGitReadOnlyPresentationApi(repositoryPath: string, streamId: string) {
  const store = new GitAppendOnlyExecutionStore({
    repository_path: repositoryPath, stream_id: streamId, scope: "PRODUCTION"
  });
  const snapshot = store.readCurrentSnapshot();
  if (!snapshot) throw new Error("Committed Presentation current snapshot unavailable");
  return new ReadOnlyPresentationApi({
    readCurrentSnapshot: () => structuredClone(snapshot),
    listCurrentReadModels: () => structuredClone(snapshot.current_position_read_models)
  });
}
