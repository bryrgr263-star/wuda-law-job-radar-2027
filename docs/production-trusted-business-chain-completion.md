# Production trusted business-chain connection

## Run 1 diagnosis

The committed Run 1 journal has 26 commands: six SourceOccurrence commands,
and four each of Opportunity registration, PositionVersion, PBOV,
PresentationDecision and PresentationReadModel. There are no SourceComposition,
Relevance, Requirement, PredicateResolution, Eligibility or Candidate Evidence commands.

The existing production binding looked for a previously sealed SourceComposition
but never requested one. Its missing Relevance reference was therefore a wiring
omission, not an absent Relevance implementation. The authoritative composition
root already owns every downstream processor.

## Single-owner connection

`executeProductionTrustedChainBinding` now reuses a unique trusted composition,
or prepares an input and executes the existing `SOURCE_COMPOSITION_MATERIALIZE`
command. Multiple matching compositions fail closed rather than being selected
arbitrarily. The existing Relevance processor then runs against that sealed result.

`prepareProductionSourceCompositionInput` is input preparation only: it reads the
root's PBOV and SourceOccurrence resolvers and creates no registry, assessment,
RequirementFact, candidate evidence or trusted seal.

Captured position surfaces retain the exact source tuple and locator, with an
exact PBOV binding. Same-source, same-endpoint PACKAGE records are reference-only
and bound to their own source record; this is not proof that their requirements
apply to the position. Other endpoints and other position records are not attached.

Successful acquisition does not prove source-package closure, authority applicability
or effective-version selection. The prepared inventory stays `OPEN_UNRESOLVED`;
authority and version selection stay `UNRESOLVED`. Surface observation timestamps
anchor the captured evidence; they do not establish an authoritative effective
version. No discovery, conflict resolution or precedence assertion is fabricated.

## Safety gates

- RequirementProjection and RSV run only for a sealed `COMPLETE` composition.
- PredicateResolution requires `COMPLETE` RSV and a uniquely scoped trusted candidate
  evidence set already present in the root.
- Eligibility runs only after the existing predicate processor produces a resolution set.
- No candidate evidence is issued or inferred by this binding.
- PresentationDecision remains the sole display decision; ReadModel remains its projection.
- Existing incomplete/unknown/review semantics and all processors remain unchanged.

## Offline Run 1 verification contract

The regression uses the existing committed real artifacts, not a new real fixture.
It clones local Git state into a temporary repository, restores the original 26
commands, then appends commands through the same composition root. Its capture
repository is a test double used before committing the verified executions through
the existing Git append-only store. An independent child Process B then restores
the appended journal and compares canonical artifact bytes against their sealed envelopes.

Expected real-evidence safe stop: four unresolved compositions and four
`REVIEW_REQUIRED` Relevance assessments, followed by four revision-2
`EVIDENCE_BLOCKED` decisions and ReadModels. Requirement, predicates and Eligibility
remain unissued because source completeness is not proven. The former
`RELEVANCE_ASSESSMENT_MISSING` reason must disappear without making any positive
or negative eligibility claim.

All original journal commands, acquisition objects, Source/Admission/Authorization
state and Run 1 history remain unchanged. Appended real-evidence revisions exist
only in the temporary offline repository; they are not a new production run.
No website, workflow, network policy or Legacy business logic is changed.
