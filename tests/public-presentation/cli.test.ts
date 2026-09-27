import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { parsePublicationArgs } from "../../scripts/publish-public-presentation";
import { BASELINE_SHA, STREAM_ID } from "./helpers";

test("publication CLI requires exact SHA, explicit stream and output; cannot acquire or deploy", () => {
  const args = ["--repository", process.cwd(), "--authoritative-sha", BASELINE_SHA,
    "--stream", STREAM_ID, "--base-path", "/radar", "--output", "C:/temp/public-delivery"];
  assert.equal(parsePublicationArgs(args).authoritative_sha, BASELINE_SHA);
  assert.throws(() => parsePublicationArgs(args.map(value => value === BASELINE_SHA ? "HEAD" : value)));
  assert.throws(() => parsePublicationArgs([...args, "--acquire", "true"]));
  assert.throws(() => parsePublicationArgs([...args, "--deploy", "true"]));
  assert.throws(() => parsePublicationArgs(args.slice(0, -2)));
  assert.throws(() => parsePublicationArgs([...args, "--stream", "duplicate"]));
});
