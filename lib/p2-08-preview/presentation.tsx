import type {
  OpportunityDetailProjection,
  OpportunityProjection,
  ReadOnlyPagination,
  SourceProjection
} from "../read-only-api";
import type { PreviewOpportunityQuery } from "./read-only-data";
import React from "react";

export interface OpportunityListViewProps {
  readonly opportunities: readonly OpportunityProjection[];
  readonly pagination: ReadOnlyPagination;
  readonly sources: readonly SourceProjection[];
  readonly query: PreviewOpportunityQuery;
}

export interface OpportunityDetailViewProps {
  readonly detail: OpportunityDetailProjection;
}

export function OpportunityListView({
  opportunities,
  pagination,
  sources,
  query
}: OpportunityListViewProps) {
  const previousOffset = Math.max(0, pagination.offset - pagination.limit);
  const nextOffset = pagination.offset + pagination.limit;
  return (
    <main className="p208-shell">
      <section className="p208-hero">
        <p className="p208-kicker">P2-08 · Read-only Preview</p>
        <h1>官方招聘采集结果预览</h1>
        <p>只读数据预览 · 数据来自已冻结的 P2-07 projection，不代表实时生产系统。</p>
      </section>

      <section className="p208-panel" aria-labelledby="preview-search-heading">
        <div className="p208-section-heading">
          <div>
            <p className="p208-kicker">Query Projection</p>
            <h2 id="preview-search-heading">招聘机会</h2>
          </div>
          <span>{pagination.total} 条已持久化机会</span>
        </div>

        <form className="p208-filters" action="/preview" method="get">
          <label>
            <span>关键词</span>
            <input name="keyword" defaultValue={query.keyword} placeholder="标题、单位或来源" />
          </label>
          <label>
            <span>单位</span>
            <input name="organization" defaultValue={query.organization} placeholder="精确单位名称" />
          </label>
          <label>
            <span>来源</span>
            <select name="source" defaultValue={query.source ?? ""}>
              <option value="">全部官方来源</option>
              {sources.map((source) => (
                <option key={source.source_definition_id} value={source.source_definition_id}>
                  {source.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>观察状态</span>
            <select name="observation_state" defaultValue={query.observation_state ?? ""}>
              <option value="">全部状态</option>
              <option value="OBSERVED">已观察</option>
              <option value="PARTIAL">部分采集</option>
              <option value="SUSPICIOUS_EMPTY">可疑空结果</option>
              <option value="UNAVAILABLE">不可用</option>
            </select>
          </label>
          <button type="submit">查询</button>
        </form>

        {opportunities.length === 0 ? (
          <div className="p208-empty">
            <h3>没有匹配的已持久化机会</h3>
            <p>调整查询条件后重试。页面不会触发新的采集。</p>
          </div>
        ) : (
          <div className="p208-list">
            {opportunities.map((opportunity) => (
              <OpportunityCard key={opportunity.opportunity_id} opportunity={opportunity} />
            ))}
          </div>
        )}

        <nav className="p208-pagination" aria-label="分页">
          {pagination.offset > 0 ? (
            <a href={queryHref(query, previousOffset, pagination.limit)}>上一页</a>
          ) : <span aria-disabled="true">上一页</span>}
          <strong>第 {Math.floor(pagination.offset / pagination.limit) + 1} 页</strong>
          {nextOffset < pagination.total ? (
            <a href={queryHref(query, nextOffset, pagination.limit)}>下一页</a>
          ) : <span aria-disabled="true">下一页</span>}
        </nav>
      </section>
    </main>
  );
}

export function OpportunityDetailView({ detail }: OpportunityDetailViewProps) {
  const { opportunity, requirements, eligibility } = detail;
  return (
    <main className="p208-shell">
      <a className="p208-back" href="/preview">← 返回招聘机会</a>
      <article className="p208-panel p208-detail">
        <header>
          <p className="p208-kicker">Official Opportunity</p>
          <h1>{opportunity.title}</h1>
          <p className="p208-lead">
            {opportunity.organization?.name ?? "招聘单位未提取"} · {opportunity.source.name}
          </p>
          <div className="p208-status-row">
            <span>当前观察状态：{observationLabel(opportunity.observation_state)}</span>
            <span>发布日期：未观察到</span>
            <span>采集观察时间：{formatDateTime(opportunity.observed_at)}</span>
          </div>
          <a
            className="p208-official-link"
            href={opportunity.original_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            打开官方原公告 ↗
          </a>
        </header>

        <section className="p208-detail-section">
          <h2>岗位要求</h2>
          {requirements.length === 0 ? (
            <div className="p208-unknown">
              <strong>未观察到完整要求</strong>
              <p>当前持久化数据没有足够、可追溯的 Requirement Evidence；页面不会据此推断岗位条件。</p>
            </div>
          ) : (
            <div className="p208-requirements">
              {requirements.map((requirement) => (
                <article key={requirement.requirement_fact_id}>
                  <h3>{requirement.dimension} · {requirement.subject_scope}</h3>
                  <dl>
                    <div><dt>关系</dt><dd>{requirement.operator}</dd></div>
                    <div><dt>值</dt><dd><code>{JSON.stringify(requirement.value)}</code></dd></div>
                    <div><dt>确定性</dt><dd>{requirement.certainty}</dd></div>
                  </dl>
                  {requirement.evidence.map((evidence) => (
                    <blockquote key={evidence.requirement_evidence_id}>
                      <p>{evidence.evidence_text}</p>
                      <footer>
                        Evidence {evidence.requirement_evidence_id} · Snapshot {evidence.snapshot_id} · Raw {evidence.raw_blob_id}
                      </footer>
                    </blockquote>
                  ))}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="p208-detail-section">
          <h2>资格评估</h2>
          {eligibility.status === "NOT_ASSESSED" ? (
            <div className="p208-unknown">
              <strong>未评估</strong>
              <p>{eligibility.reason}</p>
            </div>
          ) : (
            <div className="p208-assessments">
              {eligibility.assessments.map((assessment) => (
                <article key={assessment.eligibility_assessment_id}>
                  <strong>{assessment.result}</strong>
                  <p>持久化评估：{assessment.eligibility_assessment_id}</p>
                  <p>依据：{assessment.reason_codes.join("、")}</p>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="p208-detail-section">
          <h2>来源与 Provenance</h2>
          <dl className="p208-provenance-summary">
            <div><dt>Opportunity</dt><dd>{opportunity.opportunity_id}</dd></div>
            <div><dt>RecruitmentEndpoint</dt><dd>{opportunity.endpoint.recruitment_endpoint_id}</dd></div>
            <div><dt>SourceDefinition</dt><dd>{opportunity.source.source_definition_id}</dd></div>
            <div><dt>官方招聘端点</dt><dd>{opportunity.endpoint.locator}</dd></div>
          </dl>
          {opportunity.provenance.map((source, index) => (
            <dl className="p208-provenance" key={source.source_occurrence_version_id}>
              <div><dt>来源序号</dt><dd>{index + 1}</dd></div>
              <div><dt>SourceOccurrence</dt><dd>{source.source_occurrence_id}</dd></div>
              <div><dt>SourceOccurrenceVersion</dt><dd>{source.source_occurrence_version_id}</dd></div>
              <div><dt>ExtractedRecord</dt><dd>{source.extracted_record_id}</dd></div>
              <div><dt>Snapshot</dt><dd>{source.snapshot_id}</dd></div>
              <div><dt>Raw</dt><dd>{source.raw_blob_id}</dd></div>
              <div><dt>Collection Run</dt><dd>{source.collection_run_id}</dd></div>
              <div><dt>RecruitmentEndpoint</dt><dd>{source.recruitment_endpoint_id}</dd></div>
              <div><dt>SourceDefinition</dt><dd>{source.source_definition_id}</dd></div>
              <div><dt>official original_url</dt><dd>{source.original_url}</dd></div>
            </dl>
          ))}
        </section>
      </article>
    </main>
  );
}

function OpportunityCard({ opportunity }: { readonly opportunity: OpportunityProjection }) {
  return (
    <article className="p208-card">
      <div>
        <p className="p208-source">{opportunity.source.name}</p>
        <h3><a href={`/preview/opportunities/${encodeURIComponent(opportunity.opportunity_id)}`}>{opportunity.title}</a></h3>
        <p>{opportunity.organization?.name ?? "招聘单位未提取"}</p>
        <dl className="p208-card-meta">
          <div><dt>发布日期</dt><dd>未观察到</dd></div>
          <div><dt>当前观察状态</dt><dd>{observationLabel(opportunity.observation_state)}</dd></div>
          <div><dt>观察时间</dt><dd>{formatDateTime(opportunity.observed_at)}</dd></div>
        </dl>
      </div>
      <div className="p208-card-actions">
        <a href={`/preview/opportunities/${encodeURIComponent(opportunity.opportunity_id)}`}>查看详情</a>
        <a href={opportunity.original_url} target="_blank" rel="noopener noreferrer">官方原公告 ↗</a>
      </div>
    </article>
  );
}

function queryHref(query: PreviewOpportunityQuery, offset: number, limit: number) {
  const parameters = new URLSearchParams();
  if (query.keyword) parameters.set("keyword", query.keyword);
  if (query.organization) parameters.set("organization", query.organization);
  if (query.source) parameters.set("source", query.source);
  if (query.observation_state) parameters.set("observation_state", query.observation_state);
  parameters.set("offset", String(offset));
  parameters.set("limit", String(limit));
  return `/preview?${parameters.toString()}`;
}

function observationLabel(state: OpportunityProjection["observation_state"]) {
  switch (state) {
    case "OBSERVED": return "已观察";
    case "PARTIAL": return "部分采集";
    case "SUSPICIOUS_EMPTY": return "可疑空结果";
    case "UNAVAILABLE": return "不可用";
  }
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(date);
}
