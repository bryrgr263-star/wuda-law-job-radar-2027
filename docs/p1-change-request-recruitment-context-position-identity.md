# P1 Change Request — Recruitment Context & Position Identity

## Status

`IMPLEMENTED / VERIFIED`

This Change Request has intentionally not been assigned a sequence number. Human approval authorizes implementation only within the exact boundaries, file areas, controls, exclusions, and safety gates recorded below. It does not authorize Requirement or Eligibility semantic changes, P2 changes, Canary changes, network access, real data creation, or a git commit.

## 1. Objective

This CR defines the minimum recruitment-context and position-identity boundary required before nationwide expansion.

Its purpose is to ensure that every assessable recruitment opportunity can be traced to the correct:

1. official Announcement;
2. Recruitment Plan;
3. Recruitment Batch;
4. Position;
5. recruiting and employing organizations;
6. recruitment context and source evidence.

The principal safety requirement is:

> A Requirement Set must never be attached to a Position or Opportunity merely because an announcement URL, title, year, batch label, organization name, or location appears similar.

This CR does not attempt to build a general entity-resolution system. When identity evidence is insufficient, the safe result is a provisional, separately preserved object plus review—not an automatic merge or product exclusion.

## 2. Highest-Level Business Invariants

### 2.1 Recall First / No False Exclusion

Identity, source, status, or Requirement uncertainty must not:

- be replaced with an invented default;
- be resolved through title, URL, location, organization-name, or keyword similarity;
- cause two records to be merged automatically;
- cause an Opportunity to be treated as nonexistent;
- produce Eligibility `NOT_MATCH`;
- remove a potentially applicable Opportunity from the product candidate pool.

`NOT_ALLOWED` means only that the Eligibility gate may not produce an assessment from the current Requirement Set. It does not mean that the Opportunity is irrelevant, invalid, closed, or unsuitable for the candidate.

### 2.2 False Merge Is More Harmful Than False Split

When any identity-bearing context is unresolved, canonicalization must prefer separation.

Examples include:

- a missing official position code;
- an unresolved Recruitment Plan or Batch;
- an unresolved recruiting or employing entity;
- multiple same-title rows in one announcement;
- a shared announcement URL;
- a correction whose target cannot be proven.

A false split may later be reconciled through explicit evidence. A false merge can combine incompatible Requirements and produce unsupported Eligibility outcomes.

### 2.3 Permanent Requirement-Inference Prohibitions

The following must never create a Requirement Fact:

- job title such as `法务` or `法律顾问`;
- duties such as contract review, litigation, compliance, or risk control;
- organization type such as court, law firm, government body, or state-owned enterprise;
- historical successful applicants or proposed-hire notices;
- a CandidateProfile value;
- a third-party platform taxonomy or rewritten description.

Requirements must originate from identified Requirement-bearing source evidence.

## 3. Bounded Recruitment Object Chain

The target chain is:

```text
SourceDefinition / RecruitmentEndpoint
  -> Snapshot / Raw / ExtractedRecord / SourceOccurrenceVersion
  -> Announcement / AnnouncementVersion
  -> RecruitmentPlan
  -> RecruitmentBatch
  -> Position / PositionVersion
  -> Opportunity / OpportunityVersion
  -> RequirementSet
  -> CandidateProfile
  -> EligibilityAssessment
```

The chain does not mean that every source publishes every level explicitly. Missing levels remain unresolved references; they are not replaced with synthetic values such as `DEFAULT_BATCH` or `UNKNOWN_PLAN` and then treated as confirmed identity.

## 4. Core Object Boundaries

### 4.1 Announcement

An `Announcement` represents one official publication artifact, not a job opportunity.

Its minimum boundary must preserve:

- a stable internal Announcement identity;
- publisher Organization reference in the `PUBLISHER` role;
- official document identifier when explicitly available;
- original and subsequently observed locators as provenance, not sole canonical identity;
- publication date as an observed, versioned attribute;
- immutable Announcement versions;
- SourceOccurrenceVersion, Snapshot, and locator evidence;
- explicit correction, supplement, replacement, superseding, cancellation, and reinstatement relations.

Announcement identity evidence is ranked as follows:

1. explicit official document or announcement identifier within a publisher namespace;
2. explicit stable source record identifier within the publisher source;
3. an evidence-backed official relation to an existing Announcement;
4. otherwise, a source-local provisional Announcement identity.

An URL alone may identify a source occurrence or locator. It is not sufficient to establish a canonical Announcement identity across observations or sources.

One Announcement may refer to zero, one, or many Recruitment Plans, Batches, Positions, and Opportunities. It may also contain only a correction, procedure, result, or reference document.

### 4.2 Recruitment Plan

A `RecruitmentPlan` represents a stable recruitment activity or project context.

Its minimum boundary must preserve:

- internal Plan identity;
- official plan/project identifier when available;
- recruiting entity reference;
- recruitment year or cycle as an attribute and identity signal, not a sufficient identity by itself;
- official project name and its raw Evidence;
- relationships to all Announcements that establish, modify, or reference the Plan;
- an explicit identity state: `CONFIRMED`, `PROVISIONAL`, or `UNRESOLVED`.

Labels such as `2027校招`, `2027年度招聘`, and `2027招聘计划` must not be automatically treated as the same Plan. Conversely, wording differences alone must not prove that they are different Plans.

When no official Plan identity can be established, a source-local provisional Plan may preserve the observed context, but it must not be automatically merged across announcements.

Recruitment Plan is an important Position context, but a confirmed Plan identity is not an unconditional prerequisite for preserving a Position or Opportunity. If the official source identifies a position row or source record but does not establish a Plan identity, the system may create a source-local provisional Position with an explicitly `UNRESOLVED` Plan reference. The missing Plan must not cause that Position or its Opportunity to be discarded, hidden, or treated as nonexistent.

The system must not manufacture `DEFAULT_PLAN`, an empty confirmed Plan, or any equivalent sentinel that could later participate in identity matching. A provisional Position may be reconciled with a confirmed Plan only through explicit, traceable Evidence and a versioned reconciliation decision.

### 4.3 Recruitment Batch

A `RecruitmentBatch` represents a batch, cycle, intake, supplementary intake, or explicitly separated recruitment segment within a Recruitment Plan.

Its minimum boundary must preserve:

- internal Batch identity;
- parent Recruitment Plan identity;
- official batch code when available;
- raw and normalized batch label;
- batch kind when explicitly stated, such as ordinary batch, supplementary intake, or special recruitment;
- Announcement Evidence establishing the Batch;
- an identity state: `CONFIRMED`, `PROVISIONAL`, or `UNRESOLVED`.

`FIRST_BATCH`, `SECOND_BATCH`, `SUPPLEMENTARY`, and `SPECIAL` are classifications only when the source explicitly establishes them. The parser must preserve other wording without forcing it into those classifications.

An unresolved Batch is not equivalent to a default Batch and is never a wildcard for merging.

The same Position appearing in different confirmed Batches produces distinct Opportunities unless an official relation explicitly states that one occurrence corrects or replaces another.

### 4.4 Position

A `Position` represents a concrete position definition observed in a recruitment context. It is not identified by title alone. A confirmed Recruitment Plan normally supplies important identity context, but the absence of a confirmed Plan does not prevent preservation of a source-local provisional Position.

The minimum Position boundary must preserve:

- internal Position identity;
- parent Recruitment Plan identity when established, otherwise an explicit unresolved Plan reference;
- official position code and its namespace when available;
- official source-row or record identifier when available;
- raw and normalized position title;
- recruiting and employing Organization role assignments;
- position-level location references;
- links to observations of headcount, recruitment population, and Requirement-bearing surfaces;
- immutable Position versions and their Evidence;
- an identity state: `CONFIRMED`, `PROVISIONAL`, or `UNRESOLVED`.

An official position code is strong identity evidence only inside its proven namespace, normally the relevant Recruitment Plan, Batch, publisher, or official table. Code equality across unrelated plans or publishers does not establish Position equality.

If no position code exists, the exact official row or source record may create a source-local provisional Position. A provisional Position is not automatically merged across URLs, attachments, announcements, or sources.

If no Recruitment Plan identity exists, the same exact official row or source record may still create a source-local provisional Position and corresponding provisional Opportunity. `Plan = UNRESOLVED` is preserved as uncertainty; it is not a deletion condition, a merge wildcard, or a candidate-exclusion signal.

If an official correction changes a position code but explicitly states that it corrects the same Position, the system preserves the old code as historical Evidence and records the relation. Without that evidence, different codes remain separate.

### 4.5 Opportunity

An `Opportunity` represents one concrete recruitment instance that can be assessed independently for candidate eligibility.

Conceptually:

```text
Position
+ Recruitment Plan
+ Recruitment Batch when applicable
+ explicitly differentiated recruitment context
= Opportunity
```

A Position may correspond to multiple Opportunities, including:

- the same Position in first and second batches;
- ordinary recruitment and supplementary intake;
- explicitly separate location-coded openings;
- explicitly separate recruitment-population or quota rows.

An Opportunity must not be created merely by treating an Announcement as a job. It must reference a Position or an explicitly provisional Position observation.

A confirmed Recruitment Plan is not required before a provisional Opportunity can be retained. When the Plan is unresolved, the Opportunity remains source-local and ineligible for automatic cross-announcement merge until explicit Evidence establishes a Plan relation.

The preferred Opportunity identity basis is:

1. an explicit official opportunity/opening identifier;
2. confirmed Position identity plus confirmed Plan and Batch context and any official variant identifier;
3. otherwise, a source-local provisional Opportunity tied to an exact source record or row.

The following are never sufficient Opportunity identity by themselves:

- title;
- URL;
- announcement title;
- year;
- free-text batch label;
- organization display name;
- location string;
- Requirement text;
- headcount.

Unknown identity inputs do not behave as matching wildcards.

### 4.6 PositionVersion and OpportunityVersion

`PositionVersion` records changes to the official position definition, including corrected title, code, organization-role assignments, location declarations, and position-scoped source references.

`OpportunityVersion` records the effective recruitment instance state, including Batch context, application window, status observations, headcount observation, recruitment-population references, and the Requirement Set applicable to that version.

A change to headcount, deadline, status, Requirement content, or normalized descriptive text normally creates a new version, not a new identity.

A new Batch normally creates a new Opportunity for the same Position. An explicit split, merge, replacement, or code reassignment requires official relation Evidence and cannot be inferred from changed values alone.

## 5. Organization Role Boundary

This CR does not create a general organization knowledge graph. It freezes only the minimum roles:

- `PUBLISHER`: publishes the Announcement;
- `RECRUITING_ENTITY`: conducts or owns the recruitment process;
- `EMPLOYER_ENTITY`: is the stated employing or labor entity.

The same Organization may occupy multiple roles only when stable Organization identity or explicit Evidence proves it. Name similarity does not prove role identity.

The minimum hierarchy hook supports a stable parent Organization reference and an evidence-backed relationship kind such as subsidiary, branch, group member, or unresolved. It does not authorize automatic group reconstruction.

Unknown recruiting or employing entity identity preserves the Opportunity and triggers review. It does not cause product exclusion or automatic merging with the publisher.

## 6. Location Role Boundary

Location requires two separate axes.

### 6.1 Location Role

- `EMPLOYER_LOCATION`
- `WORK_LOCATION`
- `APPLICATION_LOCATION`
- `ASSIGNMENT_LOCATION`
- `UNKNOWN`

### 6.2 Location Assignment Mode

- `SINGLE`
- `MULTI_LOCATION`
- `ANY_OF`
- `ALL_LISTED`
- `TO_BE_ASSIGNED`
- `UNRESTRICTED`
- `UNKNOWN`

`MULTI_LOCATION` is intentionally an assignment/cardinality mode rather than a semantic role. Treating it as a role would fail to distinguish multiple workplaces from multiple application locations.

Location participates in identity only when official evidence establishes separate position or opportunity variants, such as different official position codes or distinct source rows. It must not be applied as a universal identity component.

Examples:

- `北京/上海均可` may describe one multi-location Opportunity;
- `北京岗位001` and `上海岗位002` are distinct Positions because official row/code context differentiates them;
- a publisher address in Beijing does not prove a Beijing work location;
- employer and work locations differing is not an identity conflict.

## 7. Headcount Observation

Headcount is a versioned observation, never a Position identity key.

The minimum observation states are:

- `EXACT`: an explicit non-negative integer is observed;
- `SEVERAL`: wording such as `若干` is observed without a count;
- `UNKNOWN`: a headcount-bearing source exists but its value cannot be resolved safely;
- `NOT_OBSERVED`: no headcount value was observed at the expected location.

The design reserves the following states to avoid later identity redesign, but they need not be parsed automatically in the first implementation:

- `WITHHELD`: the source explicitly says the number is not published;
- `SHARED_QUOTA`: multiple Positions share one explicitly identified quota;
- `NOT_APPLICABLE`: the source explicitly establishes that fixed headcount does not apply.

Every Headcount Observation preserves:

- original text;
- normalized count only for `EXACT`;
- Evidence reference;
- Snapshot and source locator;
- observation/parser version;
- optional shared-quota reference when explicitly established.

Permanent prohibitions:

```text
missing headcount != 0
SEVERAL != any invented integer
UNKNOWN != 0
shared quota != duplicated quota for each Position
```

## 8. Recruitment Population Reference

Recruitment Population is not identical to a Requirement.

An Opportunity-level population reference records whom the recruitment activity is presented as targeting. A Requirement condition separately records the exact candidate facts required for eligibility.

The minimum reference preserves:

- raw source text;
- optional broad source-backed classification;
- reference date or recruitment cycle when stated;
- source Evidence and locator;
- state: `CONFIRMED`, `OPEN`, `UNRESOLVED`, or `NOT_OBSERVED`;
- links to any corresponding Requirement Observations without duplicating them as asserted Facts.

The initial vocabulary may recognize only explicitly stated broad forms such as fresh graduate, social recruitment, specified graduation year, overseas returnee, special recruitment, or unrestricted population. Wording involving selection periods, unemployment, unassigned employment units, in-service status, directed training, commissioned training, service periods, or agreements must remain raw and unresolved until separately approved Requirement semantics exist.

An Opportunity population label cannot by itself produce Candidate `MATCH` or `NOT_MATCH`.

## 9. Announcement Revision and Status Relations

The source relationship vocabulary is:

- `ORIGINAL`
- `CORRECTION`
- `SUPPLEMENT`
- `REPLACEMENT`
- `SUPERSEDING`
- `CANCELLED`
- `REINSTATED`

Each relation must preserve:

- source AnnouncementVersion;
- target Announcement, Plan, Batch, Position, Opportunity, or unresolved target;
- affected scope when explicitly stated;
- effective date when explicitly stated;
- Evidence and locator;
- certainty: `EXPLICIT`, `CORROBORATED`, or `UNRESOLVED`;
- relation parser/resolver version.

Rules:

1. No relation is inferred from similar titles, later dates, URL patterns, or search ordering.
2. A correction or supplement does not delete original Evidence.
3. A replacement or superseding relation changes effective selection only when official Evidence establishes it.
4. A cancellation or reinstatement is an observed status action, not a deadline-derived state.
5. An unresolved target leaves all implicated objects preserved and marks current-effective selection for review.
6. A correction must identify the affected scope before an old Requirement can be replaced for Eligibility.

## 10. Identity Evidence, Aliases, and Uncertainty

Every canonical identity decision must be auditable through an Identity Evidence record containing:

- identity-basis kind;
- source object and exact observed value;
- SourceOccurrenceVersion and Snapshot references;
- source locator;
- resolver version;
- certainty;
- whether the evidence supports separation, candidate merge, confirmed merge, correction, split, or aliasing.

Minimum certainty states:

- `EXPLICIT`: the official source states the identifier or relationship;
- `CORROBORATED`: multiple authoritative observations prove the same relation without conflict;
- `PROVISIONAL`: enough evidence exists to preserve a source-local object but not to merge it;
- `UNRESOLVED`: the source context cannot safely establish identity.

Aliases preserve prior official codes, URLs, source keys, or labels. An alias is provenance, not automatic equivalence. Alias creation requires Evidence and cannot be based on lexical similarity alone.

`MERGE_CANDIDATE` and `SPLIT_CANDIDATE` are review states, not completed canonicalization operations.

## 11. Canonical Identity Safety Boundary

The current combination:

```text
organization + title + recruitment_year + recruitment_batch + locations
```

is useful as a comparison signal but is not a sufficient nationwide Opportunity identity.

Future canonicalization must obey:

1. default outcome is separation;
2. title, URL, year, batch label, and location similarity may create a review candidate only;
3. an unresolved value never equals another unresolved value for merge purposes;
4. different official Position codes remain separate unless explicit correction/reassignment Evidence says otherwise;
5. the same Position in different confirmed Batches forms different Opportunities;
6. same official Position code across unrelated Plan or publisher namespaces does not establish equality;
7. shared announcement URL does not establish equality;
8. an official correction may create a new version only after its target is resolved;
9. conflicting identity Evidence blocks merge;
10. every confirmed merge or split preserves all source occurrences and the resolver decision history.

SourceOccurrence identity remains source-local. Canonical Position and Opportunity identity remain cross-source business identity. Neither may be substituted for the other.

## 12. Requirement Binding Boundary

Requirement identity and Opportunity identity are independent.

The binding chain is:

```text
RequirementSet
  -> OpportunityVersion
  -> Opportunity
  -> Position / PositionVersion
  -> RecruitmentBatch
  -> RecruitmentPlan
```

Every future complete Requirement Set must validate this context before Eligibility.

Requirement-bearing scope rules:

- an Announcement-level uniform condition may apply across multiple Opportunities only when its scope is explicitly established;
- a job-table row applies only to the Position/Opportunity identified by that row;
- a shared Announcement URL does not establish shared Requirement scope;
- a correction applies only to its proven target scope;
- a shared professional directory is a reference source and does not become a Position Requirement by itself;
- source wording such as `具体岗位要求详见附件` makes the referenced attachment an expected requirement-bearing surface;
- a missing attachment preserves the Opportunity but blocks Requirement completeness;
- no Requirement Set may be copied to every Position merely because the Positions share an Announcement.

An Announcement-level uniform Requirement may legitimately bind to multiple Positions, but only when Evidence establishes the relevant Plan, Batch, Position set, or equivalent official scope. If its applicability scope cannot be resolved, the Announcement-level clause remains an unresolved or review-blocking Observation. It must not be expanded to all Positions by default.

A job-table row Requirement is row-scoped by default and belongs only to the Position and Opportunity established by that row. Cross-row or cross-Position application requires separate explicit Evidence. Requirement uncertainty blocks completeness or evaluation as appropriate; it does not remove or exclude the affected Opportunity.

When Opportunity or Position context changes through a correction, the effective Requirement Set must be re-composed for the new OpportunityVersion. Existing Requirement Sets and Evidence remain immutable historical records.

## 13. Future Requirement Source-Surface Hook

This CR does not implement the future Requirement Source-Surface Composition manifest. It reserves stable references so that a later CR can relate:

- announcement;
- position table;
- attachment;
- professional directory;
- correction;
- supplement;
- replacement.

The future relationship vocabulary must support:

- `PRIMARY`
- `SUPPLEMENT`
- `REFERENCE`
- `OVERRIDE`
- `CORRECTION`
- `SUPERSEDES`
- `CONFLICT`

This CR only ensures that every surface can identify its Announcement, Plan, Batch, Position, and Opportunity target without using Adapter-specific metadata.

## 14. Domain Boundary Matrix

| Object | Owns | Does Not Own | Identity State | Version Boundary | In This CR |
|---|---|---|---|---|---|
| SourceDefinition | Publisher source and authority | Announcement or job identity | Existing | Existing | Referenced only |
| RecruitmentEndpoint | Collection locator/configuration | Opportunity identity | Existing | Existing | Referenced only |
| Snapshot / Raw | Exact transport observation | Business-object identity | Existing | Append-only observation | Unchanged |
| SourceOccurrence | Source-local observed record | Canonical Position/Opportunity identity | Existing source-local | Existing revisions | Boundary clarified |
| Announcement | Official publication artifact | Position or Opportunity semantics | Confirmed/provisional/unresolved | AnnouncementVersion | Designed |
| RecruitmentPlan | Recruitment activity context | Batch or Position Requirements | Confirmed/provisional/unresolved | New version only for corrected plan attributes | Designed |
| RecruitmentBatch | Plan subdivision/intake | Durable Position identity | Confirmed/provisional/unresolved | Corrected label/classification | Designed |
| Position | Official position definition | One specific application window by itself | Confirmed/provisional/unresolved | PositionVersion | Designed |
| Opportunity | One independently assessable recruitment instance | Source URL or Announcement identity | Confirmed/provisional/unresolved | OpportunityVersion | Redesigned boundary |
| OrganizationRoleAssignment | Publisher/recruiter/employer role | Organization name equivalence | Evidence-backed/unresolved | Versioned with owning object | Designed |
| LocationAssignment | Location role and assignment mode | Universal identity key | Evidence-backed/unresolved | Versioned attribute | Designed |
| HeadcountObservation | Observed quota state/value | Position identity | Observed/unresolved/not observed | Versioned attribute | Designed |
| RecruitmentPopulationReference | Opportunity audience context | Automatic Eligibility predicate | Confirmed/open/unresolved/not observed | Versioned attribute | Designed |
| RequirementSet | Evidence-backed qualification conditions | Opportunity discovery or identity resolution | Existing completeness states | Immutable per OpportunityVersion | Binding clarified |
| CandidateProfile | Candidate facts | Source or Opportunity semantics | Existing | Future profile versioning | Unchanged |
| EligibilityAssessment | Complete-set candidate evaluation | Recommendation or product filtering | Existing gate | Immutable assessment | Unchanged |

## 15. Identity Boundary Matrix

| Object | Strong Identity Evidence | Insufficient by Itself | Versioned Attributes | Conservative Fallback |
|---|---|---|---|---|
| Announcement | Official document ID plus publisher namespace; explicit official relation | URL, title, publish date | locator, title, publication metadata, content | Source-local provisional Announcement |
| RecruitmentPlan | Official plan/project ID; explicit source relation | year, `校招`, project-name similarity | name, cycle labels, status | Provisional Plan scoped to source evidence |
| RecruitmentBatch | Plan ID plus official batch code/explicit relation | `第一批` text without Plan context | label, kind, schedule, status | Unresolved or provisional Batch; no wildcard merge |
| Position | Position code within proven namespace; exact official row ID | title, duties, organization name, location | corrected name/code, role assignments, location declarations | Source-local provisional Position per exact row |
| Opportunity | Position plus Plan/Batch and official variant identity | title/location/year/batch hash, URL, Requirement text | headcount, dates, status, Requirement Set, population | Source-local provisional Opportunity |
| Organization | Stable Organization ID and explicit hierarchy/role evidence | same or similar name | aliases, parent relation, role assignment | Keep separate/unresolved |
| Location Assignment | Explicit role and official variant context | location string alone | normalized geography, role, assignment mode | Preserve raw value and UNKNOWN role |
| Requirement Binding | Exact OpportunityVersion and target-scope Evidence | shared Announcement membership | effective Requirement Set and source relations | Block completeness; preserve Opportunity |

## 16. False Merge / False Split Controls

All controls are synthetic design controls. No test or production data is created by this document.

| Control | Scenario | Required Identity Result | Requirement/Eligibility Safety Result |
|---|---|---|---|
| A | One Announcement contains Position 001 and Position 002, both named `法务岗` | Two Positions and two Opportunities; code/row identity wins | Requirements remain row-scoped |
| B | Same Position appears in 2027 first and second batches | One Position may be referenced by two distinct Opportunities | Each Batch receives its own effective Requirement Set |
| C | Same Announcement contains Beijing Position 001 and Shanghai Position 002 | Separate Positions/Opportunities | Title similarity cannot merge them |
| D | Same title, year, Batch, location, and organization but different official Position codes | Keep separate | No Requirement mixing |
| E | Announcement content is corrected while Position code remains stable | Preserve Announcement/Position lineage and create appropriate versions | Re-compose current Requirement; retain historical Evidence |
| F | Multiple Positions share one Announcement URL | URL remains locator only | One URL cannot create one shared Opportunity identity |
| G | Publisher is a group and Employer is a subsidiary | Preserve distinct PUBLISHER, RECRUITING_ENTITY, and EMPLOYER_ENTITY assignments | No organization-name inference |
| H | Employer location differs from work location | No identity conflict solely from the difference | Work location remains correctly scoped |
| I | Headcount changes from `若干` to `3人` | Same Position/Opportunity identity unless other official context changes; new version | Old and new Headcount Evidence retained |
| J | Announcement says `具体岗位要求详见附件`, attachment missing | Preserve provisional Positions/Opportunities | Requirement not COMPLETE; Eligibility NOT_ALLOWED; no NOT_MATCH |
| K | Correction changes major requirement from `法学、法律` to `法学` | Resolve correction target and retain one lineage | Current Requirement uses correction; old Evidence remains historical |
| L | Official Announcement and third-party repost describe the same job | Official remains authoritative; third-party is discovery/supplement only | Third-party cannot override or complete official Requirement |

Additional canonicalization invariants:

- repeated capture of the same source record creates a new SourceOccurrenceVersion only when semantic content changes;
- an URL change alone creates no confirmed canonical merge and no confirmed split;
- a later explicit alias or correction may reconcile provisional records without deleting their history;
- a source record later found to contain multiple Positions becomes a `SPLIT_CANDIDATE`; it is not silently rewritten;
- transitive merging is forbidden when any pair in the proposed group has conflicting identity Evidence.

## 17. False Negative Safety Matrix

| Scenario | May Still Be Applicable | Automatic Exclusion Allowed | Correct Handling |
|---|---:|---:|---|
| Position identity unresolved | Yes | No | Preserve separate provisional Opportunity / REVIEW |
| Recruitment Plan identity unresolved | Yes | No | Preserve source-local provisional Position/Opportunity; no `DEFAULT_PLAN` |
| Batch unresolved | Yes | No | Preserve / UNKNOWN; do not use a default Batch |
| Employing entity unresolved | Yes | No | Preserve / REVIEW |
| Work location unresolved | Yes | No | Preserve raw location / UNKNOWN role |
| Position code missing | Yes | No | Preserve exact row identity; never invent a code |
| Referenced attachment not acquired | Yes | No | Requirement not COMPLETE; Opportunity retained |
| Correction relation unresolved | Yes | No | Preserve all Evidence; effective version REVIEW_REQUIRED |
| Requirement sources conflict | Yes | No | CONFLICT / REVIEW_REQUIRED |
| Major expression broad or open | Yes | No | COMPLETE+unknown relation -> INSUFFICIENT; otherwise REVIEW_REQUIRED |
| Candidate data missing | Yes | No | UNKNOWN / INSUFFICIENT after a COMPLETE Requirement Set |
| Requirement Set REVIEW_REQUIRED | Yes | No | Eligibility NOT_ALLOWED; retain Opportunity |
| Opportunity status is derived only from date | Yes | No | Derived status kept separate; no official CLOSED assertion |
| Third-party source is more detailed than official source | Yes | No | Discovery/supplement only; cannot become authoritative Requirement |
| Explicit, complete, applicable exclusion Requirement is proven false for the Candidate | No for that Requirement path | Yes | Eligibility may produce NOT_MATCH only after COMPLETE gate |

The permanent rule is:

> Failure to prove that a candidate matches is not proof that the candidate does not match.

## 18. `NOT_ALLOWED` Product Semantics

`NOT_ALLOWED` is an Eligibility execution-gate state.

It means:

> The current Requirement Set is not sufficiently complete and resolved for the Eligibility Engine to create an assessment.

It does not mean:

- `NOT_MATCH`;
- Opportunity cancelled;
- Opportunity expired;
- Opportunity invalid;
- candidate should not apply;
- Opportunity should be hidden, deleted, or removed from discovery.

Unless a blocker-free COMPLETE Requirement Set and complete Candidate evidence establish a failed mandatory condition, product exclusion based on Eligibility is prohibited.

This CR defines no Recommendation, ranking, scoring, or display-priority behavior.

The following state distinctions are mandatory:

| Domain State | Meaning | Product Candidate-Pool Effect |
|---|---|---|
| `Identity = UNRESOLVED` | The exact business identity or parent context is not proven | Preserve the source-local provisional Opportunity; no automatic exclusion |
| `Requirement = INCOMPLETE` | Required evidence or an expected surface is missing | Eligibility execution is blocked; Opportunity remains retained |
| `Requirement = REVIEW_REQUIRED` | Evidence exists but semantics, conflict, scope, or Domain coverage is unresolved | Eligibility execution is blocked; Opportunity remains retained |
| `Eligibility = NOT_ALLOWED` | The completeness/input gate does not permit an assessment | Not a candidate failure and not a product exclusion signal |
| `Eligibility = INSUFFICIENT` | A complete Requirement was evaluated but Candidate-to-condition evidence cannot prove match or non-match | Preserve; no automatic exclusion |
| Predicate or projected state `UNKNOWN` | Available data cannot establish true or false | Preserve; no automatic exclusion |

The following product flow is permanently prohibited:

```text
system does not know
  -> NOT_ALLOWED
  -> front end hides or deletes the Opportunity
```

Only a blocker-free, complete, traceable Requirement Set evaluated against sufficiently complete Candidate data may establish `NOT_MATCH`. Even then, this CR merely permits a future product layer to consider Eligibility-based exclusion; it does not implement that product policy.

## 19. Dependencies and Ownership

### 19.1 CR#11

CR#11 owns what a recruitment-major expression means and what evidence can establish a candidate-to-major relationship.

This CR owns which Position and Opportunity that Requirement belongs to.

Neither CR may infer the other's semantics.

### 19.2 Future CR#12

CR#12 owns how already identified Requirement predicates combine through AND, OR, NOT, modality, and conditional applicability.

This CR must be implemented before CR#12 is used for nationwide Requirements because a correct logic tree attached to the wrong Position remains unsafe.

### 19.3 Future Requirement Source-Surface Composition

That future CR owns:

- the authoritative manifest of Requirement-bearing surfaces;
- surface roles and precedence;
- correction and override application to Requirement content;
- missing-surface and source-conflict blockers;
- protection against callers omitting unfavorable surfaces.

This CR provides only the target identities and relation hooks required by that composition.

### 19.4 Eligibility

Eligibility remains unchanged and continues to accept only blocker-free COMPLETE Requirement Sets. Opportunity identity uncertainty must be resolved before a COMPLETE Requirement Set is supplied; it must never be projected as candidate failure.

### 19.5 Recommended Sequence

```text
CR#11 implementation
  -> Recruitment Context & Position Identity implementation
  -> CR#12 implementation
  -> Requirement Source-Surface Composition
  -> controlled real Eligibility validation
```

## 20. Current Implementation Impact Assessment

The approved implementation affects only the following boundaries:

1. Domain primitive IDs for Announcement, Plan, Batch, Position, and their versions;
2. Opportunity Domain contracts and organization/location role references;
3. Source-record normalization and SourceOccurrence identity selection;
4. canonicalization candidate, decision, merge, split, and version contracts;
5. in-memory immutable Opportunity version tracking;
6. architecture and identity tests.

The implemented file area is:

- `lib/ingestion/domain/primitives.ts`;
- `lib/ingestion/domain/recruitment-context.ts`;
- `lib/ingestion/domain/source.ts`;
- `lib/ingestion/domain/opportunity.ts`;
- `lib/ingestion/domain/raw.ts`;
- `lib/ingestion/domain/index.ts`;
- `lib/ingestion/normalization/source-record-normalizer.ts`;
- `lib/ingestion/normalization/source-occurrence-tracker.ts`;
- `lib/ingestion/canonicalization/types.ts`;
- `lib/ingestion/canonicalization/conservative-canonicalizer.ts`;
- `lib/ingestion/canonicalization/opportunity-version-tracker.ts`;
- `lib/ingestion/canonicalization/index.ts`;
- `tests/canonicalization/recruitment-context-position-identity.test.ts`;
- this Change Request document.

Shadow persistence, migration, and repository contracts were not modified. Persisting or backfilling the new standalone recruitment-context objects remains subject to a separate approval.

No Requirement parser, Eligibility Engine, P2, Canary, API, Web, Scheduler, Admission, production database, Supabase, third-party integration, or real-data file is included.

Implemented compatibility rules:

- existing SourceOccurrence and Opportunity records remain readable under their original resolver version;
- existing `recruitment_batch`, `locations`, title, and organization text remain preserved as legacy observations and are not silently promoted to confirmed identity;
- existing Opportunity IDs are not rewritten in place;
- reconciliation produces explicit aliases/relations or new versioned identities;
- existing Requirement Sets and Eligibility Assessments remain immutable historical outputs;
- P2 Canary outputs are not reinterpreted or mutated automatically.

### 20.1 Legacy Identity Migration Boundary

Legacy Opportunity IDs must never be rewritten in place. Historical SourceOccurrences, OpportunityVersions, Requirement Sets, and Eligibility Assessments must retain their original identifiers, resolver/parser/engine versions, and provenance.

A new identity resolver may relate legacy and strengthened identities only through:

- evidence-backed aliases;
- explicit reconciliation records;
- explicit merge, split, correction, replacement, or superseding relations;
- new immutable versions or identities that preserve links to the legacy records.

Destructive migration must not rewrite historical Requirement Set bindings or EligibilityAssessment inputs. If a legacy identity cannot be reconciled safely, it remains preserved and is marked unresolved or review-required rather than being guessed, overwritten, or deleted.

Any migration that persists, backfills, aliases, reconciles, merges, or splits legacy identities requires a separate Change Request, an exact migration boundary, rollback/non-destruction guarantees, and dedicated tests. This design document does not authorize that migration.

## 21. Risks and Unresolved Questions

| Issue | Risk | Required Resolution Before Implementation |
|---|---|---|
| Plan versus Batch distinction varies by publisher | HIGH | Freeze evidence-based fallback and unresolved state |
| Position code namespace may be undocumented or reused | BLOCKING | Require Plan/publisher/table scope and prohibit global code equality |
| Announcement lacks official stable ID | HIGH | Use source-local provisional identity; prohibit URL-only canonical merge |
| One row contains multiple locations or populations | HIGH | Preserve assignment mode and official row context |
| Correction changes code and title simultaneously | HIGH | Require explicit target relation before versioning/merging |
| Shared headcount across Positions | MEDIUM | Preserve quota-group hook; no duplicated exact counts |
| Group and subsidiary names are ambiguous | HIGH | Explicit Organization role/reference Evidence; no name-only merge |
| Same Position appears across Plans | HIGH | Decide whether durable enterprise Position identity is needed later; current Position remains Plan-scoped |
| Legacy canonical IDs were built from insufficient fields | HIGH | Define non-destructive migration/alias strategy before implementation |
| Requirement Set may already reference legacy OpportunityVersion | HIGH | Preserve history; only new parser/resolver versions use strengthened context |
| Current-effective Announcement cannot be selected | BLOCKING | Preserve REVIEW state until correction/supersede Evidence resolves it |

The following remains deliberately unresolved and outside this CR:

- a nationwide organization registry;
- durable enterprise job-family identity across unrelated Recruitment Plans;
- automatic cross-source entity resolution;
- a complete recruitment-population ontology;
- nationwide geographic normalization;
- full lifecycle workflow;
- automatic effective-source selection without explicit relations.

## 22. Implementation Gate

The following implementation gate was satisfied by explicit human approval for this CR:

1. this document's object and identity boundaries;
2. the distinction between Position and Opportunity;
3. Plan- and publisher-scoped Position code semantics;
4. provisional identity and default-separate behavior;
5. Organization role and Location role boundaries;
6. Headcount Observation states;
7. Recruitment Population reference boundary;
8. correction/supplement/replacement target semantics;
9. the legacy identity compatibility and non-destructive migration strategy;
10. the exact implementation file list;
11. the persistence boundary, if persistence is included;
12. a dedicated test plan containing Controls A through L;
13. architecture, application-boundary, and zero-network guards;
14. confirmation that Requirement, Eligibility, P2, Canary, Scheduler, Production Write, API, Web, and Supabase remain outside scope.
15. confirmation that any legacy identity migration is separately approved and tested rather than bundled into the identity implementation.

Any follow-up implementation must stop and request a new Change Request if it requires:

- changing Eligibility result semantics;
- changing Requirement parsing or completeness;
- implementing Requirement Source-Surface Composition;
- creating a general entity-resolution or organization-knowledge system;
- modifying existing real Canary data;
- network access or third-party platform integration;
- destructive migration or rewriting existing IDs.

## 23. Final Design Consistency Check

1. **Recall First / No False Exclusion:** preserved. Unresolved identity, Plan, Requirement, Candidate, and Eligibility states retain the Opportunity and cannot produce automatic exclusion.
2. **False Merge Is More Harmful Than False Split:** preserved. Missing Plan, Position code, Batch, organization, or location context defaults to a separately retained provisional identity, not an automatic merge.
3. **Requirement Binding:** preserved. Announcement-level Requirements require explicit applicability Evidence; job-table Requirements remain row-scoped; shared URLs never establish shared Requirement scope.
4. **Missing Plan:** preserved safely. A source-local provisional Position and Opportunity may exist with `Plan = UNRESOLVED`; no `DEFAULT_PLAN` is created and later reconciliation requires Evidence.
5. **`NOT_ALLOWED` Product Meaning:** frozen as an execution-gate state only. It cannot instruct a product layer to hide, delete, or exclude an Opportunity.
6. **Legacy Data:** non-destructive migration is possible only through aliases, reconciliation, explicit relations, and new immutable versions. Unsafe reconciliation preserves the legacy identity in review.

All six checks pass at the implementation and regression-verification level.

## 24. Explicit Non-Goals

This CR does not design, implement, or authorize:

- CR#11 professional-expression semantics;
- CR#12 Requirement logic, modality, or conditional applicability;
- Requirement Source-Surface Composition;
- CandidateProfile or Eligibility Engine changes;
- Recommendation or ranking;
- Application State;
- full recruitment-process timelines;
- nationwide professional, organization, population, or location catalogs;
- fuzzy matching, embeddings, LLM identity inference, or probabilistic auto-merge;
- third-party recruitment source integration;
- collection, Admission, Scheduler, network, API, Web, production write, or Supabase changes;
- real Requirement, CandidateProfile, Opportunity, or EligibilityAssessment data;
- production deployment, production persistence, or real-data migration.

## 25. Approval State

`RECRUITMENT CONTEXT & POSITION IDENTITY — IMPLEMENTED / VERIFIED`

Implementation was completed only within this CR. Any required scope expansion must stop and request a separate Change Request.
