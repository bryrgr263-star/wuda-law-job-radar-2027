import type { CrawlSource } from "@/lib/types";

type SourceCatalogEntry = Omit<CrawlSource, "id">;

export const SOURCE_CATALOG: SourceCatalogEntry[] = [
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
