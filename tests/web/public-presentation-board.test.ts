import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadPublicPresentationBoard } from "../../lib/presentation-web/public-loader";
import { JobBoard, JobDetails } from "../../components/job-board";
import { createPublicSnapshot } from "../../lib/public-presentation/snapshot";
import { fixtureInput } from "../public-presentation/helpers";

test("same JobBoard loads sealed Run1 public data without legacy; exact links and trace remain honest", async () => {
  const input = fixtureInput();
  const snapshot = createPublicSnapshot(input);
  let requests = 0;
  const board = await loadPublicPresentationBoard({ snapshot_url: `/radar/presentation/snapshots/${snapshot.payload_sha256}.json`,
    expected_sha: input.authoritative_sha, expected_payload_hash: snapshot.payload_sha256, origin: "https://delivery.invalid",
    fetcher: async (url, options) => {
      requests++;
      assert.ok(String(url).startsWith("https://delivery.invalid/radar/presentation/snapshots/"));
      assert.equal(options?.credentials, "omit");
      assert.equal(options?.redirect, "error");
      return new Response(JSON.stringify(snapshot));
    } });
  assert.equal(requests, 1);
  assert.equal(board.jobs.length, 4);
  const html = renderToStaticMarkup(createElement(JobBoard, { initialJobs: board.jobs }));
  assert.equal((html.match(/class="job-card"/gu) ?? []).length, 4);
  assert.equal((html.match(/投递链接尚未取得/gu) ?? []).length, 3);
  for (const job of board.jobs) {
    const detail = renderToStaticMarkup(createElement(JobDetails, { job }));
    assert.ok(detail.includes("RELEVANCE_ASSESSMENT_MISSING"));
    assert.ok(detail.includes(`href="${job.announcementLink}"`));
    assert.ok(!("candidateId" in job));
  }
});

test("public loader rejects origin, redirect, hash, SHA and schema mismatch; empty valid is distinct", async () => {
  const input = fixtureInput();
  const snapshot = createPublicSnapshot(input);
  const args = { snapshot_url: `/presentation/snapshots/${snapshot.payload_sha256}.json`,
    expected_sha: input.authoritative_sha, expected_payload_hash: snapshot.payload_sha256, origin: "https://delivery.invalid" };
  await assert.rejects(loadPublicPresentationBoard({ ...args, snapshot_url: "https://unapproved.invalid/file", fetcher: async () => { throw new Error("must not call"); } }));
  for (const value of [{ ...snapshot, payload_sha256: "0".repeat(64) }, { ...snapshot, private: "SECRET" }]) {
    await assert.rejects(loadPublicPresentationBoard({ ...args, fetcher: async () => new Response(JSON.stringify(value)) }));
  }
  await assert.rejects(loadPublicPresentationBoard({ ...args, expected_sha: "0".repeat(40), fetcher: async () => new Response(JSON.stringify(snapshot)) }));
  await assert.rejects(loadPublicPresentationBoard({ ...args, fetcher: async () => new Response("redirect", { status: 302 }) }));
  const empty = createPublicSnapshot({ ...input, current_snapshot: { ...input.current_snapshot, current_position_read_models: [] } });
  const result = await loadPublicPresentationBoard({ ...args, snapshot_url: `/presentation/snapshots/${empty.payload_sha256}.json`,
    expected_payload_hash: empty.payload_sha256, fetcher: async () => new Response(JSON.stringify(empty)) });
  assert.equal(result.jobs.length, 0);
});
