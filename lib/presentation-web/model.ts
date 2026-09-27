import type { PresentationField, PresentationReadModel } from "../ingestion/domain/presentation";

export type BoardStatus = "DISPLAY" | "DISPLAY_WITH_REVIEW" | "EVIDENCE_BLOCKED";
export const BOARD_STATUS_LABELS: Record<BoardStatus, string> = {
  DISPLAY: "正式展示", DISPLAY_WITH_REVIEW: "待复核", EVIDENCE_BLOCKED: "证据待完善"
};

export interface PresentationDisplayJob {
  readonly positionId: string;
  readonly decisionId: string;
  readonly readModelId: string;
  readonly revision: number | null;
  readonly status: BoardStatus;
  readonly reasonCodes: readonly string[];
  readonly reasonVisibility?: "COMPLETE" | "REDACTED";
  readonly employer: string;
  readonly title: string;
  readonly location: string;
  readonly year: string;
  readonly batch: string;
  readonly requirement: string;
  readonly announcementLink: string | null;
  readonly applicationLink: string | null;
  readonly updatedAt: string;
}

export interface PositionApplicationStatePort {
  read(positionId: string): Promise<"未投递" | "准备中" | "已投递" | "已结束" | null>;
}

function field<Value>(value: PresentationField<Value>): Value | null {
  return value.state === "AVAILABLE" ? value.value : null;
}

function link(value: PresentationField<string>): string | null {
  const raw = field(value);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return ["https:", "http:", "mailto:"].includes(url.protocol) ? raw : null;
  } catch { return null; }
}

export type PresentationDisplayInput = Pick<PresentationReadModel,
  "decision_revision" | "presentation_status" | "reason_codes" | "employer" | "position_title" | "locations"
  | "recruitment_year" | "recruitment_batch" | "announcement_link" | "application_link"> & {
    readonly position_id: string | null;
    readonly presentation_decision_id: string;
    readonly presentation_read_model_id: string;
    readonly updated_at: string;
    readonly requirement_summary: PresentationField<readonly {
      readonly dimension: string; readonly subject_scope: string; readonly polarity: string; readonly certainty: string;
    }[]>;
  };

export function toPresentationDisplayInputJob(model: PresentationDisplayInput): PresentationDisplayJob {
  if (!model.position_id || model.presentation_status === "NOT_DISPLAY") {
    throw new Error("Read-only public position collection required");
  }
  const summary = model.requirement_summary.state === "AVAILABLE" ? model.requirement_summary.value : null;
  return {
    positionId: model.position_id,
    decisionId: model.presentation_decision_id, readModelId: model.presentation_read_model_id,
    revision: model.decision_revision, status: model.presentation_status,
    reasonCodes: [...model.reason_codes], employer: field(model.employer) ?? "尚未取得",
    title: field(model.position_title) ?? "尚未取得",
    location: field(model.locations)?.join("、") || "尚未取得",
    year: String(field(model.recruitment_year) ?? "尚未取得"),
    batch: field(model.recruitment_batch) ?? "尚未取得",
    requirement: summary ? summary.map((item) => JSON.stringify(item)).join("；") || "未列明" : "尚未取得",
    announcementLink: link(model.announcement_link), applicationLink: link(model.application_link),
    updatedAt: model.updated_at
  };
}

export function toPresentationDisplayJob(model: PresentationReadModel): PresentationDisplayJob {
  return toPresentationDisplayInputJob(model);
}

function compare(left: string, right: string) { return left < right ? -1 : left > right ? 1 : 0; }

export function selectBoardJobs(jobs: readonly PresentationDisplayJob[], query: string,
  status: BoardStatus | "ALL", sort: "updated" | "title", employer = "ALL") {
  const normalized = query.trim().toLowerCase();
  return jobs.filter((job) => (!normalized || [job.employer, job.title, job.location, job.year, job.batch]
    .join(" ").toLowerCase().includes(normalized)) && (status === "ALL" || job.status === status)
    && (employer === "ALL" || job.employer === employer))
    .sort((left, right) => (sort === "title" ? compare(left.title, right.title)
      : compare(right.updatedAt, left.updatedAt)) || compare(left.positionId, right.positionId));
}

export function exportBoardCsv(jobs: readonly PresentationDisplayJob[]) {
  const rows = [["岗位ID", "单位", "岗位", "地点", "届别", "批次", "展示状态", "要求摘要", "公告链接", "投递链接", "决策ID", "原因"],
    ...jobs.map((job) => [job.positionId, job.employer, job.title, job.location, job.year, job.batch,
      BOARD_STATUS_LABELS[job.status], job.requirement, job.announcementLink ?? "", job.applicationLink ?? "",
      job.decisionId, job.reasonCodes.join(";")])];
  return rows.map((row) => row.map((cell) => {
    const safe = /^[=+@\-\t\r]/u.test(cell) ? `'${cell}` : cell;
    return `"${safe.replaceAll('"', '""')}"`;
  }).join(",")).join("\n");
}
