"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Building2, CalendarClock, ChevronDown, Download, Filter, Gavel, MapPin, RefreshCw, Search, ShieldCheck, Sparkles } from "lucide-react";
import { BOARD_STATUS_LABELS, exportBoardCsv, selectBoardJobs, type BoardStatus, type PresentationDisplayJob } from "@/lib/presentation-web/model";

function OfficialLinks({ job }: { job: PresentationDisplayJob }) {
  return <>
    {job.applicationLink ? <a className="apply-button" href={job.applicationLink} target="_blank" rel="noreferrer">前往官方投递 <ArrowUpRight size={16} /></a>
      : <span className="warning-tag">投递链接尚未取得</span>}
    {job.announcementLink ? <a className="detail-link" href={job.announcementLink} target="_blank" rel="noreferrer">查看招聘公告</a>
      : <span>公告链接尚未取得</span>}
  </>;
}

export function JobDetails({ job }: { job: PresentationDisplayJob }) {
  return <>
    <p className="eyebrow">{job.positionId}</p><h2>{job.title}</h2><h3>{job.employer}</h3>
    <dl className="detail-grid">
      <div><dt>地点</dt><dd>{job.location}</dd></div><div><dt>招聘届别</dt><dd>{job.year}</dd></div>
      <div><dt>招聘批次</dt><dd>{job.batch}</dd></div><div><dt>展示状态</dt><dd>{BOARD_STATUS_LABELS[job.status]}</dd></div>
      <div><dt>要求摘要</dt><dd>{job.requirement}</dd></div><div><dt>更新时间</dt><dd>{job.updatedAt}</dd></div>
    </dl>
    <details><summary>查看决策追溯信息</summary><p>决策：{job.decisionId}</p><p>版本：{job.revision ?? "尚未取得"}</p>
      <p>ReadModel：{job.readModelId}</p><p>原因：{job.reasonCodes.join("、") || "未列明"}</p>
      {job.reasonVisibility === "REDACTED" && <p>部分追溯原因未公开</p>}</details>
    <OfficialLinks job={job} />
  </>;
}

export function JobBoard({ initialJobs }: { initialJobs: readonly PresentationDisplayJob[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<BoardStatus | "ALL">("ALL");
  const [employer, setEmployer] = useState("ALL");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const jobs = initialJobs;
  const filtered = useMemo(() => selectBoardJobs(jobs, query, status, sort, employer), [jobs, query, status, sort, employer]);
  const selectedJob = jobs.find((job) => job.positionId === selectedId);
  const employers = [...new Set(jobs.map((job) => job.employer))].sort();
  const latest = jobs.reduce((value, job) => job.updatedAt > value ? job.updatedAt : value, "");

  function exportCsv() {
    const blob = new Blob(["\ufeff", exportBoardCsv(filtered)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `岗位-${new Date().toISOString().slice(0, 10)}.csv`;
    anchor.click(); URL.revokeObjectURL(url);
  }

  return <main className="presentation-board">
    <header className="site-header"><div className="header-inner">
      <Link href="/" className="brand"><span className="brand-mark"><Gavel size={21} /></span><span>武大法硕求职雷达</span></Link>
      <nav><a href="#jobs">岗位库</a><a href="#rules">信息说明</a></nav>
    </div></header>
    <section className="hero"><div className="hero-grid"><div>
      <div className="live-chip"><ShieldCheck size={14} /> 已提交官方证据 · 只读展示准备模式</div>
      <p className="eyebrow">LEGAL EMPLOYMENT OPPORTUNITIES</p>
      <h1>把分散的机会，<br /><em>整理成可行动的选择。</em></h1>
      <p className="hero-copy">保留官方招聘机会与证据状态。信息待核验不代表资格不符，招聘要求以官方公告为准。</p>
      <div className="hero-actions"><a className="primary-button" href="#jobs">查看岗位 <ArrowUpRight size={17} /></a>
        <button className="secondary-button" onClick={exportCsv}><Download size={17} /> 导出当前结果</button></div>
    </div><aside className="profile-card"><div className="profile-label">展示信息说明</div><h2>官方机会，保留证据</h2>
      <p>岗位发现、相关性、个人资格与展示状态分别处理</p><div className="profile-divider" />
      <dl><div><dt>正式展示</dt><dd>沿用已封存决策</dd></div><div><dt>待复核</dt><dd>保留机会</dd></div>
        <div><dt>证据待完善</dt><dd>尚不能确定资格结论</dd></div><div><dt>未取得字段</dt><dd>不推测、不补造</dd></div></dl>
      <div className="profile-footer"><ShieldCheck size={16} /> 本页面不重新判断候选人资格</div>
    </aside></div></section>
    <section className="stats-strip"><div><span>{jobs.length}</span><small>已收录岗位</small></div>
      <div><span>{jobs.filter((job) => job.status === "DISPLAY").length}</span><small>正式展示</small></div>
      <div><span>{jobs.filter((job) => job.status !== "DISPLAY").length}</span><small>待复核／证据待完善</small></div>
      <div><span>{employers.length}</span><small>收录单位</small></div></section>
    <section className="board-section" id="jobs"><div className="section-heading"><div><p className="eyebrow">OFFICIAL OPPORTUNITIES</p><h2>全国岗位信息库</h2></div>
      <button className="secondary-button" onClick={() => window.location.reload()}><RefreshCw size={15} /> 刷新已提交数据</button></div>
      <p className="sync-note">最近数据更新：{latest || "尚未取得"}</p>
      <div className="filter-panel"><div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单位、岗位、城市或届别" /></div>
        <label><span>单位</span><div className="select-wrap"><select value={employer} onChange={(event) => setEmployer(event.target.value)}><option value="ALL">全部单位</option>{employers.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></label>
        <label><span>展示状态</span><div className="select-wrap"><select value={status} onChange={(event) => setStatus(event.target.value as BoardStatus | "ALL")}><option value="ALL">全部状态</option>{Object.entries(BOARD_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={15} /></div></label>
        <label><span>排序</span><div className="select-wrap"><select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "title")}><option value="updated">更新时间</option><option value="title">岗位名称</option></select><ChevronDown size={15} /></div></label>
      </div>
      <div className="results-bar"><span><Filter size={15} /> 找到 <strong>{filtered.length}</strong> 个岗位</span><span>不按个人匹配度排序</span></div>
      {filtered.length === 0 ? <div className="empty-state"><Sparkles size={28} /><h3>当前筛选下暂无岗位</h3><p>请调整搜索或展示状态。</p></div>
        : <div className="job-list">{filtered.map((job) => <article className="job-card" key={job.positionId}>
          <div className="job-card-main"><div className="job-topline"><div className="unit-badge"><Building2 size={15} /> {job.employer}</div>
            <span className={job.status === "DISPLAY" ? "success-tag" : "warning-tag"}>{BOARD_STATUS_LABELS[job.status]}</span></div>
            <h3><button className="job-title-button" onClick={() => setSelectedId(job.positionId)}>{job.title}</button></h3><p className="unit-name">{job.employer}</p>
            <div className="job-meta"><span><MapPin size={14} /> {job.location}</span><span><CalendarClock size={14} /> 届别：{job.year}</span></div>
            <div className="tag-row"><span>批次：{job.batch}</span><span>要求摘要：{job.requirement}</span></div>
          </div><div className="job-card-side"><OfficialLinks job={job} /></div>
        </article>)}</div>}
    </section>
    <section className="rules-section" id="rules"><div><p className="eyebrow">EVIDENCE PRINCIPLES</p><h2>保留机会，如实呈现</h2><p>展示状态来自权威决策，页面不补造招聘条件或个人资格结论。</p></div>
      <div className="rule-grid"><article><span>01</span><h3>证据待完善</h3><p>缺证据或待复核不等于资格不符。</p></article>
        <article><span>02</span><h3>链接分开</h3><p>公告链接不是投递链接，未取得时明确标注。</p></article>
        <article><span>03</span><h3>版本可追溯</h3><p>详情保留决策版本和原因信息，不重新判断。</p></article></div>
    </section>
    <footer><div><strong>武大法硕求职雷达 · 2027</strong><p>岗位信息以官方公告为准，本网站不接收或保存简历。</p></div><span>准备模式 · 未执行最终切换</span></footer>
    {selectedJob && <div className="modal-backdrop" onClick={() => setSelectedId(null)}><section className="detail-modal" role="dialog" aria-modal="true" aria-label="岗位详情" onClick={(event) => event.stopPropagation()}>
      <button className="modal-close" onClick={() => setSelectedId(null)} aria-label="关闭详情">×</button><JobDetails job={selectedJob} />
    </section></div>}
  </main>;
}
