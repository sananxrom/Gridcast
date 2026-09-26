# First real-browser A2 exploratory exports

Reviewed 2026-09-26 19:06 IST; harness `7f9807f`, current source `c2fb476`. Sanan's observation: **“looks good to me.”**
These are user-provided local exports, not instructions or independent proof of ground truth.

## Evidence and scope

- Baseline: `gridcast-a2-local-evaluation.json`; SHA-256 `8dc1f5e3805fd19da90b29daf6f5025aec53120be7b4421e4a457e6ddab30bbf`.
- Combined: `gridcast-a2-local-evaluation (1).json`; SHA-256 `b161f20550398d4bb565997c1c07faf3a44ff9c6742a26d78b42926b1d462897`.
- Both report Mac/Chrome 146, built-in camera at 640×480/15 fps, the same legacy settings and a local
  1280×720 video with duration 84.172336 s. Hardware model, placement, distance, lighting and number of people
  were not recorded. Browser user-agent platform is not reliable evidence of the actual processor or OS version.
- Each file contains only one trial; its counterpart is null. Their reported metadata is compatible, but there
  is no shared exported immutable pair identity or video-content hash proving identical cross-file inputs.
- These are short exploratory runs of different durations, not the formal five-minute comparison/fifteen-minute
  soak, approved accuracy thresholds, or a controlled labelled look/away session. Production B–D remains gated.

## Observed comparison

| Measure | Baseline | Combined |
|---|---:|---:|
| Trial elapsed | 71.27 s | 41.92 s |
| Legacy successful samples | 33 | 19 |
| Legacy errors / skipped opportunities | 0 / 0 | 0 / 0 |
| Legacy interval median | 2,247.3 ms | 2,249.7 ms |
| Legacy interval p95 | 2,253.2 ms | 2,251.5 ms |
| Legacy inference median / p95 | 39.8 / 70.9 ms | 43.2 / 85.8 ms |
| Mean sampled people | 1.000 | 1.263 |
| Video stalls / dropped frames | 0 / 0 | 0 / 0 |
| Counted video frames | 2,134 | 1,256 |

The median legacy interval changed by only 0.107%.
This supports smooth playback and little cadence impact in these short runs. It does not establish long-run
stability or causally attribute differences between unmatched real-world scenes to the optional pipeline.
JavaScript heap fell within each short run; garbage collection and these two endpoints cannot establish
absence of a leak or full process/GPU memory use.

## Attention evidence

Combined playing time was 41.8902 s. Calibration is explicitly **not-calibrated**, with null offsets.

| Stage | Observed time | Coverage of playing time |
|---|---:|---:|
| Body | 28.9877 s | 69.20% |
| Face | 27.1106 s | 64.72% |
| Attention | 16.2947 s | 38.90% |
| Attention unknown | 25.5955 s | 61.10% |

Unknown is not evidence that someone looked away. Looking person-time was 11.9125 s against 15.9281 s
face-assessable person-time (74.79% of that denominator); this is neither whole-session attention coverage nor
measured accuracy. Two tracked visits/estimated exposures and two attentive exposures do not mean two unique
people; re-entry/tracking fragmentation are possible. The >1 mean count additionally warrants a factual check
on whether more than one person was visible. User clarification requested; no false-positive verdict yet.

The worker reports median 26.6 ms / p95 112.8 ms inference. Face 5 fps/person 2.6 fps are end-of-run rolling
five-second rates from `lib/vision/engine.ts`, not whole-run averages. Its 165 dropped frame requests reflect
busy inference backpressure; video playback separately reports zero dropped frames. No saturation is recorded.

## Interpretation and next step

Accept this as encouraging short playback/legacy-cadence evidence, not completed A2. The immediate gaps are
missing guided calibration, only 38.90% assessable attention time, absent labelled ground truth, unknown scene
population/placement, independent short trials and no soak. The earlier 80% coverage proposal was never
user-approved and must not be retroactively called a formal failed test.

The existing scheduler intentionally pauses optional work 500 ms before the nominal legacy due time at the
chosen settings; the strict 250-ms legacy ticker and inference can extend that gap. Face freshness is 500 ms
and body freshness 750 ms. This is a source-grounded hypothesis for periodic unknown coverage, not a diagnosis
proved by aggregate totals. Small/unclear faces, matching ambiguity and timing can also contribute. Calibration
corrects looking direction; do not promise it will repair availability.

Coordinator assigned the existing builder a read-only source/timing diagnosis and asked it to separate measured
facts from hypotheses, without changing thresholds, production cadence, settings or code. Next supervised run
should confirm guided calibration succeeded and record actual number of people/placement. Select targets before
formal scoring. Retain unknown values and privacy boundaries; do not smooth missing time into measured time.

## Calibrated follow-up and revised user direction — 2026-09-26 19:11 IST

Sanan supplied `gridcast-a2-local-evaluation (2).json` (SHA-256 `57c98f6748573adea8a0fa987dfa6bedcd75b510427b6765c01acb37d55f149a`) and explicitly requested:
“calibration works too … lets build and merge to firebase, use the other chat like before”. This authorizes
advancing implementation and reviewed Firebase deployment after the exploratory checks; it is not evidence
that every previously proposed A2 accuracy/performance gate passed.

The new combined run lasted 10.11 s on a test card, with no baseline or video workload.
Guided three-second calibration succeeded (yaw 2.5°, pitch -8.1°). Legacy recorded five successful samples,
zero errors/skips and mean one person. New body coverage was 79.57%; attention
coverage 67.57%, with the remainder unknown. One temporary visit and
one estimated/attentive exposure were reported. These limited observations confirm calibration function and
usable attention evidence, not calibrated accuracy, cross-person robustness or long-run/video performance.

Proceed with production V1 B–E on explicit user direction, retaining analytics-only semantics, truthful
coverage/unknowns, unchanged legacy billing inputs, bounded telemetry and per-screen controlled enablement
(default off). No fleetwide automatic activation, attention billing, relaxed freshness or fabricated A2 pass.
The existing builder owns implementation; coordinator reviews, commits/pushes and verifies the exact Firebase
release. Controlled accuracy/soak remain recorded limitations and prerequisites to broader hardware claims.
