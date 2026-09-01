import { SOURCE_CATALOG } from "../lib/source-catalog";
import { crawlSource } from "../lib/crawler";
async function main() {
  const source = { id: "debug", ...SOURCE_CATALOG.find((item) => item.name.includes("智联招聘2027届法务公开职位搜索"))! };
  const jobs = await crawlSource(source);
  console.log(JSON.stringify(jobs.map(({title,unit_name,announcement_url,application_url,non_law_rule}) => ({title,unit_name,announcement_url,application_url,non_law_rule})), null, 2));
  console.log(`COUNT=${jobs.length}`);
}
main();
