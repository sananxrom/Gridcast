# A1 attention contracts and A2 validation protocol

**Status (26 September 2026): A1 draft implemented locally; A2 not run; production B–D not started.**
Source base `c0f039d`. See [25 — production plan](25-attention-production-build-plan.md).
The code in `lib/vision/contracts-draft.ts` has no application callers. It is an executable design for review,
not an enabled protocol, a server validator, or authorization to claim accuracy.

## 1. What A1 establishes

- One immutable CPU-only candidate profile identifies the evaluated model manifest and pipeline by SHA-256.
  The pipeline digest concatenates worker, metrics, calibration and engine source in that order. The asset
  manifest digest covers its exact bytes. Tests fail if either changes without an explicit profile review.
  `production_approved` is false. A GPU result cannot be labelled as this CPU profile.
- Exact-field validators cover aggregate attention evidence and guided calibration records. They reject
  additional fields, including frames, landmarks, tracking IDs and unsupported chart dimensions.
- A prototype first-enqueue function snapshots/freeze-copies evidence and budgets for the offline queue's
  largest legal sequence number. Absent, invalid or oversized optional analytics preserve the original
  serialized legacy event. It cannot be called on a sequenced/attention-bearing retry.
- Tests exercise actual IndexedDB reservations, reload, offline failure and byte-identical retries, plus
  the existing device ingestion camera-policy behavior. No production source, settings or financial rule
  changes are needed for these tests.

## 2. Candidate wire contract

`attention-draft/1` uses integer milliseconds and counts, with no free-text labels or individual records.
The outer, existing delivery event remains authoritative for play identity, assignment, creative, configured
revision, media evidence and timing. Immutable assignment lookup must supply the source asset identity/version
in B; do not trust a duplicate client-supplied asset label. The optional attention block contains:

| Field | Meaning |
|---|---|
| `profile` | Exact immutable registry key; resolves pinned code/models, actual CPU delegates and caps. Production assignment must authorize it. |
| `calibration_revision` | ASCII opaque ID, 1–64 characters; future server must resolve an acknowledged revision for the same device/screen/profile/camera geometry. |
| `playing_ms` | Equals outer actual-playing duration, including intervals with unavailable attention. Bound 0–3,601,000 ms follows the present receipt acceptance ceiling, not a recommendation for ad length. |
| `body`, `face` | `[observed_ms, unknown_ms, saturated_ms]`. First two sum exactly to playing time; saturation is a subset of observed. Face processing availability does not itself imply assessable faces. |
| `attention`, `expression` | `[observed_ms, unknown_ms]`. Observed time cannot exceed either detector's observed time. Matching assessable population is reported separately. |
| `presence_person_ms` | Person-time from this new body pipeline, never substituted for legacy `avg_persons`. Cap: body-observed time × 20. |
| `face_assessable_person_ms`, `looking_person_ms` | Assessable and looking person-time. Looking is a subset of assessable; assessable is a subset of body person-time, bounded by attention-observed time × 5. |
| `expression_assessable_person_ms`, `smile_person_ms` | Independent expression denominator and visible-smile numerator, with analogous subset/cap checks. Does not imply preference or emotion. |
| `estimated_impressions`, `attentive_impressions` | Qualifying per-play visits, not unique audience. Current candidate thresholds: ≥1 s observed presence and ≥2 s cumulative observed looking. Attentive is a subset of estimated. |
| `tracked_visits`, `right_censored_visits` | Aggregate play-visit counts, with censored a subset. Defensive cap 1,000,000; not a capacity/accuracy claim. |
| `longest_look_ms` | Longest observed continuous look segment within this play, bounded by observed attention time and total looking time. |

If a stage has zero observed time, its measurement values are null. A successfully observed empty scene has
zero counts and person-time. Unknown duration remains visible even if some valid evidence exists. Body-led
visits may be measurable while attention stays null. No histogram/curve can be reconstructed from totals.

The exact-duration rule requires an adapter to round each observed duration once and derive unknown as its
complement; independently rounded floating-point sums are not accepted. No adapter is built in A1. Person-time
conversion must preserve subset relations. No rounding tolerance may create fabricated observed intervals.

**Registry/calibration validation is not authorization.** Passing a pure validator does not establish that
an assignment allows the profile, that a revision exists, or that a clock is trustworthy. Those are B's scoped
server checks. The profile binds model limits in A1; later profile changes need a new version, not in-place edits.

## 3. Calibration boundary

`calibration-draft/1` contains revision, profile, device/screen binding, an opaque installation-camera reference,
input width/height/rotation, `guided-3s`, offsets in tenths of a degree, sample count, sample span, central-80%
yaw/pitch spreads and an ISO completion timestamp. Selection IDs/serials remain local. Geometry bounds: 1–8192
pixels per dimension, rotations 0/90/180/270. Preview mirroring does not alter inference geometry.

Acceptance reflects the existing experimental sampler: 5–64 samples over 1–3 seconds, spreads ≤12° yaw / 10°
pitch, offsets within ±45°. These are engineering screening limits, not proven gaze accuracy. Manual/default
lab values cannot impersonate completed guided commissioning. Calibration failure keeps the prior revision.

The existing sampler returns offsets only. Future preparation code must explicitly collect the bounded quality
summary rather than inventing these fields from offsets. Server acknowledgement/revision issuance, offline
reuse/expiry policy and persistence are not built. A receipt cannot mint its own revision. Reuse requires exact
binding, including selected camera and input geometry; physical movement still needs explicit recalibration.

## 4. Payload evidence and failure policy

The actual queue checks `JSON.stringify(event)` using UTF-8 bytes, then appends `seq_no`. A1 therefore reserves
its maximum 16-digit safe integer during sizing, before any proposed integration. Queue cap stays 4,096 bytes;
the prototype includes analytics only if the complete prospective saved event is ≤3,584 bytes.

Measured test fixtures:

| Candidate | Complete bytes including maximum sequence |
|---|---:|
| Image, legacy measured | 1,559 |
| Image, legacy unmeasured | 1,512 |
| Video or YouTube, legacy measured | 1,488 |
| Video or YouTube, legacy unmeasured | 1,441 |
| Conservative core numeric-width bound | 1,604 |
| Image/core plus speculative 10-position-bin / 6-duration-bin data | 2,168 |

The legacy envelope deliberately exercises 128-character play IDs, 64-character assignment/campaign/creative
IDs, large configuration versions and numeric widths. These are **size stress fixtures**, not a claim that all
such combinations are server-valid image durations/presence reports. The separate device regression uses
valid 10-second assignments. Existing legacy IDs have no universal bound here: longer IDs, escaped text and
non-ASCII text are handled by measuring the whole actual JSON event and declining the optional block. No
legacy value is truncated or clamped. A conservative all-eight-digit attention-number fixture additionally
bounds numeric serialization width; its intentionally impossible totals are not accepted as measurements.

The richer shape is **a size experiment only**, explicitly rejected by the core validator. It reserves ten
five-value position bins plus six complete and six censored look-duration buckets. Its field meanings,
interval attribution and collection remain F work. The current lab does not produce those dimensions.
There is ample capacity in this experiment; bytes alone are not permission to fabricate data.

First-enqueue outcome is explicit locally: `included`, `absent`, `invalid`, or `size_limit`. A failure never
changes `measured`, `avg_persons`, `sample_count`, model version, media proof or play identity. If legacy
evidence itself cannot fit, preserve it and stop playback using existing recovery; analytics must not hide
that condition. Do not repack a saved event or remove attention after a failed network attempt: the current
server hashes the entire original payload. A changed retry correctly conflicts.

B still needs a bounded server attention-validation result alongside valid delivery acceptance, plus visible
operator diagnostics for dropped optional evidence. Unsupported/invalid analytics must not invalidate valid
commercial evidence, and must not be read as zero. This draft's return value is not a production reporting
channel. Do not send draft envelopes to today's live server: it does not store attention analytics. Production
must negotiate capability first; no second unprotected upload queue or payload-stripping retry fallback.

## 5. Legacy compatibility and runtime choice

The source still uses COCO-SSD `lite_mobilenet_v2` on its configured cadence, filtering zone/confidence/count
ceiling and collecting the mean of samples. Existing `cameraHealthy` and `measured` flags still participate
in receipt acceptance/camera policy. None may be sourced from face availability or calibration success.

The new compatibility matrix covers legacy measured/unmeasured × continue/skip × attention absent/valid/
invalid, checks unchanged accrual/presence, and verifies duplicate retries do not charge again. These are
current server regression baselines, **not** evidence of implemented attention storage or combined-runtime
performance. Storage, tenancy, new assignment authorization and server rejection semantics need B tests.

Runtime options for A2:

1. **Preferred candidate:** preserve the actual legacy collector and cadence; one camera owner supplies
   original frames to both it and the optional attention worker. A bounded coordinator yields optional work
   before due legacy samples and never accumulates inference jobs. Measure CPU/GPU contention; a separate
   worker alone does not guarantee isolation. Drop optional observations to unknown under load.
2. **If the combined workload fails:** lower optional rates/resolution under a separately versioned evaluated
   profile, or leave attention in the lab. Re-run accuracy and coverage; rate reduction is not automatically
   equivalent. Do not solve a performance failure by replacing COCO inputs or changing camera/billing rules.

The proposed coordinator is not implemented. A2 needs a **local-only combined-load harness** using the actual
legacy detector alongside the lab worker before selecting the production topology. Testing only the isolated
lab cannot clear B–D. This evaluation harness may be built under A2 without wiring production ingestion.

## 6. A2 human and performance protocol — ready for agreement, not scored

Start in Sanan's computer browser with its intended camera position. Record browser/OS, computer, camera
selection, resolution, screen dimensions, camera height/offset, approximate person distance and lighting.
Keep these as test context, not production receipt fields. Confirm before testing whether one or two people
are available. No recording/frame upload is needed; use a second observer or timed spoken cues and a local
aggregate results sheet. One-person results cannot establish crossing/multi-person accuracy.

**Proposed acceptance thresholds below need agreement before the scored run.** They are project targets,
not claims established by this draft. Any changes must be recorded before observing the candidate score.

| Check | Proposed gate |
|---|---|
| Empty scene | Zero false people/exposures throughout a 30-second scored empty segment. |
| Clear one/two-person count | Exact count for ≥95% of scored one-second observations; enter/exit settles within 2 seconds. |
| Looking vs away in declared usable setup | ≥90% correct among assessable labelled person-seconds, separately for each condition; ≥80% coverage in each. Report unknowns separately so low coverage cannot inflate apparent accuracy. |
| Difficult conditions | Record spectacles, low light, off-centre faces and occlusion separately. Do not pool them into clear-scene success; no promotion to an untested/failing condition. |
| Calibration | Three repeated guided attempts in the same position succeed; each passes the subsequent look/away check. Repositioning requires recalibration. Failure/cancel preserves prior values and adds no commercial time. |
| Playback | Zero new stalls >250 ms in a 5-minute cached-video combined run; dropped-frame rate no more than 1 percentage point above the same-content legacy baseline. |
| Legacy collector under combined load | No new detector errors; median sample interval within 10% of baseline and p95 within 250 ms; no changed model/zone/cadence or source semantics. |
| Optional pipeline | Record actual body/face inference p50/p95/rates, skipped work and unknown coverage; no accumulating backlog or stale result counted as fresh. Accuracy/coverage gates still apply under combined load. |
| Soak | 15-minute combined run without crash/restart. Compare equivalent warmed memory samples; >20% continued growth across the final 10 minutes requires investigation. If memory instrumentation is unavailable, mark that check unresolved, not passed. |

Suggested human sequence (about 8–10 minutes, excluding setup/performance soak):

1. Calibrate, then empty scene 30 s.
2. One person centred: look 20 s, turn away 20 s, look 20 s. Repeat at intended distance.
3. Leave/re-enter twice with observer-marked boundaries. Repeat clear calibration/look-away checks twice.
4. Add a second person: both look, one away, cross, brief occlusion and leave. Score each condition separately.
5. Repeat selected segments with spectacles/lighting/camera-offset changes as applicable; recalibrate after moving
   the camera. Mark unsupported or untested geometry explicitly.

Score in one-second intervals with ground truth fixed by the observer; allow only the declared two-second
transition settling window for entry/exit, not blanket exclusions of mistakes. Keep each scenario's count
accuracy, looking confusion counts, assessable/unknown duration and false exposures visible. Retain aggregate
results and code/profile hashes; do not publish a summary percentage without its denominators.

Run legacy-only and combined performance trials separately on the same device/content, after warm-up.
Close competing camera tabs/apps and unrelated benchmarks. A2 is complete only with recorded human results,
combined-load results and an agreed viable profile/topology. Failing/untested gates stay open; B–D wait.

## 7. Review handoff

Codex owns code/tests and reports the evidence in AI-LOG. Claude should review the draft validators, size
assumptions, frozen retry boundary and A2 targets from source and the logged runs, without competing camera
or browser tests. Focus on missing observable states, null semantics, profile/calibration binding and whether
proposed thresholds represent the intended installation. No need to revisit the user's accepted face/temporary
tracking/smile direction. The open human decisions are test setup and pre-agreed targets, not billing changes.
