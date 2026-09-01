# Phase 1 Source Occurrence Identity and Versioning

P1-06 normalizes ExtractedRecord fields conservatively and creates source-local identities and content versions. It does not merge opportunities across sources.

Identity selection is ordered: Endpoint plus stable source record ID and recruitment cycle; otherwise Endpoint plus normalized announcement URL; otherwise Endpoint plus normalized organization, title, structured location array, and recruitment batch. The selected basis is stored beside the independent identity hash.

Semantic hashes use normalized recruitment content only: organization, title, year, batch, structured locations, description, requirements, publication date, deadline, announcement locator, and application locator. Snapshot IDs, extraction times, request data, page positions, lifecycle state, and adapter metadata are excluded.

Normalization uses UTF-8-preserving source text, Unicode NFKC, width and punctuation folding, whitespace stabilization, deterministic URL ordering, and a minimal municipality alias set. It performs no legal-major equivalence, requirement interpretation, eligibility assessment, or other semantic inference.
