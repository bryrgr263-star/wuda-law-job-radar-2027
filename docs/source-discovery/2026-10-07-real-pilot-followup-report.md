# Bounded real Discovery follow-up

## Scope and result

The existing Discovery runtime selected the first eligible, unvisited ordinary-HTML seed from
the fixed historical pool at `5b7bd681bc6f0f29a55751c9bfe88f9dca23a573`: SD-025, the Chinese
Academy of Sciences National Science Library recruitment directory. The user did not supply a
new employer name. This reused the existing Discovery catalog, budget, cooldown and Admission
review boundary; it did not implement another crawler or production Source Registry.

- Exact directory: `https://las.cas.cn/edu/rczp/`.
- Run: `final-closure:useful-directory-pilot:SD-025:2026-10-07T13:16:29.556Z`.
- Scope revision: 2; one organization, one exact surface, one request; no child requests,
  redirects, retries, login, session, CAPTCHA handling or browser automation.
- Budget: 40 candidate clues, 1MiB response/total limit and 120-second run limit.
- HTTP result: 200 / SUCCESS / SENT.
- Actual response SHA-256: `8209394371009e293ee01538e30a48b68239b90a2e07e0094981cc3af43c81f1`.
- Scope hash: `7a9caeb5010dce391fe53744a978f1709c427402d50e324775d4a9fa2fe69017`.
- Isolated candidate commit: `ca1d364d3f21d87cdedab95fbade4866905bdda6`.
- Catalog hash: `1af4b6030b2fd89cd44d7f4458d277f93e9bcba9e308821f0a51c5b9699e1d0f`.
- Budget hash: `44ce0891b6989e857f093ad3b4ba7d87cd82d3da527b523c2c7bd6f563480b01`.

## Candidate quality, not production truth

The bounded window created 40 new untrusted candidate clues. It includes the official-looking
navigation labels `人事人才` (`https://las.cas.cn/edu/`) and `人才招聘`
(`https://las.cas.cn/edu/rczp/`). These clues are not 40 employers, verified recruitment sources,
2027 vacancies or public website jobs. Officiality remains UNRESOLVED; recruitment-year and legal
signals remain NOT_OBSERVED unless independently evidenced. Unknowns never imply exclusion.

No child URL was acquired, no Source was admitted, no Continuous Authorization was issued, no
Position or Presentation artifact was created, and no publication occurred. Public HTML was not
retained as RawBlob. Safe observations and separate evidence categories remain in the isolated
Discovery repository, not in production authoritative state.

## Restoration

A new independent Node process restored the fixed candidate commit through the existing
GitDiscoveryStore and DiscoveryRoot, without Process A memory or HTTP. It restored 362 immutable
records and 50 current untrusted candidates (the earlier 10 plus this window's 40). Catalog and
budget hashes matched; this run had exactly one SENT observation and restoration sent zero requests.

Evidence repository:
`C:\Users\HUAWEI\AppData\Local\Codex\discovery-pilots\2026-10-06-final-closure`.

This verifies the bounded real autonomous candidate Pilot, not scheduled Discovery deployment,
nationwide coverage, recruitment usefulness, 2027 legal-job discovery or production expansion.
Those claims require separate actual evidence; no trust upgrade is inferred from HTTP 200.
