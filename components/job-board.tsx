"use client";

import { createClient } from "@/lib/supabase/client";
import { MATCH_STARS, TARGET_DIRECTIONS, UNIT_TYPES } from "@/lib/constants";
import type { ApplicationProgress, Job } from "@/lib/types";
import {
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  Building2,
  CalendarClock,
  Check,
  ChevronDown,
  CircleAlert,
  Download,
  Filter,
  Gavel,
  Heart,
  LogIn,
  LogOut,
  MapPin,
  Radio,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles
} from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  initialJobs: Job[];
  authenticated: boolean;
  initialProgress: ApplicationProgress[];
};

const emptyProgress: ApplicationProgress = {
  job_id: "",
  status: "未投递",
  favorite: false,
  notes: "",
  applied_at: null,
  updated_at: new Date(0).toISOString()
};

function formatDate(value: string | null) {
  if (!value) return "未注明";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function deadlineTone(deadline: string | null) {
  if (!deadline) return "neutral";
  const days = Math.ceil((new Date(`${deadline}T23:59:59+08:00`).valueOf() - Date.now()) / 86_400_000);
  if (days < 0) return "closed";
  if (days <= 7) return "urgent";
  return "open";
}

export function JobBoard({ initialJobs, authenticated, initialProgress }: Props) {
  const [jobs, setJobs] = useState(initialJobs);
  const [query, setQuery] = useState("");
  const [unitType, setUnitType] = useState("全部单位");
  const [direction, setDirection] = useState("全部方向");
  const [minScore, setMinScore] = useState(1);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [onlyFavorite, setOnlyFavorite] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [progress, setProgress] = useState<Record<string, ApplicationProgress>>(
    Object.fromEntries(initialProgress.map((item) => [item.job_id, item]))
  );

  useEffect(() => {
    const supabase = createClient();
    if (!supabase) return;
    const refresh = async () => {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (response.ok) {
        setJobs((await response.json()).jobs);
        setLastRefreshedAt(new Date());
      }
    };
    const channel = supabase
      .channel("public-job-updates")
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, refresh)
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return jobs
      .filter((job) => !normalized || [job.unit_name, job.title, job.direction, job.location, job.industry].join(" ").toLowerCase().includes(normalized))
      .filter((job) => unitType === "全部单位" || job.unit_type === unitType)
      .filter((job) => direction === "全部方向" || job.direction.includes(direction))
      .filter((job) => job.match_score >= minScore)
      .filter((job) => !onlyOpen || !["已截止", "已关闭"].includes(job.recruitment_status))
      .filter((job) => !onlyFavorite || progress[job.job_id]?.favorite)
      .sort((a, b) => b.match_score - a.match_score || (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999"));
  }, [jobs, query, unitType, direction, minScore, onlyOpen, onlyFavorite, progress]);

  const stats = useMemo(() => ({
    total: jobs.length,
    fiveStar: jobs.filter((job) => job.match_score === 5).length,
    open: jobs.filter((job) => !["已截止", "已关闭"].includes(job.recruitment_status)).length,
    applied: Object.values(progress).filter((item) => item.status === "已投递").length
  }), [jobs, progress]);

  const latestSourceUpdate = useMemo(() => jobs.reduce<string | null>((latest, job) => {
    const candidate = job.source_updated_at ?? job.updated_at;
    return !latest || candidate > latest ? candidate : latest;
  }, null), [jobs]);

  async function saveProgress(jobId: string, patch: Partial<ApplicationProgress>) {
    const next = { ...emptyProgress, ...progress[jobId], job_id: jobId, ...patch, updated_at: new Date().toISOString() };
    setProgress((current) => ({ ...current, [jobId]: next }));
    const response = await fetch("/api/progress", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next)
    });
    if (!response.ok) console.error("Failed to save progress");
  }

  function exportCsv() {
    const headers = ["岗位ID", "单位名称", "岗位名称", "岗位方向", "所在地", "匹配度", "截止时间", "状态", "公告链接"];
    const rows = filtered.map((job) => [job.job_id, job.unit_name, job.title, job.direction, job.location, MATCH_STARS[job.match_score], job.deadline ?? "", job.recruitment_status, job.announcement_url]);
    const csv = [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\ufeff", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `武大法硕2027岗位-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <main>
      <header className="site-header">
        <div className="header-inner">
          <Link href="/" className="brand"><span className="brand-mark"><Gavel size={21} /></span><span>武大法硕求职雷达</span></Link>
          <nav>
            <a href="#jobs">岗位库</a>
            <a href="#rules">筛选规则</a>
            {authenticated ? (
              <form action="/api/auth/logout" method="post"><button className="nav-button"><LogOut size={15} /> 退出进度空间</button></form>
            ) : <span className="nav-button nav-button-disabled"><LogIn size={15} /> 进度功能稍后启用</span>}
          </nav>
        </div>
      </header>

      <section className="hero">
        <div className="hero-grid">
          <div>
            <div className="live-chip"><Radio size={14} /> 每 6 小时巡检官方招聘源</div>
            <p className="eyebrow">WUHAN UNIVERSITY · JURIS MASTER 2027</p>
            <h1>把分散的机会，<br /><em>整理成可行动的选择。</em></h1>
            <p className="hero-copy">面向武汉大学法律硕士（非法学）2027届，聚合全国法务、合规、风控、内控、投资与综合管理岗位。所有投递均跳转招聘单位官方页面。</p>
            <div className="hero-actions">
              <a className="primary-button" href="#jobs">查看最新岗位 <ArrowUpRight size={17} /></a>
              <button className="secondary-button" onClick={exportCsv}><Download size={17} /> 导出当前结果</button>
            </div>
          </div>
          <aside className="profile-card">
            <div className="profile-label">专属匹配档案</div>
            <h2>武汉大学</h2>
            <p>法律硕士（非法学） · 2027届</p>
            <div className="profile-divider" />
            <dl>
              <div><dt>本科背景</dt><dd>非法学专业</dd></div>
              <div><dt>求职范围</dt><dd>全国</dd></div>
              <div><dt>重点体系</dt><dd>中科院 / 央国企 / 烟草 / 金融</dd></div>
              <div><dt>数据规则</dt><dd>仅收录 2027 届</dd></div>
            </dl>
            <div className="profile-footer"><ShieldCheck size={16} /> 建筑施工及房地产开发类已完全排除</div>
          </aside>
        </div>
      </section>

      <section className="stats-strip">
        <div><span>{stats.total}</span><small>已收录岗位</small></div>
        <div><span>{stats.fiveStar}</span><small>五星高匹配</small></div>
        <div><span>{stats.open}</span><small>当前可投递</small></div>
        <div><span>{authenticated ? stats.applied : "—"}</span><small>{authenticated ? "已投递" : "登录后查看进度"}</small></div>
      </section>

      <section className="board-section" id="jobs">
        <div className="section-heading">
          <div><p className="eyebrow">LIVE JOB DATABASE</p><h2>全国岗位信息库</h2></div>
          <div className="sync-note"><RefreshCw size={15} /> {lastRefreshedAt ? `刚刚收到实时更新` : `最近数据更新：${formatDate(latestSourceUpdate)}`}</div>
        </div>

        <div className="filter-panel">
          <div className="search-box"><Search size={18} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索单位、岗位、城市或行业" /></div>
          <label><span>单位类型</span><div className="select-wrap"><select value={unitType} onChange={(event) => setUnitType(event.target.value)}><option>全部单位</option>{UNIT_TYPES.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></label>
          <label><span>岗位方向</span><div className="select-wrap"><select value={direction} onChange={(event) => setDirection(event.target.value)}><option>全部方向</option>{TARGET_DIRECTIONS.map((item) => <option key={item}>{item}</option>)}</select><ChevronDown size={15} /></div></label>
          <label><span>最低匹配</span><div className="select-wrap"><select value={minScore} onChange={(event) => setMinScore(Number(event.target.value))}>{[5,4,3,2,1].map((score) => <option key={score} value={score}>{MATCH_STARS[score]}</option>)}</select><ChevronDown size={15} /></div></label>
          <div className="toggle-row">
            <button className={onlyOpen ? "toggle active" : "toggle"} onClick={() => setOnlyOpen((value) => !value)}><Check size={14} /> 仅看可投递</button>
            {authenticated && <button className={onlyFavorite ? "toggle active" : "toggle"} onClick={() => setOnlyFavorite((value) => !value)}><Heart size={14} /> 我的收藏</button>}
          </div>
        </div>

        <div className="results-bar"><span><Filter size={15} /> 找到 <strong>{filtered.length}</strong> 个符合条件的岗位</span><span>排序：匹配度优先 · 截止时间次优先</span></div>

        {filtered.length === 0 ? (
          <div className="empty-state"><Sparkles size={28} /><h3>尚未发现符合当前条件的岗位</h3><p>系统每 6 小时巡检一次。你也可以降低匹配度或清空筛选条件。</p></div>
        ) : (
          <div className="job-list">
            {filtered.map((job) => {
              const itemProgress = progress[job.job_id] ?? { ...emptyProgress, job_id: job.job_id };
              return (
                <article className="job-card" key={job.job_id}>
                  <div className="job-card-main" onClick={() => setSelectedJob(job)}>
                    <div className="job-topline">
                      <div className="unit-badge"><Building2 size={15} /> {job.unit_type}</div>
                      <div className="match-stars" aria-label={`${job.match_score}星匹配`}>{MATCH_STARS[job.match_score]}</div>
                    </div>
                    <h3>{job.title}</h3>
                    <p className="unit-name">{job.unit_name}</p>
                    <div className="job-meta">
                      <span><MapPin size={14} /> {job.location || "全国/未注明"}</span>
                      <span><BriefcaseBusiness size={14} /> {job.direction}</span>
                      <span><CalendarClock size={14} /> 截止 {formatDate(job.deadline)}</span>
                    </div>
                    <div className="tag-row">
                      <span>{job.system_name}</span><span>{job.education || "学历未注明"}</span>
                      <span className={job.non_law_rule === "专业限制待核验" ? "warning-tag" : "success-tag"}>{job.non_law_rule}</span>
                      {job.source_status === "来源待核验" && <span className="warning-tag"><CircleAlert size={12} /> 来源待核验</span>}
                    </div>
                  </div>
                  <div className="job-card-side">
                    <span className={`deadline ${deadlineTone(job.deadline)}`}>{job.recruitment_status}</span>
                    <a className="apply-button" href={job.application_url ?? job.announcement_url} target="_blank" rel="noreferrer">前往官方投递 <ArrowUpRight size={16} /></a>
                    <a className="detail-link" href={job.announcement_url} target="_blank" rel="noreferrer">查看招聘公告</a>
                    {authenticated && (
                      <div className="progress-controls">
                        <button className={itemProgress.favorite ? "icon-button active" : "icon-button"} onClick={() => saveProgress(job.job_id, { favorite: !itemProgress.favorite })} title="收藏"><Bookmark size={17} /></button>
                        <select value={itemProgress.status} onChange={(event) => saveProgress(job.job_id, { status: event.target.value as ApplicationProgress["status"], applied_at: event.target.value === "已投递" ? new Date().toISOString() : itemProgress.applied_at })}>
                          <option>未投递</option><option>准备中</option><option>已投递</option><option>已结束</option>
                        </select>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="rules-section" id="rules">
        <div><p className="eyebrow">MATCHING PRINCIPLES</p><h2>不是“有法学”就推荐</h2><p>系统单独识别法硕（非法学）报考限制，优先展示明确接受或可能接受的岗位。</p></div>
        <div className="rule-grid">
          <article><span>01</span><h3>专业限制核验</h3><p>区分明确接受、可能接受、本科法学、本硕均法学及限制待核验。</p></article>
          <article><span>02</span><h3>单位方向控制</h3><p>重点追踪中科院体系、央企总部及核心二级单位、烟草、金融与科研院所。</p></article>
          <article><span>03</span><h3>来源可信标识</h3><p>聚合网站用于发现，官方招聘公告和官方投递页面作为最终依据。</p></article>
        </div>
      </section>

      <footer><div><strong>武大法硕求职雷达 · 2027</strong><p>岗位信息以招聘单位官方公告为准，本网站不接收或保存简历。</p></div><span>每 6 小时自动巡检</span></footer>

      {selectedJob && (
        <div className="modal-backdrop" onClick={() => setSelectedJob(null)}>
          <section className="detail-modal" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setSelectedJob(null)}>×</button>
            <p className="eyebrow">{selectedJob.job_id}</p><h2>{selectedJob.title}</h2><h3>{selectedJob.unit_name}</h3>
            <dl className="detail-grid">
              <div><dt>岗位方向</dt><dd>{selectedJob.direction}</dd></div><div><dt>单位所在地</dt><dd>{selectedJob.location}</dd></div>
              <div><dt>学历要求</dt><dd>{selectedJob.education || "未注明"}</dd></div><div><dt>法硕非法学限制</dt><dd>{selectedJob.non_law_rule}</dd></div>
              <div><dt>招聘批次</dt><dd>{selectedJob.batch || "未注明"}</dd></div><div><dt>薪资待遇</dt><dd>{selectedJob.salary || "未公开"}</dd></div>
              <div><dt>开始时间</dt><dd>{formatDate(selectedJob.start_date)}</dd></div><div><dt>截止时间</dt><dd>{formatDate(selectedJob.deadline)}</dd></div>
            </dl>
            {authenticated && <label className="notes-field"><span>私人备注</span><textarea defaultValue={progress[selectedJob.job_id]?.notes ?? ""} placeholder="记录网申材料、笔试安排、联系人等" onBlur={(event) => saveProgress(selectedJob.job_id, { notes: event.target.value })} /></label>}
            <a className="primary-button full-width" href={selectedJob.application_url ?? selectedJob.announcement_url} target="_blank" rel="noreferrer">前往官方页面 <ArrowUpRight size={17} /></a>
          </section>
        </div>
      )}
    </main>
  );
}
