import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const migrationRoot = path.join(root, "production", "persistence", "migrations");

async function migrations() {
  const names = (await readdir(migrationRoot)).sort();
  return Promise.all(names.map(async (name) => ({
    name,
    sql: await readFile(path.join(migrationRoot, name), "utf8")
  })));
}

test("production persistence contains deterministic forward migrations 001 through 006", async () => {
  assert.deepEqual((await migrations()).map(({ name }) => name), [
    "001_trusted_chain_foundation.up.sql",
    "002_source_registry_admission.up.sql",
    "003_raw_acquisition_source_facts.up.sql",
    "004_artifact_ledger.up.sql",
    "005_atomic_command_journal.up.sql",
    "006_candidate_evidence_presentation_reader.up.sql"
  ]);
});

test("private schema and separated roles default deny public Data API roles", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  for (const role of [
    "trusted_chain_owner", "trusted_chain_writer", "trusted_chain_reader",
    "trusted_chain_recovery", "trusted_chain_auditor", "trusted_chain_storage_writer"
  ]) {
    assert.match(sql, new RegExp(`create role ${role}`, "u"));
  }
  assert.match(sql, /create schema if not exists trusted_chain/iu);
  assert.match(sql, /grant trusted_chain_owner to trusted_chain_migrator/iu);
  assert.match(sql, /revoke all on schema trusted_chain from public, anon, authenticated, service_role/iu);
  assert.match(sql, /force row level security/iu);
});

test("immutable tables reject UPDATE, DELETE, and TRUNCATE independently of grants", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  assert.match(sql, /before update or delete[\s\S]+reject_immutable_mutation/iu);
  assert.match(sql, /before truncate[\s\S]+reject_immutable_truncate/iu);
  assert.match(sql, /revoke all[\s\S]+trusted_chain_writer, trusted_chain_reader/iu);
  assert.doesNotMatch(sql, /grant\s+(?:update|delete|truncate)[^;]*trusted_chain_(?:writer|reader)/iu);
});

test("writer receives narrow append RPCs and one complete appendExecution boundary", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  assert.match(sql, /grant execute on function trusted_chain\.%I\(jsonb\) to trusted_chain_writer/iu);
  assert.match(sql, /create or replace function trusted_chain\.append_execution\(execution jsonb\)/iu);
  assert.match(sql, /create table trusted_chain\.artifacts/iu);
  assert.match(sql, /create table trusted_chain\.command_journal/iu);
  assert.match(sql, /create table trusted_chain\.journal_heads/iu);
});

test("appendExecution locks and advances one fenced monotonic journal head", async () => {
  const sql = await readFile(
    path.join(migrationRoot, "005_atomic_command_journal.up.sql"),
    "utf8"
  );
  assert.match(sql, /pg_advisory_xact_lock/iu);
  assert.match(sql, /where stream_id = stream for update/iu);
  assert.match(sql, /head\.writer_epoch is distinct from epoch/iu);
  assert.match(sql, /head\.current_sequence \+ 1/iu);
  assert.match(sql, /record->>'previous_record_hash' is distinct from head\.current_hash/iu);
  assert.match(sql, /update trusted_chain\.journal_heads[\s\S]+current_sequence/iu);
  assert.match(sql, /Journal head advance failed/u);
  assert.doesNotMatch(sql, /grant\s+update[^;]+journal_heads[^;]+trusted_chain_writer/iu);
});

test("artifact ledger is immutable, scoped, collision-safe, and upstream-bound", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  assert.match(sql, /create table trusted_chain\.artifact_upstream_references/iu);
  assert.match(sql, /Artifact identity collision/u);
  assert.match(sql, /Missing or invalid upstream artifact/u);
  assert.match(sql, /artifact_row\.scope <> envelope->>'scope'/iu);
  assert.match(sql, /artifact_row\.seal <> reference->>'expected_seal'/iu);
  assert.match(sql, /artifacts_stream_revision_uq/iu);
});

test("checkpoint contract has genesis, chain, signer metadata, and recovery-only mutation", async () => {
  const sql = await readFile(
    path.join(migrationRoot, "005_atomic_command_journal.up.sql"),
    "utf8"
  );
  assert.match(sql, /initialize_journal_stream/iu);
  assert.match(sql, /Invalid genesis checkpoint/u);
  assert.match(sql, /signature_algorithm text not null check \(signature_algorithm = 'Ed25519'\)/iu);
  assert.match(sql, /previous_checkpoint_hash/iu);
  assert.match(sql, /grant execute on function trusted_chain\.append_journal_checkpoint\(jsonb\) to trusted_chain_recovery/iu);
  assert.doesNotMatch(sql, /grant execute on function trusted_chain\.append_journal_checkpoint\(jsonb\) to trusted_chain_writer/iu);
});

test("journal, checkpoint, and ReadModel projection enforce idempotent reuse or collision", async () => {
  const sql = await readFile(
    path.join(migrationRoot, "005_atomic_command_journal.up.sql"),
    "utf8"
  );
  assert.match(sql, /existing_execution_identity = incoming_execution_identity then[\s\S]+IDEMPOTENT_REUSE/iu);
  assert.match(sql, /execution - 'writer_epoch' - 'record_integrity_bytes'/iu);
  assert.match(sql, /Command identity collision/u);
  assert.match(sql, /existing = checkpoint then return 'IDEMPOTENT_REUSE'/iu);
  assert.match(sql, /Checkpoint identity collision/u);
  assert.match(sql, /ReadModel projection identity collision/u);
  assert.match(sql, /projection_record := artifact_row\.canonical_bytes::jsonb/iu);
  assert.match(sql, /ReadModel projection record mismatch/u);
});

test("source and admission revisions enforce stream uniqueness, supersedes continuity, and collision rejection", async () => {
  const sql = await readFile(
    path.join(migrationRoot, "002_source_registry_admission.up.sql"),
    "utf8"
  );
  assert.match(sql, /unique \(source_admission_id, revision\)/iu);
  assert.match(sql, /unique \(recruitment_endpoint_id, revision\)/iu);
  assert.match(sql, /Source revision continuity mismatch/u);
  assert.match(sql, /Source artifact ID collision/u);
  assert.match(sql, /IDEMPOTENT_REUSE/u);
});

test("Raw storage is private, content-addressed, insert/read-only, and non-overwritable", async () => {
  const sql = (await readFile(
    path.join(migrationRoot, "003_raw_acquisition_source_facts.up.sql"),
    "utf8"
  ));
  assert.match(sql, /values \('trusted-raw-production', 'trusted-raw-production', false\)/iu);
  assert.match(sql, /\^sha256\/\[a-f0-9\]\{2\}\/\[a-f0-9\]\{2\}\/\[a-f0-9\]\{64\}\$/u);
  assert.match(sql, /grant select, insert on storage\.objects to trusted_chain_storage_writer/iu);
  assert.match(sql, /revoke update, delete, truncate on storage\.objects from trusted_chain_storage_writer/iu);
  assert.doesNotMatch(sql, /for (?:update|delete) to trusted_chain_storage_writer/iu);
});

test("Candidate Evidence storage is private, content-addressed, and isolated from readers", async () => {
  const sql = await readFile(
    path.join(migrationRoot, "006_candidate_evidence_presentation_reader.up.sql"),
    "utf8"
  );
  assert.match(sql, /trusted-candidate-evidence-production',\s*'trusted-candidate-evidence-production',\s*false/iu);
  assert.match(sql, /trusted_candidate_evidence_production_insert/iu);
  assert.match(sql, /trusted_candidate_evidence_production_verify_read/iu);
  assert.match(sql, /\^sha256\/\[a-f0-9\]\{2\}\/\[a-f0-9\]\{2\}\/\[a-f0-9\]\{64\}\$/u);
  assert.doesNotMatch(sql, /to trusted_chain_reader[\s\S]+storage\.objects/iu);
});

test("migrations never mutate or grant access to legacy production tables", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  assert.doesNotMatch(sql, /(?:alter|drop|delete from|update|truncate|insert into)\s+(?:public\.)?(?:jobs|sources|sync_runs)\b/iu);
  assert.doesNotMatch(sql, /grant[^;]+on[^;]+(?:public\.)?(?:jobs|sources|sync_runs)\b/iu);
});

test("Presentation reader has no Raw, Candidate Evidence, or journal table grant", async () => {
  const sql = (await migrations()).map((migration) => migration.sql).join("\n");
  assert.doesNotMatch(sql, /grant[^;]+on\s+trusted_chain\.(?:raw_blobs|acquisition_runs|snapshots|extracted_records)[^;]+trusted_chain_reader/iu);
  assert.doesNotMatch(sql, /grant[^;]+on\s+trusted_chain\.(?:candidate_evidence|command_journal|journal_heads)[^;]+trusted_chain_reader/iu);
  assert.match(sql, /grant select on trusted_chain\.presentation_read_model_projections[\s\S]+to trusted_chain_reader/iu);
  assert.match(sql, /presentation_read_model_reader_select[\s\S]+scope = 'PRODUCTION'/iu);
});
