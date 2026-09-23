import type { RecruitmentAdapter } from "../ingestion";

const productionAdapters = new Map<string, RecruitmentAdapter>();

export function resolveProductionAdapter(adapterKey: string): RecruitmentAdapter | null {
  return productionAdapters.get(adapterKey) ?? null;
}

export function registeredProductionAdapterKeys(): readonly string[] {
  return Object.freeze([...productionAdapters.keys()].sort());
}
