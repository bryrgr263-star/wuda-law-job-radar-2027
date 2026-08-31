export type UnitType =
  | "央企"
  | "中科院体系企业"
  | "地方国企"
  | "烟草系统"
  | "金融机构"
  | "事业单位"
  | "科研院所"
  | "律所"
  | "大型科技企业"
  | "其他国资背景单位";

export type NonLawRule =
  | "明确接受法律硕士（非法学）"
  | "可能接受"
  | "不接受"
  | "要求本科法学"
  | "要求本硕均法学"
  | "专业限制待核验";

export type SourceStatus = "官方来源" | "来源待核验";

export type Job = {
  id: string;
  job_id: string;
  announcement_url: string;
  application_url: string | null;
  unit_name: string;
  unit_type: UnitType;
  system_name: string;
  industry: string;
  location: string;
  title: string;
  direction: string;
  recruitment_year: number;
  batch: string;
  education: string;
  non_law_rule: NonLawRule;
  match_score: number;
  salary: string;
  development: string;
  start_date: string | null;
  deadline: string | null;
  recruitment_status: string;
  source_status: SourceStatus;
  source_name: string;
  source_updated_at: string | null;
  updated_at: string;
};

export type CrawlSource = {
  id: string;
  name: string;
  url: string;
  official_domain: string;
  unit_name: string;
  unit_type: UnitType;
  system_name: string;
  industry: string;
  enabled: boolean;
};
