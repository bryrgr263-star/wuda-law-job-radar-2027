import "../helpers/network-guard";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  InMemoryTrustedSourceOccurrenceTracker,
  TrustedSourceOccurrenceRegistryError,
  assertTrustedSourceOccurrenceVersionResolver,
  type Snapshot
} from "../../lib/ingestion";
import {
  GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT
} from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import {
  GuizhouLegalXlsxRequirementObservationAdapter,
  createGuizhouLegalRequirementEndpoint
} from "../../lib/live-canary/p2-legal-05/guizhou-legal-xlsx-requirement-adapter";
import {
  createP2Legal08bAnnouncementRecord
} from "../../lib/live-canary/p2-legal-08b";
import { GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID } from "../../lib/live-canary/p2-legal-01/guizhou-legal-canary-admission-preflight";
import { GUIZHOU_ATTACHMENT_EXPECTED_MIME } from "../../lib/live-canary/p2-legal-04/guizhou-attachment-observation-canary";
import type { RawBlob } from "../../lib/ingestion";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const archived = archivedEvidence();
const announcementRecord = createP2Legal08bAnnouncementRecord(
  archived.noticeBytes,
  archived.noticeSnapshot
);

test("trusted SOV registry seals package artifacts idempotently", () => {
  const tracker = new InMemoryTrustedSourceOccurrenceTracker();
  const first = tracker.process({
    source_role: "PACKAGE",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  });
  const second = tracker.process({
    source_role: "PACKAGE",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  });

  assert.deepEqual(second, first);
  assert.deepEqual(
    tracker.resolve(first.version.source_occurrence_version_id),
    first
  );
});

test("trusted SOV registry rejects one ID with different canonical artifact bytes", () => {
  const tracker = new InMemoryTrustedSourceOccurrenceTracker();
  tracker.process({
    source_role: "PACKAGE",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  });
  const changedEndpoint = {
    ...GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    name: { original: original("mutated endpoint display name") }
  };

  assert.throws(() => tracker.process({
    source_role: "PACKAGE",
    endpoint: changedEndpoint,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  }), TrustedSourceOccurrenceRegistryError);
});

test("trusted SOV resolver returns defensive nested clones", () => {
  const tracker = new InMemoryTrustedSourceOccurrenceTracker();
  const sealed = tracker.process({
    source_role: "PACKAGE",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  });
  const resolved = tracker.resolve(sealed.version.source_occurrence_version_id)!;
  (resolved.extracted_record.adapter_metadata as Record<string, unknown>).mutated = true;
  (resolved.version.content.locations as unknown[]).push({ raw_text: original("mutation") });

  const again = tracker.resolve(sealed.version.source_occurrence_version_id)!;
  assert.equal("mutated" in again.extracted_record.adapter_metadata, false);
  assert.deepEqual(again.version.content.locations, sealed.version.content.locations);
});

test("SOV roles keep package and Position-bearing records separate", () => {
  const targetRecord = targetExtractedRecord();
  const tracker = new InMemoryTrustedSourceOccurrenceTracker();

  assert.throws(() => tracker.process({
    source_role: "POSITION_BEARING",
    endpoint: GUIZHOU_LEGAL_CANARY_NOTICE_ENDPOINT,
    extracted_record: announcementRecord,
    snapshot: archived.noticeSnapshot
  }), TrustedSourceOccurrenceRegistryError);
  assert.throws(() => tracker.process({
    source_role: "PACKAGE",
    endpoint: createGuizhouLegalRequirementEndpoint(
      GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
    ),
    extracted_record: targetRecord,
    snapshot: archived.attachmentSnapshot
  }), TrustedSourceOccurrenceRegistryError);
});

test("caller-created resolver-shaped objects are not trusted SOV resolvers", () => {
  assert.throws(() => assertTrustedSourceOccurrenceVersionResolver({
    resolve() {
      return null;
    }
  }), TrustedSourceOccurrenceRegistryError);
});

function targetExtractedRecord() {
  const endpoint = createGuizhouLegalRequirementEndpoint(
    GUIZHOU_LEGAL_CANARY_SOURCE_DEFINITION_ID
  );
  const rawBlob: RawBlob = {
    raw_blob_id: archived.attachmentSnapshot.raw_blob_id!,
    bytes: new Uint8Array(archived.attachmentBytes),
    raw_content_sha256: archived.attachmentSnapshot.content_hash!,
    mime_type: GUIZHOU_ATTACHMENT_EXPECTED_MIME,
    byte_length: archived.attachmentBytes.byteLength,
    created_at: archived.attachmentSnapshot.observed_at
  };
  return new GuizhouLegalXlsxRequirementObservationAdapter().parse({
    endpoint,
    snapshot: archived.attachmentSnapshot,
    raw_blob: rawBlob
  }).source_occurrence_record;
}

function archivedEvidence() {
  const noticeDirectory = path.join(
    repositoryRoot,
    "outputs/p2-legal-02/p2-legal-02-run-514a72f9-0a36-4e8b-9358-73c2ebc88cae"
  );
  const attachmentDirectory = path.join(
    repositoryRoot,
    "outputs/p2-legal-04/p2-legal-04-run-22ecbdab-0123-421d-994c-97a35cde4dcf"
  );
  return {
    noticeBytes: new Uint8Array(readFileSync(path.join(noticeDirectory, "raw.html"))),
    noticeSnapshot: JSON.parse(readFileSync(
      path.join(noticeDirectory, "snapshot.json"),
      "utf8"
    )) as Snapshot,
    attachmentBytes: new Uint8Array(readFileSync(path.join(attachmentDirectory, "raw.xlsx"))),
    attachmentSnapshot: JSON.parse(readFileSync(
      path.join(attachmentDirectory, "snapshot.json"),
      "utf8"
    )) as Snapshot
  };
}

function original(text: string) {
  return { text, encoding: "UTF-8" as const };
}
