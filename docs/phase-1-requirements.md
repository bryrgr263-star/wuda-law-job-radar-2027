# Phase 1 Requirement Facts and Evidence

P1-08 uses a deterministic, source-independent grammar to parse normalized OpportunityVersion requirement text into RequirementFact and RequirementEvidence records. It covers minimum education, bachelor/master/doctor major scope, unrestricted majors, explicit bachelor-law and bachelor-plus-master-law restrictions, legal professional qualification requirements, and OR alternatives among supported legal-program codes.

The parser requires normalized text produced by the normalization layer and never replaces the original Chinese text. Every Fact has one Evidence record with the exact original clause, normalized clause, character offsets, source-record locator, Snapshot ID, extractor version, and parser version.

Evidence source selection follows OpportunityVersion to its selected SourceOccurrenceVersion by semantic hash, then to ExtractedRecord and Snapshot. Adapter metadata is never read. Missing or ambiguous evidence produces warnings with original clause context instead of unsupported eligibility conclusions.

P1-08 does not implement CandidateProfile evaluation, EligibilityAssessment, lifecycle behavior, persistence, real-source access, or changes to P1-02 through P1-07 contracts.
