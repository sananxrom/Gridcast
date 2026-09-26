# Full CV replacement and V1 parity

Status: implementation complete for player 0.10.0, focused checks passed, coordinator release in progress. This is not yet a hosted-deployment claim. Source baseline `8ab3aac`; previous hosted application `e6af562` / player 0.9.1.

## User decisions and execution order

1. Audit what the misunderstood partial integration omitted or broke and fix regressions first.
2. Replace the normal old counter with the supplied complete body-and-face system.
3. Restore V1's presentation and live metrics.

CV runs during active ad playback whether diagnostics is visible or hidden. The on-screen diagnostics setting controls the dark compact/expanded player panel. The first supplied screenshot defines the compact hierarchy; the second defines camera/box/detail interaction. White live cards belong in the selected screen's existing dashboard, with historical metrics routed into existing screen, campaign, advertiser and platform reports wherever relevant. Extend the existing downloads; do not introduce manual export/import or a separate reports application.

Calibration is optional. Default settings are acceptable. Do not impose a new calibration or accuracy-benchmark gate. A failed face stage or calibration must not stop ads or falsely turn successful body measurements into failures. Preserve configured delivery policy and truthful unavailable readings. A diagnostic display is not permission to upload camera images or per-person geometry.

All camera-enabled screens are included in one reviewed rollout. **Latest clarification:** existing pairings need not survive; Sanan will re-pair screens if needed. Seamless paired-screen migration is not a release gate. Preserve reports/budget records and simplify migration where possible. This supersedes the earlier test-screen-first rollout restriction. An already-open 0.9.1 browser does not have a safe automatic reload hook: deployment eligibility and actual installed-player adoption are different facts. Do not force navigation mid-ad or erase queues to manufacture adoption.

## Source comparison and audit findings

Sources: supplied `/Users/sanan/Downloads/public.zip`, especially `public/tracker.html`; evaluation implementation in `app/vision-lab/evaluate/client.tsx` and `lib/vision/*`; production `app/player/page.tsx`; documents 24–27; the shared log.

| Area | Evidence | Classification and disposition |
| --- | --- | --- |
| Mandatory calibration | 0.9.0 gated normal playback; 0.9.1 removed the gate | Confirmed integration regression, already fixed live. Retain default mode and test failed/cancelled calibration. |
| Two competing detection paths | Production uses COCO for sampled presence while EfficientDet/FaceLandmarker feed optional attention | Scope mistake. Full replacement must use the new runtime as the normal source, with old evidence acceptance only for compatibility. |
| Attention scheduling | The 250 ms player ticker reserves a 750 ms quiet interval before each COCO sample | Confirmed integration defect: 500 ms sampling leaves no attention dispatch window; 2 s sampling still creates avoidable gaps. Builder owns focused fix and checks. |
| Approved player interface | Legacy counts/tiny preview replaced the rich lab presentation | Omission. Restore compact/expanded dark card, mirrored aligned person/face overlays, toggles, state legend and live/current-ad metrics. |
| Dashboard metrics | Headline attention/impression metrics and selected-screen live counters absent | Integration omission/new integration surface. Extend existing status, reporting and download paths. |
| Stopped, distance, near/far | Original `analyzeFace` 536–590, `createFarTracker` 657–743, `applyPersons` 925–931 | Original functionality exists; current worker/metrics omit it. Preserve useful estimates with explicit definitions; do not invent values or imply measured physical distance. Exact parity implementation follows versioned-runtime work. |
| Near/far matching | Original maintains near face visits and far body visits separately; people total uses retained far tracks plus near body boxes | Document 24 identified a double-count at transition. Current canonical body-led association is an intentional correction, not automatically a regression. Do not restore the original bug. Face and body counts represent different populations. |
| Face-only readings | Current metrics require a fresh associated body to attribute face attention to a person | Deliberate conservative association documented in the lab; expose model/association status honestly. Review usefulness versus original face-led live display without silently redefining old recorded metrics. |
| Person processing | Original resizes person input to 320 px and filters height below 24 px; current worker shares 640 px input | Performance/threshold difference to resolve explicitly in the new profile; no real-device benchmark claimed. |
| Failure coupling | Current worker initializes face then body; initialization failure closes both | Existing lab/runtime limitation, newly important when body becomes primary presence source. New stages must initialize/fail independently. |
| Error shown as zero | Original person-stage exception writes zero | Original defect intentionally corrected by current null/unknown handling. Preserve correction. |
| Reporting definitions | Original viewer uses near-face visits for several metrics; accepted lab has explicitly defined body-led exposure and attention | Preserve definitions and version identities. Do not reuse a historical profile ID for different semantics or silently mix measurements. |

## Migration design under coordinator review

Keep financial grants and measurement configuration separate. The builder proposed an additive immutable measurement-binding collection keyed by assignment/profile/config/calibration. Coordinator prefers this to replacing allowances: changing only measurement must not create fresh budget holds, reset local usage or leave a funded screen with an empty playlist.

New receipts must name a server-issued binding and an exact supported actual model/profile. Validate device, screen, organisation, assignment and configuration. Old queued receipts remain accepted under their original frozen configuration. A missing/unknown binding must never authorize an arbitrary model name. Persist a binding in the same transaction before returning it to a device. Keep existing assignment IDs, caps, validity windows, rates, reserved money and IndexedDB usage keys.

Issuance must preserve financial playlist reuse before adding the new measurement configuration. A test must hold the entire remaining budget in an existing assignment, queue old plays, enable the replacement and demonstrate that playback retains its remaining allowance without extra reservation, refund or replay.

Use a new pinned runtime/profile for materially changed code. Preserve the previous worker/profile for historical validation. Normal updated players use the new body/face runtime without silently running COCO alongside it. Independent failure and bounded frame scheduling are required. Preserve the existing sampled-presence definition and label its actual model. Face/attention/impression/smile measurements do not change pricing, budgets, settlement or invoices.

## Display and reporting mapping

- Player compact card: creative label, live people/faces/looking counts, relevant stopped/smile state, current-play visits/impressions and attention time, camera preview and clear legend. Details expand to tracking/face toggles, temporary per-track information, dwell/longest-look/coverage, calibration status and existing queue/retry controls.
- Screen dashboard: live people, assessable faces, looking and smiling, supplied through authenticated bounded aggregate status; show when sampled and when stale. No images, face landmarks, boxes or temporary IDs leave the device.
- Existing historical reports/downloads: presence, dwell, attention time, average looking, estimated and attentive impressions, visible-smile rate and coverage. Match screen/campaign/creative/date/tenant filters and selected compatible profile. Preserve numerators and denominators; unavailable is not measured zero.
- Report compatibility must extend to every presence consumer, not only the main report card. Old and new source series must not be silently blended. Combine default/guided calibration where metric definitions match; calibration is provenance, not a forced separate report.

## Basic checks and test deployment — latest user direction

**Sanan's latest standing instruction:** this is development/testing, all screens are controlled, and no customers are live. Temporary breakage and re-pairing are acceptable. Prefer quick build → deploy → user testing. This supersedes earlier exhaustive compatibility, accuracy and release-gate expectations in this plan.

Do the basic checks necessary to catch build/startup failures and exercise the changed CV/player/dashboard path, then deploy for Sanan's hands-on feedback. The audit concerns above remain useful implementation context, not a mandatory exhaustive test matrix. Do not add complex migration machinery solely for old test-device compatibility. Keep the existing useful tests, and run targeted checks when a concrete change or failure warrants them; no repeated broad verification or soak/accuracy gate. Record actual checks and unresolved limitations honestly.

Builder owns application edits and focused tests. Coordinator reviews migration/evidence, records decisions in `AI-LOG.md`, and handles final release. The browser timeout at the pause checkpoint was resolved during stage one; focused diagnostics, hidden-preview/inference and default/failure playback checks passed (AI-LOG 03:22). New runtime/interface checks remain pending until the builder reaches a deployable checkpoint.

## Completed local implementation — 27 September 2026

Player 0.10.0 uses the independent EfficientDet body / FaceLandmarker face runtime for protocol-3 camera-enabled schedules and screen tests. Optional calibration and independent model failures do not introduce a playback gate. The body source, immutable measurement binding and aggregate analytics reach existing device/report paths. Normal V2 playback does not load COCO; historical evidence acceptance remains.

The dedicated frame pump removes the old 250 ms dispatch ceiling; initialization is single-flight. Verified/downloaded model bytes and elapsed loading time use the existing progress UI. Local diagnostics restore the compact/expanded hierarchy, person/face boxes, temporary track details, estimated proximity/stopped states and observed runtime performance. The original near/far double-count and zero-on-failure defects are not copied.

Selected-screen live cards carry freshness and aggregate counts. Existing profile-aware reports/downloads include impression, dwell, attention, visible-smile and longest-look values; longest look rolls up as a maximum. These analytics do not alter financial rules.

Verification: 63 focused checks, three browser smokes, TypeScript, production build and whitespace check passed. Coordinator inspected the fresh compact/expanded fixture screenshots. The V2 browser smoke uses simulated inference and real receipt validation; it proves integration, not physical-camera accuracy or real-worker throughput. Sanan will test the hosted replacement after the release recorded in AI-LOG.
