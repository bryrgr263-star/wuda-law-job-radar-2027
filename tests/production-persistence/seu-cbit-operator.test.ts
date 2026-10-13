import "../helpers/network-guard";
import assert from "node:assert/strict";
import test from "node:test";
import { parseSeuCbitActivationArgs } from "../../scripts/activate-seu-cbit-publication";

test("university operator requires one explicit bounded phase and exact expected commit", () => {
  for (const mode of ["--stage-sources", "--issue-grant", "--acquire"] as const) {
    assert.deepEqual(parseSeuCbitActivationArgs([mode, "a".repeat(40)]), { mode, expected: "a".repeat(40) });
  }
  for (const args of [[], ["--acquire"], ["--crawl", "a".repeat(40)], ["--acquire", "main"], ["--acquire", "a".repeat(40), "another-url"]]) {
    assert.throws(() => parseSeuCbitActivationArgs(args));
  }
});
