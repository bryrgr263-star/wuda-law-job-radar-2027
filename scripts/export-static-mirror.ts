import { mkdir, writeFile } from "node:fs/promises";
import { demoJobs } from "../lib/demo-data";
import { createAdminClient } from "../lib/supabase/admin";
import type { Job } from "../lib/types";

const OUTPUT_DIRECTORY = "public-site";

async function loadJobs() {
  const admin = createAdminClient();
  if (admin) {
    const { data, error } = await admin
      .from("jobs")
      .select("*")
      .eq("recruitment_year", 2027)
      .eq("is_published", true)
      .order("match_score", { ascending: false })
      .order("deadline", { ascending: true, nullsFirst: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as Job[];
  }

  if (process.env.MIRROR_ALLOW_DEMO === "1") return demoJobs;

  const response = await fetch("https://wuda-law-job-radar-2027.vercel.app/api/jobs");
  if (!response.ok) throw new Error(`Mirror source returned HTTP ${response.status}`);
  return ((await response.json()) as { jobs: Job[] }).jobs;
}

function createHtml(jobs: Job[]) {
  const serializedJobs = JSON.stringify(jobs).replaceAll("<", "\\u003c");
  const updatedAt = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date());

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="description" content="武汉大学法律硕士（非法学）2027届全国公开招聘岗位数据库">
  <title>武大法硕求职雷达 · 2027 国内访问镜像</title>
  <style>
    :root{--navy:#0b1f3a;--ink:#14213d;--paper:#f7f5ef;--gold:#bd8c3a;--green:#22644d;--red:#a64036;--muted:#6c7480;--line:#ddd8ce;--white:#fff}
    *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;color:var(--ink);background:var(--paper);font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}a{color:inherit;text-decoration:none}button,input,select{font:inherit}
    header{position:sticky;top:0;z-index:10;color:#fff;background:rgba(11,31,58,.97);border-bottom:1px solid rgba(255,255,255,.12)}.header-inner{width:min(1180px,calc(100% - 32px));height:66px;margin:auto;display:flex;align-items:center;justify-content:space-between}.brand{font-weight:750;letter-spacing:.04em}.mirror{font-size:12px;color:#e8d7b4}
    .hero{padding:68px 0;color:#fff;background:linear-gradient(135deg,#0b1f3a,#17385d)}.wrap{width:min(1180px,calc(100% - 32px));margin:auto}.eyebrow{margin:0 0 12px;color:#e8d7b4;font-size:12px;letter-spacing:.13em}.hero h1{max-width:800px;margin:0;font-family:Georgia,"Songti SC",serif;font-size:clamp(38px,6vw,66px);line-height:1.15}.hero p:last-child{max-width:760px;margin:22px 0 0;color:rgba(255,255,255,.72);line-height:1.8}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);margin:-26px auto 0;padding:20px 8px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 18px 50px rgba(19,36,58,.1)}.stats div{text-align:center;border-right:1px solid var(--line)}.stats div:last-child{border:0}.stats strong{display:block;color:var(--navy);font-family:Georgia,serif;font-size:29px}.stats span{font-size:12px;color:var(--muted)}
    main{padding:58px 0 80px}.section-head{display:flex;align-items:end;justify-content:space-between;gap:20px}.section-head h2{margin:0;font-family:Georgia,"Songti SC",serif;font-size:34px}.updated{font-size:12px;color:var(--green)}
    .filters{display:grid;grid-template-columns:1.5fr repeat(3,minmax(150px,.6fr));gap:12px;margin:24px 0 12px;padding:18px;border:1px solid var(--line);border-radius:14px;background:#fff}.filters input,.filters select{width:100%;height:44px;padding:0 12px;border:1px solid var(--line);border-radius:8px;background:#fff}.toggle{grid-column:1/-1;display:flex;align-items:center;gap:8px;font-size:13px;color:var(--muted)}.results{margin:14px 2px;color:var(--muted);font-size:13px}
    .jobs{display:grid;gap:12px}.job{display:grid;grid-template-columns:minmax(0,1fr) 190px;border:1px solid var(--line);border-radius:12px;background:#fff;overflow:hidden}.job-main{padding:22px 24px}.topline{display:flex;justify-content:space-between;gap:12px}.type{color:#17385d;font-size:12px;font-weight:750}.stars{color:var(--gold);letter-spacing:1px}.job h3{margin:12px 0 5px;color:var(--navy);font-family:Georgia,"Songti SC",serif;font-size:21px}.unit{margin:0;color:#17385d;font-size:14px;font-weight:650}.meta,.tags{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:14px;color:var(--muted);font-size:12px}.tags span{padding:5px 8px;border-radius:5px;background:#f1f2f3}.tags .warn{color:#8a6220;background:#fff4dc}.tags .good{color:var(--green);background:#edf7f1}.side{display:flex;flex-direction:column;justify-content:center;gap:9px;padding:18px;border-left:1px solid var(--line);background:#fcfbf8}.status{align-self:flex-end;font-size:11px;color:var(--green)}.status.closed{color:var(--red)}.apply{display:flex;align-items:center;justify-content:center;min-height:41px;padding:0 12px;border-radius:7px;color:#fff;background:var(--navy);font-size:13px;font-weight:700}.notice{text-align:center;color:var(--muted);font-size:12px;text-decoration:underline}.empty{padding:60px 20px;text-align:center;color:var(--muted);border:1px dashed var(--line);border-radius:12px;background:#fff}
    footer{padding:28px 16px;text-align:center;color:rgba(255,255,255,.7);background:var(--navy);font-size:12px}
    @media(max-width:760px){.stats{grid-template-columns:1fr 1fr}.stats div{padding:8px}.stats div:nth-child(2){border-right:0}.filters{grid-template-columns:1fr}.toggle{grid-column:auto}.section-head{align-items:flex-start;flex-direction:column}.job{grid-template-columns:1fr}.side{border-left:0;border-top:1px solid var(--line)}.status{align-self:flex-start}}
  </style>
</head>
<body>
  <header><div class="header-inner"><div class="brand">武大法硕求职雷达</div><div class="mirror">免费公开镜像 · 无需登录</div></div></header>
  <section class="hero"><div class="wrap"><p class="eyebrow">WUHAN UNIVERSITY · JURIS MASTER 2027</p><h1>全国招聘岗位信息库</h1><p>面向武汉大学法律硕士（非法学）2027届，聚合法务、合规、风控、内控、投资与综合管理岗位。建筑施工和房地产开发建设类完全排除，所有投递均跳转招聘单位官方页面。</p></div></section>
  <section class="stats wrap"><div><strong id="total">0</strong><span>已收录岗位</span></div><div><strong id="fiveStar">0</strong><span>五星高匹配</span></div><div><strong id="open">0</strong><span>当前可投递</span></div><div><strong id="units">0</strong><span>收录单位</span></div></section>
  <main class="wrap"><div class="section-head"><div><p class="eyebrow">PUBLIC JOB DATABASE</p><h2>2027届岗位库</h2></div><div class="updated">镜像生成时间：${updatedAt}</div></div>
    <section class="filters"><input id="query" placeholder="搜索单位、岗位、城市或行业"><select id="unitType"><option value="">全部单位类型</option></select><select id="direction"><option value="">全部岗位方向</option></select><select id="score"><option value="1">最低匹配：★</option><option value="3" selected>最低匹配：★★★</option><option value="4">最低匹配：★★★★</option><option value="5">最低匹配：★★★★★</option></select><label class="toggle"><input id="onlyOpen" type="checkbox" checked> 仅看可投递岗位</label></section>
    <div class="results" id="results"></div><section class="jobs" id="jobs"></section>
  </main>
  <footer>岗位信息以招聘单位官方公告为准 · 每 6 小时自动更新 · 本网站不接收或保存简历</footer>
  <script id="job-data" type="application/json">${serializedJobs}</script>
  <script>
    const jobs=JSON.parse(document.getElementById('job-data').textContent);const stars={1:'★',2:'★★',3:'★★★',4:'★★★★',5:'★★★★★'};const closed=new Set(['已截止','已关闭']);
    const elements={query:document.getElementById('query'),unitType:document.getElementById('unitType'),direction:document.getElementById('direction'),score:document.getElementById('score'),onlyOpen:document.getElementById('onlyOpen'),jobs:document.getElementById('jobs'),results:document.getElementById('results')};
    const unique=key=>[...new Set(jobs.map(job=>job[key]).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'zh-CN'));const addOptions=(select,values)=>values.forEach(value=>{const option=document.createElement('option');option.value=value;option.textContent=value;select.append(option)});addOptions(elements.unitType,unique('unit_type'));addOptions(elements.direction,unique('direction'));
    document.getElementById('total').textContent=jobs.length;document.getElementById('fiveStar').textContent=jobs.filter(job=>job.match_score===5).length;document.getElementById('open').textContent=jobs.filter(job=>!closed.has(job.recruitment_status)).length;document.getElementById('units').textContent=new Set(jobs.map(job=>job.unit_name)).size;
    const date=value=>value?new Intl.DateTimeFormat('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value)):'未注明';
    function tag(text,className=''){const span=document.createElement('span');span.textContent=text;span.className=className;return span}
    function safeUrl(value){try{const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:'#'}catch{return '#'}}
    function render(){const query=elements.query.value.trim().toLowerCase();const minScore=Number(elements.score.value);const filtered=jobs.filter(job=>(!query||[job.unit_name,job.title,job.direction,job.location,job.industry].join(' ').toLowerCase().includes(query))&&(!elements.unitType.value||job.unit_type===elements.unitType.value)&&(!elements.direction.value||job.direction===elements.direction.value)&&job.match_score>=minScore&&(!elements.onlyOpen.checked||!closed.has(job.recruitment_status)));elements.results.textContent='找到 '+filtered.length+' 个符合条件的岗位';elements.jobs.replaceChildren();if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='当前筛选条件下暂无岗位，请调整筛选条件。';elements.jobs.append(empty);return}filtered.forEach(job=>{const article=document.createElement('article');article.className='job';const main=document.createElement('div');main.className='job-main';const topline=document.createElement('div');topline.className='topline';topline.append(tag(job.unit_type,'type'),tag(stars[job.match_score]||'','stars'));const title=document.createElement('h3');title.textContent=job.title;const unit=document.createElement('p');unit.className='unit';unit.textContent=job.unit_name;const meta=document.createElement('div');meta.className='meta';meta.append(tag(job.location||'全国/未注明'),tag(job.direction),tag('截止 '+date(job.deadline)));const tags=document.createElement('div');tags.className='tags';tags.append(tag(job.system_name),tag(job.education||'学历待核验'),tag(job.non_law_rule,job.non_law_rule==='专业限制待核验'?'warn':'good'));if(job.source_status==='来源待核验')tags.append(tag('来源待核验','warn'));main.append(topline,title,unit,meta,tags);const side=document.createElement('div');side.className='side';const status=tag(job.recruitment_status,'status'+(closed.has(job.recruitment_status)?' closed':''));const apply=document.createElement('a');apply.className='apply';apply.href=safeUrl(job.application_url||job.announcement_url);apply.target='_blank';apply.rel='noreferrer';apply.textContent='前往官方投递 ↗';const notice=document.createElement('a');notice.className='notice';notice.href=safeUrl(job.announcement_url);notice.target='_blank';notice.rel='noreferrer';notice.textContent='查看招聘公告';side.append(status,apply,notice);article.append(main,side);elements.jobs.append(article)})}
    Object.values(elements).slice(0,5).forEach(element=>element.addEventListener(element.tagName==='INPUT'?'input':'change',render));render();
  </script>
</body>
</html>`;
}

async function main() {
  const jobs = await loadJobs();
  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  await Promise.all([
    writeFile(`${OUTPUT_DIRECTORY}/index.html`, createHtml(jobs), "utf8"),
    writeFile(`${OUTPUT_DIRECTORY}/.nojekyll`, "", "utf8")
  ]);
  console.log(`Generated mirror with ${jobs.length} jobs`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
