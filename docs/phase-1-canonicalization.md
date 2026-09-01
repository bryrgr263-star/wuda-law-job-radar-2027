# Phase 1 Conservative Canonicalization

P1-07 groups source-local opportunity versions into CanonicalOpportunity records only when the employer Organization resolves unambiguously and normalized title, recruitment year, recruitment batch, and location set agree. Conflicting publication or deadline dates also prevent merging.

The resolver is intentionally conservative. Missing identity evidence, ambiguous Organization aliases, or any required-field conflict keeps records separate. It performs no fuzzy cross-source matching.

Each merge or separation decision records source occurrence version references, reason codes, the resolver version, and the resolved Organization when available. Canonical content is selected by source authority in the order OFFICIAL, AUTHORIZED, THIRD_PARTY, UNKNOWN.

P1-07 creates no lifecycle events, requirement facts, eligibility assessments, persistence writes, or network requests. It does not read Adapter metadata and does not modify source normalization or identity behavior.
