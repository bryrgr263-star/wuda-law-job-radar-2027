insert into public.sources (name, url, official_domain, unit_name, unit_type, system_name, industry, enabled)
values
  ('国务院国资委人事招聘', 'https://www.sasac.gov.cn/n2588035/n2588325/n2588350/index.html', 'sasac.gov.cn', '国务院国资委监管中央企业', '央企', '国务院国资委央企', '综合', true),
  ('中央企业应届生招聘公开平台', 'https://job.mohrss.gov.cn/qyzp/index.jhtml', 'mohrss.gov.cn', '中央企业招聘信息平台', '央企', '国务院国资委央企', '综合', true),
  ('国家烟草专卖局招聘信息', 'https://www.tobacco.gov.cn/gjyc/zpxx/list.shtml', 'tobacco.gov.cn', '中国烟草总公司体系', '烟草系统', '烟草专卖系统', '烟草', true),
  ('国科控股招贤纳士', 'https://holdings.cas.cn/zxns/', 'holdings.cas.cn', '中国科学院控股有限公司', '中科院体系企业', '中国科学院体系', '科技投资与成果转化', true),
  ('中国科学院软件研究所人才招聘', 'https://www.is.cas.cn/rcdw/rczp/', 'is.cas.cn', '中国科学院软件研究所', '科研院所', '中国科学院体系', '科研与基础软件', true),
  ('中国电信校园招聘', 'https://wejob.chinatelecom.com.cn/wt/TELE/web/index', 'chinatelecom.com.cn', '中国电信集团有限公司', '央企', '国务院国资委央企', '通信', true),
  ('麒麟软件校园招聘', 'https://www.kylinos.cn/about/job/campusRecruitment/index.html', 'kylinos.cn', '麒麟软件有限公司', '央企', '中国电子信息产业集团核心二级单位', '基础软件', true),
  ('泰康基金人才招聘', 'https://www.tkfunds.com.cn/aboutus/job/index.html', 'tkfunds.com.cn', '泰康基金管理有限公司', '金融机构', '金融体系', '公募基金', true),
  ('TCL校园招聘', 'https://zhaopin.tcl.com/campus/recruiting.html?id=59&jobmx=308501', 'tcl.com', 'TCL科技集团', '大型科技企业', '大型科技企业', '智能科技与制造', true),
  ('OPPO校园招聘', 'https://careers.oppo.com/university/oppo/campus', 'oppo.com', 'OPPO', '大型科技企业', '大型科技企业', '消费电子与科技', true),
  ('安克创新校园招聘', 'https://career.anker.com.cn/universities/recruitment/', 'anker.com.cn', '安克创新科技股份有限公司', '大型科技企业', '大型科技企业', '消费电子与跨境科技', true),
  ('虹桥正瀚招聘', 'https://www.zhenghan.com/news/', 'zhenghan.com', '上海虹桥正瀚律师事务所', '律所', '精品律所', '法律服务', true)
on conflict (url) do update set
  name = excluded.name,
  unit_name = excluded.unit_name,
  unit_type = excluded.unit_type,
  system_name = excluded.system_name,
  industry = excluded.industry,
  enabled = excluded.enabled;

insert into public.jobs (
  job_id, announcement_url, application_url, unit_name, unit_type, system_name, industry, location, title, direction,
  recruitment_year, batch, education, non_law_rule, match_score, salary, development, start_date, deadline,
  recruitment_status, source_status, source_name, source_updated_at, content_hash, is_published
)
select
  job_id, announcement_url, application_url, unit_name, unit_type, system_name, industry, location, title, direction,
  2027, batch, education, non_law_rule, match_score, salary, development, start_date::date, deadline::date,
  recruitment_status, source_status, source_name, source_updated_at::timestamptz,
  md5(title || coalesce(deadline, '') || non_law_rule || recruitment_status), true
from (values
  ('2027-麒麟软件-法务专员-001','https://www.kylinos.cn/about/job/campusRecruitment/index.html','https://kylinos.zhiye.com/campus/detail?jobAdId=75f86da3-4d16-4c91-b6ab-5648be60b189','麒麟软件有限公司','央企','中国电子信息产业集团核心二级单位','基础软件','北京','2027校招—法务专员','法务','秋季校园招聘','硕士研究生及以上','可能接受',4,'未公开','法务与合规','2026-08-25',null,'网申进行中','官方来源','麒麟软件校园招聘官网','2026-08-25T00:00:00+08:00'),
  ('2027-OPPO-法务经理-001','https://careers.oppo.com/university/oppo/campus/post/1765?recruitType=Graduate','https://careers.oppo.com/university/oppo/campus/post/1765?recruitType=Graduate','OPPO','大型科技企业','大型科技企业','消费电子与科技','东莞','2027届应届生校园招聘—法务经理','法务','秋季校园招聘','硕士研究生及以上','可能接受',4,'未公开','涉外法务与商业合规','2026-07-15',null,'网申进行中','官方来源','OPPO招聘官网','2026-07-15T00:00:00+08:00'),
  ('2027-泰康基金-合规管理-001','https://www.tkfunds.com.cn/aboutus/job/index.html','https://www.tkfunds.com.cn/aboutus/job/index.html','泰康基金管理有限公司','金融机构','金融体系','公募基金','北京','2027届校园招聘—合规管理','合规管理','秋季校园招聘','硕士研究生及以上','可能接受',4,'未公开','法律合规、监察稽核与投资监督','2026-03-25',null,'网申进行中','官方来源','泰康基金官方网站','2026-08-28T00:00:00+08:00'),
  ('2027-中国电信-综合支撑法律方向-001','https://wejob.chinatelecom.com.cn/wt/TELE/web/index','https://wejob.chinatelecom.com.cn/wt/TELE/web/index','中国电信集团有限公司及所属单位','央企','国务院国资委央企','通信','全国','2027校园招聘—综合支撑（法律方向）','法律事务','秋季校园招聘','本科、硕士及博士','专业限制待核验',3,'未公开','法律、财务审计与综合支撑',null,null,'岗位陆续更新','官方来源','中国电信招聘官网','2026-08-31T00:00:00+08:00'),
  ('2027-TCL-合规法务部职位池-001','https://zhaopin.tcl.com/campus/recruiting.html?id=59&jobmx=308501','https://tcl.hotjob.cn/wt/TCL/web/index/campus','TCL科技集团','大型科技企业','大型科技企业','智能科技与制造','中国大陆及海外','2027届全球校园招聘—合规法务部职位池','合规管理','全球校园招聘','学历要求待核验','专业限制待核验',3,'未公开','合规法务',null,null,'网申进行中','官方来源','TCL校园招聘官网','2026-08-31T00:00:00+08:00'),
  ('2027-虹桥正瀚-校园招聘-001','https://www.zhenghan.com/news/2782.html','https://www.zhenghan.com/news/2782.html','上海虹桥正瀚律师事务所','律所','精品律所','法律服务','上海','2027届校园招聘—争议解决方向','法律事务','校园招聘','法学本科或研究生','专业限制待核验',3,'未公开','复杂争议解决','2026-05-13',null,'招聘已启动','官方来源','虹桥正瀚律师事务所官网','2026-05-13T00:00:00+08:00'),
  ('2027-光大证券-总部合规风控类-001','https://career.nankai.edu.cn/correcruit/content/id/116621.html',null,'光大证券股份有限公司','金融机构','中国光大集团核心金融平台','证券','上海','2027校园招聘—总部合规风控类','合规管理','秋季校园招聘','硕士研究生及以上','可能接受',4,'15,000–20,000元/月（高校就业网信息）','风险管理、法律合规、内部审计','2026-08-20',null,'网申进行中','来源待核验','南开大学就业信息网','2026-08-20T00:00:00+08:00')
) as seed(job_id,announcement_url,application_url,unit_name,unit_type,system_name,industry,location,title,direction,batch,education,non_law_rule,match_score,salary,development,start_date,deadline,recruitment_status,source_status,source_name,source_updated_at)
on conflict (job_id) do update set
  announcement_url = excluded.announcement_url,
  application_url = excluded.application_url,
  recruitment_status = excluded.recruitment_status,
  deadline = excluded.deadline,
  non_law_rule = excluded.non_law_rule,
  match_score = excluded.match_score,
  source_status = excluded.source_status,
  source_updated_at = excluded.source_updated_at;
