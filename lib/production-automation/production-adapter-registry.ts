import type { RecruitmentAdapter } from "../ingestion";
import { Haier2027LegalOfficialHtmlAdapter } from "../production-sources/haier-2027-source";
import { Zhenghan2027OfficialHtmlAdapter } from "../production-sources/zhenghan-2027-source";

const productionAdapters = new Map<string, RecruitmentAdapter>();
for (const adapter of [new Haier2027LegalOfficialHtmlAdapter(), new Zhenghan2027OfficialHtmlAdapter()]) {
  if (productionAdapters.has(adapter.descriptor.adapter_key)) throw new Error("PRODUCTION_ADAPTER_KEY_COLLISION");
  productionAdapters.set(adapter.descriptor.adapter_key, adapter);
}

export function resolveProductionAdapter(adapterKey: string): RecruitmentAdapter | null {
  return productionAdapters.get(adapterKey) ?? null;
}

export function registeredProductionAdapterKeys(): readonly string[] {
  return Object.freeze([...productionAdapters.keys()].sort());
}
