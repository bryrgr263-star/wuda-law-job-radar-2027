# Cross-environment Process B determinism

## Scope and immutable evidence

The oracle is the existing Run 1 authoritative commit
`241bbe938a56996be07da539ba2f17f6cc335e96`, stream
`initial-production-source-activation`, journal sequences 1 through 26.
No historical journal, artifact, acquisition, seal or hash is rewritten.
No real HTTP request or remote workflow execution is needed for this audit.
`RELEVANCE_ASSESSMENT_MISSING` is outside this change.

## First divergence

Sequence 11 is `POSITION_VERSION_MATERIALIZE`. Its command hash is
`abc9534b001ac63626f8f281b592a947c1b792771b7eedbf5a8f7c56029eaa19`.
The expected result hash is
`23320bdedad84cd295fc3b1eb3544c0a7194da0b7f585369742952f0dcdcd3a3`;
native Windows previously produced
`381f38fdab661e5dcfc5d754773d0b1144889b0cbedebd789afe5e4588f8328f`.

The unchanged command references SOV
`source-occurrence-version:be4ee11adbe0069435192b00e1ccd849bd66dfb6c0b24521a2997d6aaa1d987b:1`
through `source_references[0].source_occurrence_version_id`. The unchanged output ID is
`position-version:f96cddfd029030ef5cb5878d59260c5a4fc84470c937f26649af8700757fefd1:1`.

The first difference in the 884-byte semantic-hash preimage is UTF-8 byte
offset **176**, zero-based: authoritative `0xE4` starts the city 上海,
whereas Windows `0xE5` starts 广州. The authoritative canonical location order
is 上海, 广州; native zh-CN collation produced 广州, 上海.
The unqualified `localeCompare` in recruitment-context's canonical comparator
used the host locale. The forensic runtime was Node 24.19.0 / ICU 78.3.

The actual PositionVersion fields and ID were unchanged except for
`semantic_hash` and `integrity_hash`. Keys, timestamps, Unicode strings,
numbers, null/optional fields and factual location payloads were identical.
Neither filesystem paths nor CRLF/LF participate in this preimage. This is
canonical ordering drift, not a differing source fact.

The complete canonical PositionVersion payload is 2,514 UTF-8 bytes in both
environments. Its first difference is offset **205**: native `0x66` (`f`) versus
authoritative `0x36` (`6`) at the first character of `integrity_hash`. That is the
downstream digest symptom; offset 176 above identifies the underlying input
ordering difference rather than merely comparing digest strings.

Expected PositionVersion semantic hash:
`2cab6473bd09e1b95b553ba8e6b8d6455441cf10d2e2f2838617b1787a78ee60`.
Expected integrity seal:
`62c665e2cca478fc51f5d2d1e97f0e6ac7bd2aabeb063a908c7991c2158c636e`.
Before the fix, native semantic hash was
`72aa3b06a0eded4447059ebf9979035312f784b947d7550cb7e138849608c617`
and native integrity seal was
`f3ff1f39b2d386dc37da31ccf16d7685577908b5d6ecc1239c7d76384548971c`.

Forensic downstream execution without persistence showed matching PBOV and
PresentationDecision hashes at sequences 12 and 13, but ReadModel integrity
drift at sequence 14 due to upstream hashes. IDs remained stable. Normal
restoration correctly refused sequence 11; no integrity gate was bypassed.

## Minimal compatibility fix

Only recruitment-context's canonical comparator explicitly selects `en-US`.
This reproduces the existing Linux-authoritative bytes; it does not introduce
an ordinal sorting migration, change global locale, change identity semantics,
or weaken replay verification. Runtime Node/ICU remain pinned by the existing
deployment contract. A future ICU upgrade must separately verify byte compatibility.

## Regression contract

The regression reuses the committed production journal, Raw objects and
Source Registry, not ignored outputs or an additional recruiting fixture.
Each mode uses a local fresh Git clone and a separate child Process B:

- native Windows locale / Asia-Shanghai timezone;
- emulated zh-CN default collation / Asia-Shanghai timezone;
- emulated en-US default collation / UTC timezone.

Only the throwaway test child changes unspecified default collation. Explicit
locale arguments are preserved. No production runtime changes global locale.
Each child restores the first ten commands, executes sequence 11 through the
existing root, compares result hash, seals and canonical artifact bytes, then
restores all 26 committed commands without writes. All four decisions and
four ReadModels must exactly match their committed canonical bytes.

Native Linux/WSL is unavailable on this machine. The Linux-compatible mode is
an offline en-US simulation compared against the real committed Linux byte
oracle, **not** a claim of a newly executed native Linux runner.

The local working directory is long enough to hit Git for Windows' object-spec
path-length limitation with a full commit SHA. The tests therefore use short
temporary clone paths, rather than changing production persistence or trusting
uncommitted evidence. The temporary clones contain committed state only.

## Executed verification

Before the fix, native Windows and emulated zh-CN failed on the exact sequence
11 result hash; emulated en-US passed. After the single comparator change:

- Three fresh Process B modes: 3/3 PASS, each replaying all 26 commands and
  matching four decisions and four ReadModels byte-for-byte.
- Presentation / trusted restoration targeted regression: 39/39 PASS.
- P1: 170/170 PASS.
- Architecture / Network Guard: 35/35 PASS.
- TypeScript and `git diff --check`: PASS.
- One low-concurrency full offline regression, 110 test files: 1,076 total,
  1,075 PASS, one known baseline failure, zero new regressions, zero skipped
  or cancelled tests. Physical runner exit code is 1 solely for the baseline
  failure; it is not reported as an all-green runner exit.

The sole failure remains `production repository delegates SOV construction to
the shared materializer`, in
`tests/normalization/source-occurrence-materializer-parity.test.ts:434`.
It was not modified. Production Persistence and Scheduler tests, including
fresh Process B restoration, are included in this completed full run.
