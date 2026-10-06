import { execFileSync } from "node:child_process";
import { canonicalHash, canonicalSerialize } from "../ingestion/normalization/canonical-artifact-registry";
import { DiscoveryCatalog } from "./candidate-catalog";
import type { DiscoveryRecord } from "./contracts";

interface Manifest {
  schema: "discovery-manifest-v1";
  records: { path: string; record_id: string; integrity_hash: string }[];
  integrity_hash: string;
}

export class GitDiscoveryStore {
  private readonly verifiedCommits = new Map<string, DiscoveryRecord[]>();
  constructor(private readonly repository: string) {}

  private git(...args: string[]): string {
    return execFileSync("git", ["-C", this.repository, ...args], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim();
  }

  head(): string { return this.git("rev-parse", "HEAD"); }

  restore(sha: string): DiscoveryCatalog {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw new Error("DISCOVERY_FIXED_SHA_REQUIRED");
    const cached = this.verifiedCommits.get(sha);
    if (cached) {
      const catalog = new DiscoveryCatalog();
      cached.forEach(record => catalog.append(record));
      return catalog;
    }
    this.git("cat-file", "-e", `${sha}^{commit}`);
    const paths = this.git("ls-tree", "-r", "--name-only", sha, "discovery-state").split("\n").filter(Boolean);
    const catalog = new DiscoveryCatalog();
    if (!paths.length) {
      if (this.git("log", "--format=%H", sha, "--", "discovery-state")) throw new Error("DISCOVERY_NAMESPACE_REMOVED");
      this.verifiedCommits.set(sha, []);
      return catalog;
    }
    if (!paths.includes("discovery-state/manifest.json")) throw new Error("DISCOVERY_MANIFEST_MISSING");
    const bytes = this.git("show", `${sha}:discovery-state/manifest.json`);
    const manifest: Manifest = JSON.parse(bytes);
    const { integrity_hash: hash, ...content } = manifest;
    if (manifest.schema !== "discovery-manifest-v1" || canonicalHash(content) !== hash
      || canonicalSerialize(manifest) !== bytes || !Array.isArray(manifest.records)) throw new Error("DISCOVERY_MANIFEST_INVALID");
    let preceding: Manifest["records"] = [];
    let precedingBlobs = new Map<string, string>();
    const changes = this.git("log", "--format=%H", "--reverse", sha, "--", "discovery-state").split("\n").filter(Boolean);
    for (const change of changes) {
      const historyBytes = this.git("show", `${change}:discovery-state/manifest.json`);
      const history: Manifest = JSON.parse(historyBytes);
      const { integrity_hash: historyHash, ...historyContent } = history;
      if (history.schema !== "discovery-manifest-v1" || canonicalHash(historyContent) !== historyHash
        || canonicalSerialize(history) !== historyBytes || history.records.length < preceding.length
        || canonicalHash(history.records.slice(0, preceding.length)) !== canonicalHash(preceding)) {
        throw new Error("DISCOVERY_APPEND_ONLY_HISTORY_INVALID");
      }
      const historicalTree = this.git("ls-tree", "-r", change, "discovery-state").split("\n").filter(Boolean);
      const blobs = new Map(historicalTree.map(line => {
        const [header, name] = line.split("\t");
        return [name!, header!.split(" ")[2]!] as const;
      }));
      if (blobs.size !== history.records.length + 1 || history.records.some(reference => !blobs.has(reference.path))
        || [...precedingBlobs].some(([path, id]) => blobs.get(path) !== id)) throw new Error("DISCOVERY_IMMUTABLE_BLOB_CHANGED");
      precedingBlobs = new Map(history.records.map(reference => [reference.path, blobs.get(reference.path)!]));
      preceding = history.records;
    }
    const known = new Set<string>();
    const batch = execFileSync("git", ["-C", this.repository, "cat-file", "--batch"], {
      input: manifest.records.map(reference => `${sha}:${reference.path}`).join("\n") + (manifest.records.length ? "\n" : ""),
      maxBuffer: 32 * 1024 * 1024
    });
    let offset = 0;
    for (const reference of manifest.records) {
      if (reference.path !== `discovery-state/records/${canonicalHash(reference.record_id)}.json`
        || known.has(reference.path)) throw new Error("DISCOVERY_MANIFEST_REFERENCE_INVALID");
      known.add(reference.path);
      const end = batch.indexOf(10, offset);
      const header = batch.subarray(offset, end).toString("utf8");
      const match = /^[a-f0-9]{40} blob (\d+)$/.exec(header);
      if (end < 0 || !match) throw new Error("DISCOVERY_BLOB_MISSING");
      const size = Number(match[1]);
      offset = end + 1;
      const recordBytes = batch.subarray(offset, offset + size).toString("utf8");
      offset += size + 1;
      const record: DiscoveryRecord = JSON.parse(recordBytes);
      if (canonicalSerialize(record) !== recordBytes || record.record_id !== reference.record_id
        || record.integrity_hash !== reference.integrity_hash) throw new Error("DISCOVERY_RECORD_INVALID");
      catalog.append(record);
    }
    if (paths.length !== known.size + 1 || canonicalHash(preceding) !== canonicalHash(manifest.records)) throw new Error("DISCOVERY_UNTRACKED_RECORD");
    this.verifiedCommits.set(sha, catalog.list());
    return catalog;
  }

  commit(records: readonly DiscoveryRecord[], expectedParent: string): string {
    if (this.head() !== expectedParent) throw new Error("DISCOVERY_CAS_MISMATCH");
    const productionPaths = this.git("ls-tree", "--name-only", expectedParent).split("\n");
    if (productionPaths.some(path => ["trusted-state", "trusted-objects", "production-source-state", "production-runs"].includes(path))) {
      throw new Error("DISCOVERY_ISOLATED_WRITER_REQUIRED");
    }
    const catalog = this.restore(expectedParent);
    const previous = catalog.list();
    records.forEach(record => catalog.append(record));
    const current = catalog.list();
    if (current.length === previous.length) return expectedParent;
    const entries = current.map(record => ({ path: `discovery-state/records/${canonicalHash(record.record_id)}.json`,
      record_id: record.record_id, integrity_hash: record.integrity_hash }));
    const content = { schema: "discovery-manifest-v1" as const, records: entries };
    const manifest = { ...content, integrity_hash: canonicalHash(content) };
    const blob = (bytes: string) => execFileSync("git", ["-C", this.repository, "hash-object", "-w", "--stdin"], { input: bytes, encoding: "utf8" }).trim();
    const previousBlobs = new Map<string, string>();
    if (previous.length) {
      for (const line of this.git("ls-tree", `${expectedParent}:discovery-state/records`).split("\n")) {
        const [header, name] = line.split("\t");
        if (name) previousBlobs.set(name, header!.split(" ")[2]!);
      }
    }
    const recordEntries = current.map((record, index) => {
      const name = entries[index]!.path.split("/").at(-1)!;
      return `100644 blob ${previousBlobs.get(name) ?? blob(canonicalSerialize(record))}\t${name}`;
    });
    const tree = (lines: string[]) => execFileSync("git", ["-C", this.repository, "mktree"], { input: lines.join("\n") + "\n", encoding: "utf8" }).trim();
    const recordsTree = tree(recordEntries);
    const discoveryTree = tree([`100644 blob ${blob(canonicalSerialize(manifest))}\tmanifest.json`, `040000 tree ${recordsTree}\trecords`]);
    const rootEntries = this.git("ls-tree", `${expectedParent}^{tree}`).split("\n").filter(line => line && !line.endsWith("\tdiscovery-state"));
    const rootTree = tree([...rootEntries, `040000 tree ${discoveryTree}\tdiscovery-state`]);
    const commit = this.git("commit-tree", rootTree, "-p", expectedParent, "-m", "discovery: append untrusted candidate evidence");
    this.restore(commit);
    this.git("update-ref", "HEAD", commit, expectedParent);
    return commit;
  }
}
