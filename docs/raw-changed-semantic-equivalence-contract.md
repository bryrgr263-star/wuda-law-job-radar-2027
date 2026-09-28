# Raw-changed discovery support contract

## Evidence and authority

Run 1 and Run 2 retained distinct complete RawBlob bytes and SHA-256 hashes for the two approved Zhenghan pages. The byte-level changes occur only in WordPress Redis/cache generation comments after the final `</html>`; the bytes through that closing tag, including recruitment text, links, scripts, dates, and attachment references, are identical. Normalized text equality alone is not a sufficient proof.

| Page | HTML prefix bytes | Changed byte offsets | Cache objects | Generation seconds | Cache timestamp |
| --- | ---: | --- | --- | --- | --- |
| `/news/2782.html` | 26,556 | 26,692–26,837 (8 bytes) | 2,118 → 2,117 | 0.484 → 0.569 | 2026-09-27 11:25:57 → 2026-09-28 13:15:59 |
| `/news/2790.html` | 25,738 | 25,874–26,019 (7 bytes) | 2,126 → 2,125 | 0.476 → 0.490 | 2026-09-27 11:26:02 → 2026-09-28 13:16:06 |

Offsets are zero-based and refer to differing bytes, not a continuous changed range. No DOM, recruitment text, job condition, link, or attachment byte changed before the terminal `</html>`.

The existing SourceOccurrenceVersion (SOV) registry owns discovery support. Contract `trusted-sov-discovery-support/1.0.0` still requires identical Raw bytes. Contract `trusted-sov-discovery-support/2.0.0` is limited to the existing Zhenghan adapter and the approved `/news/2782.html` and `/news/2790.html` exact locators. It requires independently verified Raw/Snapshot/acquisition/source references, different full Raw hashes, identical authoritative HTML prefix bytes, and both suffixes matching the constrained terminal cache-comment grammar. It records both full Raw hashes, the prefix hash and length, both suffix hashes, the extraction and normalized descriptors, and the original SOV seal in the sealed support artifact. Process B replays the same command against persisted Raw bytes through the existing resolver; no database row or normalized text is promoted directly to trusted status.

The production composition root selects v2 only for a changed Raw hash on that adapter. The SOV owner, not the root, verifies the exact locator and byte proof. No new registry, SOV, Recall, Relevance, Requirement, Eligibility, or Presentation authority is created.

## Fail-closed cases

- Any changed byte before the terminal `</html>` is not equivalent, even if the extractor emits the same normalized text.
- An unrecognized, oversized, malformed, or non-terminal suffix is not equivalent.
- A changed source, endpoint, locator, content type, parser contract, response revision header, identity evidence, or semantic descriptor is not equivalent.
- A genuinely changed supported recruitment semantic follows the existing SOV revision path. An unproved change remains `REVIEW_REQUIRED`/`EVIDENCE_BLOCKED`; it cannot be silently reused or turned into a negative eligibility/presentation decision.
- The original Raw, Run 1 and Run 2 histories, and their different SHA-256 values are never rewritten or hidden.

## Offline replay boundary

The regression reads the committed Run 2 Raw/Snapshot/ExtractedRecord artifacts, verifies four v2 supports (one package and three positions), runs the existing downstream production binding in an in-memory append overlay, and rebuilds the resolver from that overlay. It does not acquire from the network, write authoritative Git state, or claim a new production Run 2 commit. The historical failure outcome remains an immutable record; a future authorized run must produce its own new outcome.

## Full Scheduler fork diagnosis

`SOURCE_OUTCOME_PENDING` is raised by the existing Scheduler pre-manifest gate when a sealed Continuous Admission `COMPLETE` attempt has no matching sealed Source Execution Outcome. The earlier offline fork reached this gate for the Haier source execution because its mocked HTTP response changed the committed Haier content type from `text/html; charset=utf-8` to `text/html; charset=UTF-8`. The RawBlob SHA-256 and bytes were unchanged, but the existing Raw manifest reuse guard intentionally requires the original content type too. It rejected the fork's inconsistent evidence before Source Outcome issuance. The attempt ID is generated per replay; the regression verifies its `RESERVE` is bound to the Haier authorization and that the `COMPLETE` remains unbound. The pending gate is not bypassed.

The full offline Scheduler regression starts a local Git fork at the committed Run 1 head, serves only the three exact approved URLs from committed Run 2 Raw bytes, and preserves each target's committed content type. It then uses the existing Scheduler and Production Root to generate new Snapshot/ExtractedRecord and business artifacts in that isolated fork. Fresh Process B verifies the resulting Batch, both source outcomes, three new Zhenghan Position-scoped Decision/ReadModel revisions, and Haier `NOT_MODIFIED`. No fork commit is pushed or substituted for authoritative Run 1/Run 2 history.
