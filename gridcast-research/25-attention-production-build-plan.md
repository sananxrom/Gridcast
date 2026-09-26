# Attention production build plan

**Status (2026-09-27):** B–E are reviewed and deployed to Firebase as application commit `023e4f40a98d8efcebeb64ae484146a85ae987cc`, player `gridcast-web/0.9.0`, rollout `build-2026-09-26-002` (READY/SUCCEEDED, 100% traffic). Build/typecheck, 302 standard tests, 40 player browser cases, 25 local Enterprise emulator checks and the real pinned cold/offline inference test passed. Live health/player, model file hashes and both production lab 404s verified. Attention remains off until enabled per screen; no fleet activation or live analytics receipt was manufactured. Sanan authorized advancing beyond the originally proposed A2 gate; this is not an A2 human accuracy, representative-hardware performance or soak pass. Those validations remain open before pilot promotion. See [26 — contracts and validation](26-attention-contracts-and-validation.md). **Planning base:** `7d5f085`.

**Local follow-up:** Optional-calibration playback fix is prepared as player `gridcast-web/0.9.1` and awaits coordinator review. It has not been committed, pushed or deployed.
**Requested by Sanan:** Plan ahead for pairing → model-loading progress/time → quick calibration → ready,
automatic integration with current Gridcast reporting, and selected visuals from the supplied demo.
**Relationship to document 24:** §9 is the existing local lab; §10 records the product direction. This
file breaks that direction into reviewable implementation slices and acceptance gates. It does not reopen
accepted temporary tracking, face analysis, impressions terminology, visible smiles or CDN downloads.

## 1. End state and boundaries

A newly paired player guides its installer through preparation and calibration. Normal restarts reuse
verified assets and a compatible calibration. Each actual ad play produces bounded attention evidence
that follows Gridcast's existing durable receipt path. Operators and advertisers see scoped reports without
moving JSON files. Lab downloads remain evaluation artifacts. Attention is analytics only, per Sanan's instruction recorded by Claude at 15:58 IST on 26 September: impressions, looking, dwell,
calibration and smiles must not feed pricing, budgets, billability, settlement or invoices.

Production continues to distinguish: rendered, measured, billable, observable attention and unknown.
Faces/landmarks/images/temporary person IDs stay on the device. A visitor seen during multiple ads can
contribute a separate exposure to each play; that is not deduplicated reach or a count of unique people.

**Proposed rollout defaults:** opt-in per selected screen; legacy screens remain on their current pipeline;
existing COCO presence fields retain their current meaning and source. The analytics runtime topology
must be established in slice A, preserving the legacy path and proving the combined workload if extra
inference is required. One camera lifecycle owner and a bounded scheduler remain necessary; the previous
blanket one-detector recommendation must not force substitution of billing inputs. CPU face delegate initially, with
GPU enabled only after a measured device profile. The standalone lab should be disabled on production by
default and explicitly enabled in local/preview environments. The paired production commissioning UI is
separate from that experiment. These are implementation defaults for review, not changes made by this file.

## 2. Source-grounded gaps that must be addressed

| Existing surface | What it does today | Required change |
|---|---|---|
| `app/player/page.tsx` | Owns pairing, playback segments, sampled COCO presence, heartbeat and queued receipts | Add a coordinated legacy-presence and optional-analytics lifecycle and commissioning state machine without breaking playback/evidence lifecycle. |
| `lib/devices.ts` | Accepts only COCO-SSD in heartbeat/presence validation; assignments freeze config and economics | Add an explicit versioned pipeline contract, capability negotiation and bounded validation. No free-form model acceptance. |
| `lib/config.ts` | Model/sample keys are locked, with legacy person-only explanatory copy | Introduce platform-controlled profiles; preserve locks, honest legacy definitions and privacy restrictions. Update face-analysis copy before exposure. |
| `lib/vision/*` and lab worker | Local typed accumulator, worker, calibration and aggregate export; full-frame zone | Extract reusable runtime interfaces, add production zone/count/profile support and calibration persistence. Keep lab-only data separate. |
| `public/player-sw.js` versus `public/vision-lab/sw.js` | Different shell/cache scopes; player only handles existing models/static paths | Add verified attention assets and preparation messaging to the player cache. Do not register the lab SW from `/player`. |
| `lib/player-queue.ts` | 4,096-byte event limit, reservations, retained-record cap and protected replay | Prove whole-event budget and preserve queued legacy events/reservations. No raw-sample payload or silent truncation. |
| `lib/reporting.ts`, `lib/firestore-store.ts` | Transactional IST delivery summaries; legacy presence mean; no profile key | Add profile-aware attention summaries and corresponding indexed scoped queries. Never blend incompatible measurements silently. |
| `components/views/delivery-report.tsx`, campaign/screen pages | Scoped dated reports, sparse tables, explanations and CSV | Add an Attention view with coverage-aware charts; retain Delivery and existing definitions. |

**Analytics-only compatibility boundary — not a billing workstream.** `lib/devices.ts` currently derives
camera eligibility from legacy `body.measured` or assignment camera-failure policy. Those existing rules
and the meaning/source of their inputs must stay unchanged. Do not populate the legacy measured flag from
attention availability, face quality or calibration success. A separate optional attention block does not
by itself guarantee this if the underlying legacy detector is replaced or its scheduling changes.

Slice A must select a runtime design that preserves the legacy presence collector. Any additional workload
needs a representative local performance/accuracy check; the isolated lab's result alone is not proof that
a combined workload is viable. If preserving the legacy path cannot meet performance targets, keep attention
in diagnostic/evaluation mode and resolve the architecture before B–D. Do not fix that conflict by editing
financial rules or silently changing the source of existing fields. Contract design must also prevent
optional analytics rejection or excess payload from blocking an otherwise valid delivery record: define
explicit unavailable/rejected analytics outcomes, preserve retry identity, and keep commercial evidence's
reserved capacity. These are compatibility checks, not new attention-dependent billing behavior.

## 3. Implementation slices and dependencies

| Slice | Deliverable | Depends on | Exit gate |
|---|---|---|---|
| A1 — Draft contracts | Profile/event/calibration schemas, byte budget and legacy-source invariants | Existing lab | Drafts and maximum-size fixtures reviewed; runtime options identified. |
| A2 — Human and runtime check | Controlled looking/counting session, agreed thresholds, proposed runtime under representative load | A1 and existing lab | Results recorded against thresholds set beforehand; chosen pipeline/calibration/runtime judged viable before B–D. |
| B — Server and storage support | Disabled-by-default acceptance, assignment capabilities, calibration revisions, attention rollups and scoped reads | A1 | Old clients/receipts still pass; new validation, deduplication, tenancy and transactional aggregation tested. |
| C — Player preparation and onboarding | Honest loader, cache verification, persisted calibration, retry/restart/recalibration | B | Cold/warm/offline setup and all failure paths preserve device identity and evidence. |
| D — Production measurement adapter | Exact play attribution, body/face stages, offline summaries, heartbeat and diagnostics | B + C | Real player integration tests pass; no uncoordinated inference, altered legacy inputs, invented measurements or financial regression. |
| E — First reporting release | Creative comparison, hourly screen trends, day/hour heatmap, same-data CSV | D | Numerators, denominators, unknowns, tenant scopes and profile separation verified end-to-end. |
| F — Creative analysis | Bounded ad-position curves, observed-look histograms, later brand moments/printable report | A budget design; D + E | Position alignment/censoring/size tests pass; historical missing dimensions shown unavailable. |
| G — Pilot and hardware rollout | One-screen acceptance followed by explicit expansion | B–E; F optional | Human accuracy/coverage and playback/performance gates pass on selected equipment; rollback demonstrated. |

The original A2 gate was superseded for implementation by Sanan's explicit 2026-09-26 direction to build
and roll out Attention V1. B–E may therefore proceed with one shared contract; this sequencing change does
not convert the exploratory browser calibration into a human accuracy/performance result. The controlled
human/runtime check and pre-agreed thresholds remain required before pilot promotion in G. Codex implements
bounded slices; the coordinator reviews source and recorded evidence. Do not run competing resource-heavy
camera/browser suites while Sanan is manually evaluating the player.

**Mapping to document 24:** A includes Build 2 validation; B–F make Build 3 concrete; G includes Build 4.
The human gate applies before pilot promotion, not before the already-authorized implementation. It is not
safe to assume a failed looking test would change only thresholds: camera geometry, model choice, observable
states or runtime design may also change. Keep production opt-in disabled until an explicitly selected screen
is configured, and do not present the exploratory result as accuracy clearance.

**Assignment-budget limitation:** Screen Attention settings and calibration revisions participate in the
immutable player assignment signature. Existing paid-play reservations remain valid for offline receipts, so
changing those settings while budget headroom is exhausted can leave the player waiting for a refreshed paid
allowance until prior reservations expire or more budget is available. Do not refund or rewrite outstanding
reservations to make a configuration change appear immediate. Commission and calibrate before issuing the
paid schedule where possible; broader reservation/configuration lifecycle changes are a separate follow-up.

## 4. Commissioning state machine

`unpaired → paired → checking assets → downloading missing assets → verifying → initializing → camera access
→ guided calibration → readiness check → ready`

- Pairing succeeds once. Retrying a later state resumes with the same authorized device; no automatic
  re-pair, queue clear or destructive maintenance action.
- **Loading:** use manifest byte totals and streamed download progress; show elapsed time and labelled ETA
  only once there is a usable throughput estimate. Cached verified files are distinguished from transferred
  bytes. Download completion does not falsely claim that initialization/calibration is complete.
- **Worker initialization:** explicit status and elapsed time with a bounded timeout/retry. No invented
  percentage for a runtime operation that exposes no progress. Record the actual selected delegate.
- **Permission/camera:** installer starts a visible setup action, chooses camera if needed, and sees a local
  preview. Audio is never requested. Permission/device errors give specific retry instructions.
- **Calibration:** optional guided setup: one person looks at the screen-centre target for three seconds; reject
  insufficient, unstable, multi-face or out-of-range samples. Retain a compatible last valid revision on
  failure/cancel. Without one, explicitly use zero-offset default provenance. Calibration failure, cancellation,
  camera/model unavailability or profile mismatch never gates paid or filler playback. Commissioning and
  recalibration collect no commercial delivery/attention time.
- **Readiness:** independently show assets/runtime ready, camera/body measurements available, calibration
  accepted and schedule/media readiness. An empty scene can still have successful detector observations.
  Do not require a smiling or attentive audience as a readiness condition. No schedule is a distinct
  awaiting-content state, not a repeated pairing or model-download failure.
- **Restart:** verify profile/camera compatibility, reuse cache and calibration, initialize and resume without
  another setup wizard. An evicted model is reacquired; authorization and saved receipts remain intact.
- **Recalibration:** queue an explicitly requested guided calibration for a safe playback boundary, save pending
  evidence, show local setup and resume ads whether the save succeeds, fails or is cancelled. Avoid interrupting
  a paid ad midway solely to show a calibration dialog.
- **Degradation:** report unavailable attention as unknown, keep presence and financial evidence under their
  existing independent rules, and continue ordinary paid or filler playback. Failed optional setup is not a
  calibrated-ready state, but does not make the screen unavailable for delivery.

### Calibration record proposal

Persist a bounded server-authorized record and local cached copy containing: calibration revision, device
and screen binding, local camera-selection reference, input dimensions/orientation, pipeline/profile hash,
yaw/pitch offsets, method, quality summary and completion time. Avoid uploading hardware serials or raw
browser camera IDs; keep selection identifiers local and bind an opaque installation camera reference if
needed. Preserve revisions for delayed receipts instead of looking up only today's offsets.

A browser change of camera identity/selection, incompatible profile or input geometry invalidates reuse.
Physical movement cannot always be detected: expose **Recalibrate** and document its trigger. A calibration
may be used offline only under the accepted cached device/profile authorization; define acknowledgement
before treating a newly created revision as production-ready. Do not invent unsynced calibration IDs on
receipts the server cannot validate.

## 5. Data contract and event budget

Design the wire representation before adding chart code. Candidate data groups:

| Group | Fields / rules |
|---|---|
| Attribution | Existing play UID, device, immutable assignment/campaign/creative identity, source asset version, actual playback duration; existing signed/authorized path remains authoritative. |
| Provenance | Pipeline/profile/schema version, model versions/delegates, configuration revision, calibration revision; bounded identifiers and allowlisted versions. |
| Quality | Independently observed/unknown/saturated body, face, attention and expression durations; valid timestamp state; bounded counts. |
| Additive measurement | Presence/looking/smile person-time, face/expression-observable person-time, qualifying per-play exposures and attentive exposures, censored segment counters. |
| Optional richer summary | Fixed-size creative-position bins and look-duration histogram, with explicit schema/units and unavailable markers. Never an unbounded time series or per-visitor array. |

Use integer milliseconds/counts where practical and validate finite values, caps and cross-field invariants.
Observed and unknown durations must agree with applicable actual-playing intervals within explicit rounding
tolerance. Person-time may exceed wall time when multiple people are visible; bound it by duration × model
capacity rather than mistakenly requiring it to be below wall time. Looking cannot exceed face-assessable
person-time; smile time cannot exceed expression-assessable person-time. Histogram totals/subsets need their
own matching denominators. A successful empty observation is distinct from absent measurement.

**Budget target:** whole serialized event ≤4,096 UTF-8 bytes; target ≤3,584 for planned worst-case fixtures
so there is deliberate headroom. This is a proposed engineering target, not a measured result. Enumerate
maximum legal lengths, escaped/non-ASCII text if permitted, largest legal numeric values, optional evidence
for image/video, provenance, quality and new bins. Test every supported event combination against the actual
queue serializer before selecting final dimensions.

Candidate starting point for richer data: 10 normalized creative-position bins and 6 fixed look-duration
bins. These are design candidates only; reduce or defer them if the maximum envelope does not fit. No queue
limit increase without reservation/storage/replay migration design and approval through the build review.
No detached unprotected upload path or silent removal of rejected fields on retry. A retried play's payload
must remain byte-canonically equivalent for the existing duplicate hash contract.

### Compatibility and old evidence

- Deploy server support before enabling a client/profile. Capability/version negotiation must fail closed
  for unsupported attention configuration while preserving already authorized old evidence.
- Keep accepting old queue/assignment schemas for their defined backlog window, including after rollback.
  Never reinterpret a historical COCO receipt as an attention receipt or fabricate historical calibration.
- Attention has a separate optional measurement block. Keep the current legacy collector, cadence and
  fields intact; do not put a time-weighted body average or new detector result into its mean-of-samples
  metric or measured flag. Prove that optional-analytics failure does not invalidate valid playback evidence.
- Pipeline changes apply at new assignments/play boundaries after any current play is safely finalized.
  One lifecycle owner coordinates camera use and scheduling. Preserve the player’s zone, count ceiling, privacy,
  visibility, maintenance, device-revocation and reservation rules.
- Extend both in-memory and Firestore paths, heartbeat status and diagnostic result validation. Updating
  only the visible player would leave real server ingestion broken.

## 6. Reporting definitions and UX

Create an attention read model keyed by date/screen/campaign/creative asset version and compatible
measurement profile. Retain calibration revision traceability and expose breaks/changes; do not silently
pool incompatible profiles. Writes follow accepted-receipt duplicate checks in the same transaction.
Queries retain existing platform/operator/advertiser boundaries, date coverage and pagination.

**First chart release uses plays grouped by their valid start hour/day**, matching current delivery
attribution. Label this clearly: attention during plays started in that slot, not continuous venue footfall
or inferred uptime. A later true interval timeline needs bounded interval splitting and its own data model.
Invalid clocks and pending offline deliveries remain explicit and cannot be plotted as exact observed hours.

Rates are computed from summed evidence, never averages of percentages:

- Looking share = looking person-time / face-assessable person-time, or unavailable if denominator is zero.
- Expression share = smile person-time / expression-assessable person-time, or unavailable if zero.
- New body average = presence person-time / body-observed playing time, displayed under its own definition.
- Show measurement coverage and assessable population alongside every ratio. A ratio from sparse evidence
  is not comparable to one from broad coverage just because its displayed percentage is higher.

**Screen/operator page:** setup/model/calibration state; camera quality, last observation and sync state;
hourly presence/looking trends and day/hour heatmap; local-only setup preview. Remote pages do not receive
camera images. **Campaign/advertiser page:** exposure/attention totals, coverage, creative comparison and
later creative analysis. **Platform view:** rollout/profile/calibration compatibility and scoped operational
health. All retain filters for relevant dates/screens/campaigns; exports match the same authorized results.

Chart conventions: Gridcast colours/typography, clear units and definitions, keyboard-accessible tooltips,
visible/table alternatives, gaps or hatching for unavailable data, labels for partial/capped evidence,
explicit timezone and reporting freshness. Sparse data should render an honest small table or empty state,
not a smoothed curve that implies observations between samples.

### Creative analysis details

- **Curve:** each bin accumulates looking, body presence and face-observable evidence over actual source
  media position. Divide within each bin using the matching denominator. Never use clock time since play
  request to guess position. Pauses/seeks/errors/unknown position create excluded or unknown intervals.
  Images use actual visible elapsed time against their assigned duration. Keep asset version/duration
  separate after replacements; label normalized/coarse bin boundaries honestly.
- **Histogram:** label observed looking duration per play-visit segment, not whole-venue dwell or unique
  viewers. Declare whether censored segments are separated; do not call truncated visits complete. Existing
  totals/longest look are insufficient to reconstruct this after the fact.
- **Funnel:** defer until subset counters exist for one common per-play population. Do not stack live
  headcounts, cumulative exposure counts and percentages with unrelated denominators.
- **Brand moments:** later versioned annotations (logo/offer/CTA time windows) on a creative, using compatible
  curve evidence. A temporal association is not a causal ad-effect claim.
- **Trends:** no automatic “wear-out” or emotion/preference verdict. No guessed distance from current totals,
  individual audience histories, unsupported unique reach, or copied demo media-value billing.

## 7. Verification and rollout gates

| Area | Required evidence |
|---|---|
| Controlled human check | Empty scene, one/two people, enter/exit, looking away, crossings, occlusion, spectacles, low light, camera offset and crowded/capped scenes. Time against agreed human-observed intervals; record unknown coverage and counting/looking errors. |
| Performance | Baseline and candidate runs on the same computer/content, separately; actual inference rates/latency, video stalls/dropped frames, sustained memory trend. Set quantitative promotion thresholds before scoring the candidate. No FPS alone as proof of usability. |
| Commissioning | Cold download, verified warm cache, offline reload, slow/interrupted network, integrity mismatch, denied permission, no camera, unclear/multiple faces, cancel/hide/reload and compatible/incompatible saved calibration. No queue/identity loss. |
| Attribution | Mid-second ad change, buffering/pause, image dwell, video/YouTube position availability, errors, repeats, maintenance and late worker results. Calibration adds zero playback evidence. |
| Receipt/storage | Maximum UTF-8 envelope, full/reserved queue, duplicate retries, changed duplicate payload, concurrent claims, old queued schema, offline backlog, expired authorization, invalid clocks and server rollback. |
| Reporting/security | Atomic deduped updates, actual Firestore queries/indexes, organisation/advertiser isolation, all pages loaded, no frames/IDs uploaded, invalid pipeline/calibration rejected, profile and legacy separation, unknown/zero distinction. |
| Visuals/export | Correct weighted formulas and bin alignment, sparse/partial/capped states, accessible interactions, mobile layout, same-data CSV, explicit absent historical dimensions. |
| Finance regression | Same playback/budget/camera-policy fixtures retain established billing outcomes. Changing attention, smiles or calibration success cannot create a new price, settlement entry or billing criterion. |

Human accuracy/performance thresholds are not invented in this document. Record agreed thresholds before
the session and observed results before pilot promotion. Local browser fixtures, emulator checks and a
production build do not substitute for that controlled human/runtime evidence.

Rollout order: disabled server support and indexes → backward-compatible player capability → one explicitly
selected pilot screen → review its human/performance/offline results → small cohort → broader opt-in. A
successful computer-browser pilot does not establish Android/TV stability; repeat on that hardware before
expansion. Health checks must identify the actual deployed Firebase revision and applied screen profile.

Rollback disables the new profile for future assignments, finishes/preserves current evidence, releases optional
attention work while preserving the existing legacy presence collector and financial inputs. Retain old/new ingestion compatibility through their
backlog windows, accepted calibration revisions, reporting history and queued records. Never clear browser
storage to make rollback appear successful. Verify rollback under offline/backlog conditions before pilot.

## 8. Work coordination and next actionable step

**Codex:** bounded implementation, integration, reproducible checks, logs, index refresh, then deployment
verification when deployment is actually requested/authorized. **Claude:** source/design review, counter-
arguments and review of Codex's recorded evidence; follow Sanan's existing instruction not to run competing
test suites. Both use append-only AI-LOG entries, distinguish observed evidence from inference and leave
unrelated changes alone. Do not send external messages on the user's behalf; the shared document/log is the
review handoff.

**Current engineering checkpoint:** B–E are implemented locally under the revised user direction. Source
verification must cover transactional Firestore behavior, cold and warm/offline worker startup, player receipt
and legacy-finance invariants, scoped report pagination, build output and production lab-route guards. The
production evaluation lab is disabled by default; its standalone route must remain local/development-only.

**User-dependent inputs before pilot promotion:** which real screen/computer/camera is the pilot, and
availability for the short controlled human session. Use Sanan's chosen computer browser first; confirm the
camera/placement and schedule the short session. A physical-screen/Android claim needs its own hardware
check later. The implementation/deployment authorization came separately from Sanan; this plan records it
without changing what A2 evidence does or does not establish.
