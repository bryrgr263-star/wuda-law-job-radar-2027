import type { CrawlSource } from "@/lib/types";

type SourceCatalogEntry = Omit<CrawlSource, "id">;

export const REPLACED_SOURCE_URLS = [
  "https://www.sasac.gov.cn/n2588035/n2588325/n2588350/index.html",
  "https://job.mohrss.gov.cn/qyzp/index.jhtml",
  "https://www.tobacco.gov.cn/gjyc/zpxx/list.shtml",
  "https://www.is.cas.cn/rcdw/rczp/"
];

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
  {
    name: "国聘国资央企公开招聘平台",
    url: "https://www.iguopin.com/",
    official_domain: "iguopin.com",
    unit_name: "国聘平台收录单位",
    unit_type: "其他国资背景单位",
    system_name: "国资央企公开招聘平台",
    industry: "综合",
    enabled: true
  },
  {
    name: "智联招聘2027届法务公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=2027%E5%B1%8A%20%E6%B3%95%E5%8A%A1&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘2027法务公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=2027%20%E6%B3%95%E5%8A%A1&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届法务公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E6%B3%95%E5%8A%A1&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘2027合规公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=2027%20%E5%90%88%E8%A7%84&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届合规公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E5%90%88%E8%A7%84&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届法律管理公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E6%B3%95%E5%BE%8B%E7%AE%A1%E7%90%86&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届审计公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E5%AE%A1%E8%AE%A1&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届内控公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E5%86%85%E6%8E%A7&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘27届综合管理公开职位搜索",
    url: "https://sou.zhaopin.com/?kw=27%E5%B1%8A%20%E7%BB%BC%E5%90%88%E7%AE%A1%E7%90%86&kt=3",
    official_domain: "zhaopin.com",
    unit_name: "智联招聘收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "中国科学院软件研究所人才招聘（HTTP备用入口）",
    url: "http://www.is.cas.cn/rcdw/rczp/",
    official_domain: "is.cas.cn",
    unit_name: "中国科学院软件研究所",
    unit_type: "科研院所",
    system_name: "中国科学院体系",
    industry: "科研与基础软件",
    enabled: true
  },
  {
    name: "中科环保校园招聘",
    url: "https://zhongkehuanbao.zhiye.com/campus/jobs",
    official_domain: "zhiye.com",
    unit_name: "北京中科润宇环保科技股份有限公司（中科环保）",
    unit_type: "中科院体系企业",
    system_name: "中国科学院体系（国科控股参股企业）",
    industry: "环保与循环经济",
    enabled: true
  },
  {
    name: "应届生求职网法务职位专区",
    url: "https://zhiwei.yingjiesheng.com/fawu/",
    official_domain: "yingjiesheng.com",
    unit_name: "应届生求职网收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "应届生求职网法律专业专区",
    url: "https://www.yingjiesheng.com/major/falv/",
    official_domain: "yingjiesheng.com",
    unit_name: "应届生求职网收录单位",
    unit_type: "其他企业",
    system_name: "公开招聘聚合来源",
    industry: "待核验",
    enabled: true
  },
  {
    name: "智联招聘中电科普天科技法务专员",
    url: "https://www.zhaopin.com/jobdetail/CC000269110J40902377013.htm",
    official_domain: "zhaopin.com",
    unit_name: "中电科普天科技股份有限公司",
    unit_type: "央企",
    system_name: "中国电子科技集团所属单位",
    industry: "通信与信息技术",
    enabled: true
  }
];
