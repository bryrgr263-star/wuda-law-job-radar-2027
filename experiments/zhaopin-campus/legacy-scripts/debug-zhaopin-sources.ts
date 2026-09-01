import { crawlSource } from "../lib/crawler";
import { SOURCE_CATALOG } from "../lib/source-catalog";

async function main() {
  const selected = process.argv.slice(2);
  const sources = SOURCE_CATALOG.filter((source) =>
    source.name.startsWith("智联招聘")
    && source.name.endsWith("公开职位搜索")
    && (!selected.length || selected.some((term) => source.name.includes(term)))
  );
  let total = 0;

  for (let index = 0; index < sources.length; index += 2) {
    const results = await Promise.all(sources.slice(index, index + 2).map(async (source) => {
      const jobs = await crawlSource({ id: source.url, ...source });
      return { source: source.name, jobs };
    }));

    for (const result of results) {
      total += result.jobs.length;
      console.log(`\n${result.source}: ${result.jobs.length}`);
      result.jobs.forEach((job) => console.log(`- ${job.unit_name} | ${job.title} | ${job.non_law_rule}`));
    }
  }

  console.log(`\nTOTAL=${total}`);
}

main();
