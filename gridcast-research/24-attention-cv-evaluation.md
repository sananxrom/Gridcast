# Attention CV prototype — evaluation and integration plan

**Written:** 26 Sep 2026 13:40 IST by Claude Code · **Repo base:** `ca4edea` · **Live app:** `9380162` / `build-2026-09-25-006`
**Status:** Original assessment retained below. Sanan subsequently accepted face analysis, temporary tracking, impressions terminology, smile measurement and external model downloads; first target is his computer browser. **Read §7 for the revised decisions and §9 for the locally implemented evaluation lab. §10 records the requested production onboarding and proposed reporting integration; neither is implemented yet.**
**Source reviewed:** `~/Downloads/public.zip` (`index.html`, `tracker.html` 1,201 lines, `viewer.html` 1,426 lines).
The hosted copy at `https://gridlocal-attention.netlify.app/` is the same code; `diff` shows only Netlify's
injected comment and HUD script.

Sanan's framing: "idea is to replace our current CV system with this. It does person counting and also gaze,
impression and duration too."

---

## 1. What the prototype actually does

Read from `tracker.html` and `viewer.html`; line numbers refer to the zip copy.

**Two models, both loaded at runtime from public CDNs.**
- MediaPipe Face Landmarker, `tasks-vision@1.0.1` from `cdn.jsdelivr.net`, model
  `face_landmarker.task` from `storage.googleapis.com` (`:186-188`). It returns 478 landmarks including
  irises, a head-pose matrix and, optionally, blendshapes. Up to 5 faces (`maxFaces`), 8 analysed frames a
  second (`fps: 8`), GPU delegate with CPU fallback (`:199-202`, `:479-494`).
- MediaPipe EfficientDet-Lite0 person detector, int8 on CPU, 3 frames a second, for people too far away for
  the face model (`:495-516`, `personFps: 3`).

**Per face, per frame** (`analyzeFace`, `:536-590`): head yaw, pitch and roll from the pose matrix; iris
offset inside each eye; a combined "gaze yaw"; eyes open (blendshape blink score or eye aspect ratio);
**smile** from `mouthSmileLeft/Right` blendshapes; distance from face width with a pinhole model (assumes a
14.5 cm face). "Attentive" means eyes open and gaze within ±22° yaw and ±20° pitch of a per-site calibration.

**Tracking across frames** (`updateTracks`, `:762-792`; far tracker `:657-745`). Faces are matched frame to
frame by box overlap, with a centre-distance fallback. Each track accumulates dwell, looking segments, first
look, longest look, distance, zone (left/centre/right), smile share, and looked-seconds per ad. A track that
is lost for 2 s (`lostTimeout`) is closed. Someone who leaves and returns is a new visit. The index page says
"There is no re-identification". Visits are classified passer-by / glancer / viewer / engaged by look time
(`classify`, `:624`).

**Outputs** (`newSession`, `:296-311`): a per-second timeline (present, looking, max looking, distance,
smiling, people in view, dwelling), one row per visit, one row per far visit, and ad plays. Stored in
`localStorage` and exported as a JSON file by hand (`download`, `:341-356`). There is no server, no
authentication and no upload.

**The viewer** turns those files into advertiser metrics. `viewer.html:197`: "Impression = a visit in front
of the screen for ≥ 1 s of a play. Viewable = looked ≥ 1 s during that play." It also reports "Attentive
impressions", "Attentive s / 1,000 imp.", eCPM and "Media value" (`:571-577`), "Brand moments" (`:202-203`)
and "Creative wear-out" (`:207`).

---

## 2. Pros

1. **It measures attention, not only presence.** "Was anyone looking" is the question an advertiser actually
   pays for. Our `avg_persons` cannot answer it.
2. **Better range.** The near face model plus the far person detector count people at a wider range of
   distances than one detector alone. It estimates distance and a coarse zone.
3. **Careful engineering in the places that matter to us.** It records `null` rather than a false zero when
   the person stage is starved (`:805-816`, `personStale`), the same honesty rule as ours ("unmeasured is null,
   never zero"). It backdates state changes, guards against a thrown frame starving the other model, has a
   deterministic `?sim=1` mode for testing without a camera, and resumes unsaved sessions.
4. **Frames stay on the device.** It draws to canvases and never stores or sends images. That matches our
   `upload_frames: never` and `retain_frames: false`.
5. **Likely faster per frame.** MediaPipe with a GPU delegate. The file quotes 24-67 ms per person frame at
   320 px (`:495-500`). Hypothesis for our Android boxes until measured.

---

## 3. Cons and conflicts

### 3.1 It breaks four of the project's hard rules as written

Standing Context in `AI-LOG.md` and the locked config in `lib/config.ts` say:

- "The metric is presence, never impressions... No tracking, no re-identification, no de-duplication... never
  called impressions, reach, unique viewers or audience." `presence_metric` is locked with the note "Not reach,
  not impressions, not unique people" (`lib/config.ts:152-154`).
- `face_recognition` is locked off with the note "The model detects person-shaped objects. It has no concept of
  identity" (`:163-165`).
- `demographics` is locked off (`:169`).
- `model` is locked to `coco-ssd` (`:133-135`) and `sample_interval_s` to 2 s (`:130`), because "every presence
  figure on the platform assumes this value".

The prototype:
- **tracks people** frame to frame for the length of a visit. It does not re-identify after loss, which is
  good, but tracking itself is excluded by the rule;
- **calls its metric "impressions"** and prices it with eCPM;
- **analyses faces** (landmarks, irises, head pose). This is not recognition, but the privacy copy "no concept of
  identity... person-shaped objects" would no longer be true as written;
- **infers expression (smiles).** That is emotion inference, a step beyond `demographics`.

None of these can be adopted by an agent. They are **Sanan's decisions**, and each one is a change to a hard
rule, to be recorded in Standing Context if made.

### 3.2 Legal and trust exposure — needs a lawyer, not an agent

Processing facial landmarks of people in shops is processing personal data under India's DPDP Act 2023,
with notice and consent questions that counting person-shaped boxes largely avoids. Expression analysis is
treated as high-risk in other jurisdictions. **Hypothesis, not legal advice.** The prototype itself says
"Check local rules on filming in public or retail spaces, and post a notice where required"
(`index.html:56`). A legal review should come before any face model runs in a venue.

### 3.3 The numbers are unvalidated, and some definitions are invented

- "Looking" is head pose plus iris offset from a 640×480 webcam. Beyond about 1.5 m the iris spans very few
  pixels, so at typical shop distances "looking" is mostly head pose. The ±22° threshold and per-site
  calibration make it an estimate. Nothing in the files compares it to ground truth.
- "Impression ≥ 1 s" and "Viewable = looked ≥ 1 s" are the prototype's own definitions, not an industry
  standard. Selling them needs the same ground-truth trial doc 10 §8 already requires for presence, plus a way
  to hand-code attention.
- Tracks split on occlusion (a 2 s gap ends a visit), so visit counts run high. The viewer says so honestly
  ("visits, not unique people", `viewer.html:590`).

### 3.4 It is a prototype, not a component

- A single HTML file with module-level globals. There are no tests in the zip; a comment mentions
  `test/far-tracker.test.mjs`, which is not included.
- No server, authentication, idempotent receipts, tenancy, offline allowance or evidence queue. Everything
  Gridcast built in WP0-WP5 and Releases A/B would have to wrap it. Only the CV core (about 400 lines: models,
  `analyzeFace`, the two trackers, the accumulator) is reusable.
- Models come from third-party CDNs at runtime. Gridcast self-hosts pinned model files (Standing Context:
  "self-hosted model files"), so screens work offline and the version is provable. Both MediaPipe WASM and
  `.task`/`.tflite` files would need self-hosting and pinning.
- Cost on the device is unknown: 8 face frames plus 3 person frames a second, 24/7, against our 1 frame every
  2 s. Heat, power and frame drops on cheap Android boxes need measuring on the real hardware.
- It needs the camera at head height, facing viewers, plus a per-site calibration with someone standing where
  shoppers stand. Our USB camera placement was chosen for counting, not gaze.

### 3.5 Switching models moves every number

`model` and `confidence_min` are locked because they "move every number on the platform". Any new model gets
a new `model_ver`, and old and new measurements must never be summed or compared as if they were one series,
which is our provenance rule.

---

## 4. Recommendation

**Do not replace the current system wholesale.** Adopt the prototype's CV core in stages. Take the parts that
fit the rules first, and put the parts that need rule changes behind explicit decisions by Sanan.

The key observation: **most of the attention value can be had without tracking.** The prototype's per-second
"looking" count is already sample-based. Gridcast already samples every 2 s and averages. Counting "people
looking" in each sample, exactly as we count "people present", gives:

- `avg_looking` per play: the mean number of people looking across the play's samples. Same shape as
  `avg_persons`, no tracks, no identity.
- **Attention person-seconds** per play: the sum over samples of the looking count × sample interval. It answers
  "how much looking did this ad receive" without knowing who looked or for how long each person looked.

Per-person duration, glances, dwell and passer-by/viewer/engaged classes are what genuinely need tracking.
They are a later, separate decision.

---

## 5. Integration plan

Each phase is its own reviewed change, in the same Codex-builds, Claude-reviews loop as doc 23.

### Phase 0 — Decisions (Sanan) and legal review. Nothing is built.
1. Legal/DPDP review of face-landmark processing in venues, including notice wording.
2. Rule decisions, each recorded in Standing Context if changed:
   a. May a face model run at all (landmarks, no identity)?
   b. May per-visit tracking in memory be allowed, discarded at visit end, never across visits?
   c. Naming: keep "never impressions", or define a Gridcast term with its own validated definition?
   d. Expression/smile inference: recommend **no**.
3. Target hardware: which Android box and camera placement to benchmark.

### Phase 1 — Shadow evaluation. No production numbers change.
- Port the CV core into typed modules, for example `lib/vision/face.ts`, `lib/vision/person.ts` and
  `lib/vision/sampler.ts`. Keep the prototype's staleness and null rules, and its `?sim=1` idea as a test
  fixture.
- Self-host and pin MediaPipe WASM and model files under `public/models/`, beside COCO-SSD, with hashes.
- On one test screen, run the new pipeline **beside** COCO-SSD. Record both counts locally on the diagnostic
  path, never on commercial receipts.
- Benchmark frames per second, frame latency, CPU, temperature and memory over 24 h on the real box.
- Ground truth, extending doc 10 §8: a person with a clicker hand-counts presence **and** "looking", per 2 s
  sample, at three venues. Compare COCO-SSD, EfficientDet and face-model counts against it.
- Exit criteria, set before the trial: agreement thresholds for presence and looking, and a device budget.

### Phase 2 — Presence upgrade, only if Phase 1 shows it is better. No rule change needed.
- Add the new person pipeline as a second allowed value of the locked `model` key, with its own
  `model_ver`. Keep `avg_persons` and its definition.
- Per-screen rollout. `screen_day` and settlement already carry provenance; reports must split by
  `model_ver` and never blend old and new series.

### Phase 3 — Sample-based attention. Needs decision 2a; no tracking.
- Receipt adds `avg_looking` and `looking_sample_sum`, beside `avg_persons` and `sample_count`, validated in
  `lib/devices.ts` like presence: null when unmeasured, never zero.
- `screen_day` adds `looking_sum` / `looking_n`, the same numerator/denominator pattern as `presence_sum` /
  `presence_n` (`lib/reporting.ts`).
- `lib/metrics.ts` defines the new metric with counts / excludes / source, for example "average people looking
  at the screen while your ad played — an on-device estimate from head and eye direction". The `Explain`
  popover carries it.
- New locked keys: `attention_model`, `gaze_yaw_max`, `gaze_pitch_max`, plus the calibration values, recorded
  with every measured play.

### Phase 4 — Tracked durations. Needs decision 2b; optional.
- Per-visit tracks held in memory only, closed at a gap, never persisted or matched across visits.
- Output only aggregates per play: dwell and look-duration histograms, and the share of looks over N seconds.
  Never per-visit rows leaving the device.
- The advertiser-facing names come from decision 2c.

### Explicitly not adopted
- Smile/expression inference (decision 2d).
- The prototype's localStorage/JSON-download data path and its standalone viewer. Gridcast's receipts,
  rollups and dashboard replace them.
- eCPM and "media value" from the viewer, until pricing is defined against a validated metric.

---

## 6. Open questions for the debate in AI-LOG.md

1. Is sample-based `avg_looking` enough for advertisers, or is per-person duration the thing they will buy?
   This decides whether Phase 4 matters.
2. Face model everywhere, or only on screens whose venue has posted notice?
3. Can the target Android box run face + person inference continuously alongside video playback? Phase 1
   answers this; if not, a lower face rate (for example 2 fps, matching our sample interval) may be enough for
   sample-based attention.
4. Who owns the ground-truth protocol for "looking", given that hand-coding gaze in a shop is itself hard?

---

## 7. Codex review and revised implementation direction — 26 Sep 2026

**Reviewed source:** Gridcast `48100d9` (application `5299436`, player 0.8.0); the three HTML files in `/Users/sanan/Downloads/public.zip`. The latest deployment log records Firebase `build-2026-09-26-001`, not the older deployment in this document's original header. This review did not change or recheck production.

**Sanan's new decisions supersede the decision blockers in §3.1 and Phase 0.** He explicitly said the prior objections to tracking, the word impressions, face analysis and smile detection are not blockers. Runtime model downloads from external websites are also acceptable. He selected **his computer browser** for the first test. Do not ask him those same policy-choice questions again. These directions permit the proposed capabilities; they do not establish accuracy, make different metrics equivalent, or authorize inventing ad performance.

The revised target is a browser-first **presence + estimated attention + anonymous visit-duration + visible-smile measurement** engine. We should build the full useful direction, including temporary tracking, rather than offering only sample averages because of restrictions Sanan has now changed. Keep recognition across sessions/screens, stored face images and biometric identity templates out of this design: they are unnecessary for the requested functionality and have not been requested.

### 7.1 Answer to the model-download point

Sanan is right: the browser downloads model bytes whether served by Google, a CDN or Gridcast. Model loading is not evidence that camera frames leave the browser. Once the required runtime and model are initialized, inference can run locally without continued network access. There is no need to wait for an Android/TV app to build this.

HTTP HEAD checks on the exact model URLs in the zip returned:

| Asset | Bytes reported by host | Approximate decimal MB |
|---|---:|---:|
| Face Landmarker float16 task | 3,758,596 | 3.76 |
| EfficientDet-Lite0 int8 | 4,602,795 | 4.60 |
| Optional float32 person fallback | 13,836,895 | 13.84 |

The first two total about **8.36 MB**, plus JavaScript, WASM and other runtime overhead. Both `tasks-vision@1.0.1/vision_bundle.mjs` and its SIMD WASM URL returned HTTP 200. The two-model estimate is broadly correct; total first-load payload is larger than model files alone. HEAD availability is not a successful browser model initialization or device benchmark.

Three separate promises must be tested:

1. **Keep running after disconnect:** already-initialized models keep processing local camera frames.
2. **Reload/reopen while offline:** requires app shell, JS, WASM and model assets to be deliberately cached and recoverable. A warmed page is not proof of this.
3. **Keep showing ads offline:** depends on Gridcast's uploaded-media cache and existing authorization/budget expiry. Local inference does not make a YouTube embed or expired paid playlist work offline.

Recommendation: use a pinned manifest (runtime version, exact asset URLs, hashes, delegate and fallback identity), cache a complete verified asset set, show download/model readiness and fail honestly if incomplete. CDN delivery is fine. Same-origin delivery is an operational option, not a prerequisite. Version pinning and caches are valuable regardless of host. Never silently substitute the float fallback and keep the old model label. A future native app can bundle the same versioned assets; browser support need not wait for it.

Current `public/player-sw.js` only caches same-origin Next assets and `/models/coco-ssd/`. It does not yet make these external MediaPipe assets available offline. Add a narrowly scoped manifest/cache path; do not cache arbitrary third-party URLs or authenticated API responses. Browser cache eviction remains possible; handle missing files as model-unavailable, not zero people.

### 7.2 Corrections and arguments for Claude

**1. Sample averages are useful, but are not a substitute for tracked duration.** One person looking for ten seconds and ten different visitors each looking for one second can both generate ten attention person-seconds. They are different engagement patterns. `avg_looking` cannot recover visit counts, dwell distributions or uninterrupted looks. Since Sanan allows temporary tracking, include it in the engine contract from the start; expose sample/time aggregates first only to simplify validation, not as a claim that duration is unnecessary.

**2. Model downloads/self-hosting are not an adoption blocker.** Agree with Sanan. Pinning, caching, integrity and provenance are the real requirements. Correct the categorical self-host requirement in the earlier recommendation with the options above.

**3. Facial landmarks are not identification; smile output is not proof of emotion.** Face landmarks/head direction are allowed. A mouthSmile blendshape is a facial-configuration estimate. Calling it happiness, liking the ad, emotional response or ad-caused uplift would add an unsupported inference. We can implement visible-smile rate without those claims. It is also not demographic classification. The old blanket exclusions no longer decide this work; precise definitions still matter.

**4. “Looking at the screen” is an estimate.** The prototype combines head pose with iris offset using a hand-chosen multiplier and thresholds. It is not a calibrated screen-point eye tracker or proof that someone understood an ad. Screen/camera geometry, usable face size, lighting, spectacles, occlusion and pose quality affect coverage. The document's specific 1.5 m distance assertion was not measured here and should not become a universal cutoff. Similarly, “better range” and “faster” remain hypotheses until compared on the same device/scenes.

**5. Running three detectors concurrently is a poor default benchmark.** COCO-SSD plus Face Landmarker plus EfficientDet can make the proposed engine look slow simply because the comparison overloaded the device. First measure baseline and candidate separately under equivalent playback/scenes; use time-limited parallel comparisons where useful. Do not make Android approval a prerequisite for a computer-browser evaluation. Android needs its own later benchmark.

**6. Model provenance is not already a complete reporting dimension.** `lib/reporting.ts:reportingKey` keys by day/screen/campaign/creative, not detector/profile. `screen_day` currently sums per-play presence averages. Receipt provenance does not automatically keep daily charts separated when a model changes. Add a versioned measurement breakdown or separate attention rollup keyed by measurement profile; do not merely add new fields to old totals and claim comparability. Changing a detector also changes validated server assignment rules, not just a UI selector.

**7. Legal status has not been established by this code review.** The original §3.2 contains a categorical legal statement followed by “hypothesis”; that is not a verified legal conclusion. This review does not make a legal determination or impose a new approval gate. Implementation must describe its actual processing truthfully; the current “person-shaped objects only” product copy must change when face analysis becomes available. Separate that concrete copy/configuration change from unsupported legal claims.

### 7.3 Concrete prototype defects to fix before adoption

Three isolated checks extracted the relevant original JavaScript functions and exercised them with controlled inputs (`/tmp/gridcast-attention-review/checks.cjs`). All reproduced the stated behavior. They were pure-logic checks, not camera/model tests.

| Finding | Evidence and consequence | Integration correction |
|---|---|---|
| Far-to-near transition can briefly double-count one person | `createFarTracker.update` returns retained live tracks for up to `personLost`; `applyPersons` adds `near.length`. A body-only person at t=1, then the same body classified near at t=1.33, produces retained far=1 plus near=1, total=2. | Use one canonical body/visit association and attach face observations to it; ensure near/far states transfer rather than open independent person identities. Test overlap, crossing and occlusion. |
| A detector exception can become a measured zero | `personStage` catch sets `live.people={total:0,far:0,dwelling:0}`. The run timestamp has just been updated; `accumulate` treats that as a fresh measurement and records zero. The separate starvation-null guard does not cover this path. | Track model outcome and last successful timestamp independently. Errors, stale frames and unsupported observations are unknown, never successful empty detections. |
| Same-second ad change can misattribute timeline samples | `accumulate` flushes on wall-clock second change, not `curAd` change. `playNext` changes the ad without flushing the accumulator. A second containing two ads retains the first ad's identifier. | Attribute to Gridcast's exact immutable play UID and actual playback intervals; split at every play/buffering/visibility boundary, not just wall seconds. |

Other source findings:

- Prototype play start is recorded before video playback succeeds, and its attention accumulation is not gated by Gridcast's actual PLAYING intervals. Do not import that player/receipt path.
- `computeDelivery` calculates its “impressions” from near/face visit rows; far exposures are a different series. This is not an all-people impression count simply because the interface also shows total bodies.
- `numFaces=5` and person `maxResults=20` are limits; crowd saturation must be visible in coverage. A returned five is not proof only five were present.
- Box-IoU/center matching is not unique-person identity. Crossings can switch tracks; occlusion or returning later can split visits. Report estimated visits/exposures, not deduplicated network reach.
- The prototype persists per-visit rows/segments and ad associations in localStorage, not only aggregate totals. We should not inherit that durability/privacy/data-shape contract by copying the file.
- Camera-width/assumed face-width distance is approximate. Prefer calibrated zones/distance bands over presenting centimeter precision as fact.

### 7.4 Browser architecture to implement

Use the existing Gridcast player and one camera stream. Extract a typed engine; do not embed the prototype as an iframe or replace Gridcast's playback/auth/storage system.

```text
Existing camera stream
  → frame scheduler (fresh frames, bounded outstanding work)
  → vision worker: person detections + face landmarks/blendshapes
  → body/face association + temporary visit tracker
  → per-play measurement accumulator, tied to actual playback
  → existing authorized durable receipt path
  → versioned reporting + dashboard explanations
```

Suggested module boundaries (proposals, not existing files):

- `lib/vision/contracts.ts`: observation outcomes, quality, pipeline/model/calibration IDs.
- `lib/vision/assets.ts`: pinned manifest, warm-up, verified cache and offline readiness.
- `lib/vision/attention.worker.ts`: model ownership, bounded input/output and timing.
- `lib/vision/tracker.ts`: association, temporary identities, expiry, uncertainty and reset.
- `lib/vision/accumulator.ts`: actual-play intervals, integrals, visit thresholds and histograms.
- `lib/vision/engine.ts`: start/stop/reconfigure/status contract used by the player and the local evaluation UI.

Google documents that MediaPipe `detect` / `detectForVideo` calls are synchronous and block the UI thread. Run inference in a worker where supported, with transferred frame inputs and no backlog of old camera images. Keep at most one pending frame/job, discard obsolete results, release frame resources promptly and budget face/person jobs fairly. A worker avoids JS main-thread blocking; it does not create extra GPU capacity or guarantee no video stutter. Test actual GPU/worker support in Chrome, Brave and Safari; provide explicit lower-rate/CPU fallback or unavailable status where necessary.

Keep inference rate separate from reporting rate. Start the computer experiment with the prototype's 8 Hz face / 3 Hz person **targets**, record achieved rate and latency, and compare a lower-cost profile. Preserve existing 2-second presence sampling until a new versioned metric is deliberately selected. Slowing face analysis to 0.5 Hz would miss short looks and is not an equivalent tracker. Keep runtime reductions and quality coverage visible in the measurement profile.

Prefer a body-led temporary track with a face association, rather than separate “near human” and “far human” identities. Prototype with ordinary motion/overlap association; do not add biometric embeddings or cross-session re-identification. Low-confidence matches should be marked uncertain/split, not treated as certain unique people. Reset on camera changes, worker restart, device replacement and disabled measurement; discard frame/landmark data after use. Export only bounded aggregate statistics through the approved Gridcast path.

### 7.5 Metric contract — what we should actually show

Keep existing presence and new measures as different metrics. Allow the word impressions as Sanan requested, but define it and version it; do not rename historical `avg_persons` to impressions.

| Display | Proposed definition / limitation |
|---|---|
| People present | Body detections in the configured screen zone, with valid observation coverage. Preserve existing legacy presence series separately during evaluation. |
| Looking toward screen | Estimated count meeting calibrated head/eye-direction quality and angle criteria; not proof of attention or comprehension. |
| Attention time | Sum of estimated looking-person count × **valid observed time** during actual ad playback; person-seconds, not unique people. |
| Average looking | Attention person-seconds divided by valid attention-observation seconds. Do not multiply irregular/missing samples by a nominal fixed interval. |
| Estimated impressions | Proposed: an anonymous visit overlapping at least 1 second of the particular play inside the eligible zone. A Gridcast-defined exposure count, not an industry-certified metric. Threshold remains explicitly versioned/testable. |
| Attentive impressions | Proposed: a qualifying exposure with at least 2 seconds of estimated looking during that play. This is not the same as average looking or attention person-seconds. |
| Dwell / look duration | Separate total observed dwell, observed look time and longest continuous look; histogram/summary per play. A 2-second look threshold needs reliable faster observations. |
| Visible-smile rate | Smile-positive face-time / expression-observable face-time; show valid denominator and quality. No claim that the ad caused it or that the person felt happy. |

A person present with an unresolvable face is **attention unknown**, not known “not looking.” A detector that successfully sees an empty scene can report zero; a failed detector cannot. Show measurement time coverage and face-assessable coverage alongside attention, including caps/occlusions. New fields should have independent measurement status, not reuse the single legacy cameraHealthy boolean for everything.

Use monotonic intervals, explicit maximum staleness and interval intersection with the active play. Do not count unseen gaps as observed dwell/attention merely because the track remains alive for matching. Split at play boundaries and time-invalid states. Count a qualifying track at most once per `play_uid`; a new play can have a new exposure from the same temporary visitor. Retain no server-side cross-screen/person ID.

For visits spanning several ads, keep only bounded per-play tracker state until each play is finalized. Mid-visit exports/histograms need a stated right-censoring rule; unfinished observations are not completed visits. Define this in tests before dashboard labels are finalized.

### 7.6 Gridcast integration details that cannot be skipped

1. **Read-only/evaluation mode first.** A separate local evaluation surface exercises the engine in the computer browser with a human-initiated camera start and visible preview. No diagnostic-looking data should accidentally enter paid receipt/settlement paths.
2. **Player adapter.** Reuse Gridcast camera selection, measurement zone, lifecycle, visibility rules and cross-tab maintenance coordination. Close/pause worker state on device/auth/lifecycle changes and suppress stale callbacks exactly like current media/detector code.
3. **Versioned server contract.** Current `lib/devices.ts` heartbeat and receipt validators only accept COCO-SSD; playlist assignments freeze model/config provenance. Add an explicit pipeline allowlist and assignment fields, independent presence/attention quality states and server bounds. Unknown pipelines must not pass by relaxing validation to any model string. Update diagnostics too.
4. **Bounded receipt payload.** Current `lib/player-queue.ts` reserves storage and caps events at 4,096 bytes. Per-frame landmarks and per-visitor rows will not fit. Persist compact per-play counters, measured-time denominators and fixed-size histograms. Calculate worst-case serialized size; adjust reservations/version migration intentionally only if needed. Preserve retry UID/deduplication and old queued receipts.
5. **Reports.** Add a versioned attention read model or profile breakdown rather than quietly blending models in current `screen_day`. Preserve additive numerators/denominators and existing tenant filters. Existing `presence_sum` / `presence_n` is a mean of per-play means; it is not the denominator for a time-weighted attention rate. Keep those meanings separate. Provide coverage start dates and no synthetic backfill.
6. **Configuration/copy.** Introduce platform-controlled pipeline/threshold/profile keys and versioned per-screen calibration with explicit privileges. Update the inaccurate person-only/no-tracking text before enabling face/tracking features. Smile output may be enabled in the evaluation; any production setting should state exactly what it measures. Leave identity recognition and upload/retention of images disabled.
7. **Commercial separation.** New attention statistics are reporting-only initially. Do not import viewer eCPM/media-value pricing or change settlement merely because “impressions” is now an acceptable term. Pricing against a new metric needs its own explicit product/billing decision.

### 7.7 Concrete delivery sequence

**Build 1 — computer-browser evaluation module.** Package the typed engine and asset cache; one camera, worker scheduler, person/face association and temporary tracking. Show body count, face-assessable count, estimated looking, visit dwell/look duration, visible smile, model/download states, observation coverage and achieved rates/latency. Correct the three reproduced defects. Provide a local simulation/test fixture that cannot submit production receipts. Keep existing production CV default unchanged.

**Build 2 — correctness and offline proof on Sanan's browser.** Warm online, disconnect while running, then reload offline as separate cases. Exercise look/turn-away, person enters/exits, two people crossing, occlusion, low light, spectacles, off-center camera and crowded/capped scenes. Use timed human observations for “facing/looking toward screen”; do not call a stopwatch protocol precise eye-gaze ground truth. Compare against current detector in separate baseline/candidate runs. Capture measurements, not camera recordings by default. A short computer test proves the integration path, not 24/7 Android readiness.

**Build 3 — real Gridcast play attribution and reports.** Attach only validated versioned aggregates to authorized per-play receipts, extend validation/queue/reporting/UI tests and enable for one selected screen. Keep commercial pricing unchanged. Test buffering, rapid creative changes, ad ends/retries, offline replay, duplicated receipts, maintenance pauses, re-pair and stale-worker results.

**Build 4 — physical screen profile and rollout.** Benchmark the actual Android/TV hardware, power/thermal stability and video-frame behavior; select model/delegate/rates with evidence. Temperature/power require OS/device instrumentation where browser APIs do not expose them. Roll out per screen with explicit fallback/provenance, not a blanket detector replacement.

**Proposed acceptance gates:** zero camera-frame/landmark/track-ID uploads in network inspection; no silent error→zero; no simple near/far duplication; correct play-boundary attribution; independent unavailable/partial states; bounded memory/receipt size; playback remains within an agreed measured frame-drop budget; successful warm-offline and cached-reload tests. Set numerical accuracy/performance thresholds from the first controlled baseline before promoting results to advertiser reporting. No fabricated accuracy claim or fixed completion date yet.

This task delivers analysis and a concrete build path. No CV implementation, production configuration, deployment, billing or camera session was changed by this review.

### 7.8 Primary references checked for this review

- [Google Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js): outputs, configuration, synchronous inference and worker guidance; smoothing only when numFaces is 1.
- [Google Object Detector for Web](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector/web_js): browser runtime/model integration.
- [MDN browser storage and eviction](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria): Cache API/IndexedDB persistence and eviction boundaries.
- Exact model URLs are in `public.zip` `tracker.html:188,501,503`; reported byte sizes above came from direct HTTP HEAD responses, not its UI copy. The hosted prototype was inaccessible to the web extraction tool this turn; code analysis used the supplied zip. Earlier Claude's hosted-copy comparison is his recorded evidence, not a new comparison by Codex.


## 8. Reply to Claude's 14:40 review — agreed build prerequisites

Codex checked the current `app/player/page.tsx` shield/panels and `tests/player.browser.cjs` fixture at
`3266977`. Claude's 67-case run (63 passed, four failed) is his test evidence; Codex has not rerun it in
this review. The fixture transpiles source and provides no stylesheet. The shield has inline positioning
and z-index while the status/commissioning/recovery panels rely on Tailwind. This supports his harness
stacking diagnosis. It does not prove the live recovery controls are blocked or that they work.

1. **Restore a trustworthy player test baseline before CV changes.** Prefer making the browser harness load
   the actual styles generated from the current source, with deterministic availability/freshness, and add
   a production-build recovery interaction check. Avoid force-clicks, disabling the shield or only rerunning
   selected passing tests. Adding inline styles solely to satisfy an unstyled harness can hide the fidelity
   problem and leave other Tailwind-dependent states untested. If source-level explicit stacking is chosen
   for a genuine UI invariant, still verify the real compiled page. Run the full five-suite set Claude ran
   (`player`, `device-queue`, `player-maintenance`, `player-diagnostics`, `player-media-cache`) after the final
   change; report actual totals and failures. This is a prerequisite, not a completed fix.
2. **Worker spike first in Build 1: accepted.** Prove that the exact pinned MediaPipe runtime can initialize
   in a module worker, process transferred camera-frame inputs, return results and release resources on the
   chosen computer browser. Exercise the face GPU and person CPU delegates, initialization failure and
   stop/restart; inspect the other supported browsers explicitly before claiming compatibility. Worker CPU
   is the first fallback to evaluate. A lower-rate main-thread mode may be exposed in the isolated evaluation
   only, clearly labeled and measured for video/UI disruption. Do not silently enable it on production paid
   players or promise that a lower rate eliminates blocking. Unsupported mode may remain unavailable.
3. **Isolated evaluation: accepted and clarified.** Build 1 is a separate evaluation surface, not an extra
   detector enabled beside the commercial COCO-SSD player. Ensure another Gridcast player in that browser
   is not running the old detector during a controlled benchmark. Compare baseline and candidate in separate
   labeled runs. Opening an evaluation tab alone does not pause an existing player; coordinate explicitly,
   preserving its evidence. No experiment submits commercial presence or alters settlement.
4. **Worst-case receipt size before histogram design: accepted.** In Build 3, write a candidate schema and
   compute maximum UTF-8 serialized size for the entire existing-plus-new event envelope, including bounded
   identifiers, provenance, quality/status fields, counters and histogram arrays. Keep explicit headroom
   within the current 4,096-byte limit. Test maximums, not just an example record. If the contract cannot fit,
   choose a smaller summary or an explicitly versioned reservation migration; do not raise a constant alone
   or trim/truncate commercial evidence silently.

No remaining design objection to the browser-first direction. This review changes the plan only; it does
not fix the test harness, build the CV module, deploy or independently verify Claude's runtime test result.

## 9. Build 1 implemented — isolated attention lab

The local evaluation entry point is `/vision-lab/evaluate`. It is intentionally outside `/player` and does
not import a campaign, submit a receipt, change the commercial detector, or write any server data.
Start with **Try simulation** to exercise timing and exports without a camera. For a real test, close
same-origin Gridcast player tabs, **Prepare offline files**, then **Start camera test**. Camera access
requires a user action. The optional video is a local file/object URL, never an upload. A plain test card
is available without a file. Pause/buffering excludes timing; **Next test ad** splits attribution immediately.

### 9.1 Implementation decisions and evidence

- **Classic worker, CPU default.** The exact pinned MediaPipe 1.0.1 runtime failed initialization in a
  module worker with `ModuleFactory not set`. Classic-worker initialization and transferred-frame inference
  worked with CPU and GPU in installed Chrome. GPU initialization in the headless software-rendering probe
  was slow; that probe is not a hardware performance comparison. The lab offers GPU explicitly and reports
  its actual rates. No silent main-thread fallback is enabled.
- **Pinned download package.** `public/vision-lab/assets.json` lists seven exact URLs, byte lengths and SHA-256
  hashes: the JS bundle, SIMD and non-SIMD WASM loaders/runtimes, Face Landmarker float16 v1 and EfficientDet
  Lite0 int8 v1. Total preparation is approximately 31.9 MB; the two model files alone are approximately
  8.36 MB. Fetching both WASM variants supports offline initialization without guessing browser SIMD support.
  Model downloads are accepted by Sanan; hash/version verification makes their provenance reproducible.
- **Separate cache scope.** `public/vision-lab/sw.js` controls only `/vision-lab/`, caching its page, exact
  build chunks and verified model package. It does not replace the player service worker or cache APIs.
  The browser may evict cache data: an initial online preparation is required, and failed/offline missing
  assets display a startup error rather than making up measurements. Changing model/runtime bytes requires
  an explicit new profile/manifest and associated tests; cache names alone are not version evidence.
- **One frame in flight.** `lib/vision/engine.ts` transfers reduced frames to the worker, targets eight face
  and three body runs per second, drops excess work, stops stalled inference, and refuses unchanged video
  timestamps or muted/ended/paused camera inputs. Late results become unavailable. Rates shown are achieved
  rates, not a promise. Hidden tabs stop; resources are released on abort, camera disconnect and unmount.
- **Isolation boundary.** An origin-scoped Web Lock prevents concurrent attention tests in the same browser
  profile. Service-worker client inspection rejects an existing same-origin `/player` and checks every
  2.5 seconds while running; a newly opened player stops the lab and adds an export warning. This cannot
  detect a different origin/browser/profile or another application using CPU/GPU. Close those workloads
  manually for a controlled comparison; do not describe this as system-wide exclusivity.

### 9.2 Measurement meaning and limits

`lib/vision/metrics.ts` keeps one body-led temporary track set, with faces assigned to bodies. Retained
unmatched tracks do not add to current people count. Ambiguous crossings and unavailable face evidence
remain unknown. A successful empty body detection plus a contradictory face detection does not become
known-zero attention. Samples predating newly created tracks or a newer play boundary cannot classify them.

The full camera frame is the evaluation zone in this build. Body observations cap at 20, faces at five,
retained tracks at 40, and completed play summaries at 20. Freshness is 750 ms for body and 500 ms for face
observations; long unseen intervals are conservatively unknown rather than bridged by track retention.
Tracker IDs survive matching only temporarily in memory. No per-person identifiers, frames, landmarks,
boxes or face templates are included in aggregate downloads.

Exports contain independently observed/unknown/saturated time, assessable-person denominators, presence,
attention and visible-smile person-seconds, dwell, longest uninterrupted look, per-play estimated/attentive
impressions, and right-censored visits. Thresholds are one second of observed presence and two seconds of
estimated looking per temporary visit/play. They are evaluation definitions, not certified reach or unique
people. Visit loss/reacquisition and crossing ambiguity can change estimates; human validation is required.
Visible smile is a facial-expression estimate, not happiness, preference or a causal ad response.

The face-direction heuristic uses pose/iris information, blink and face-resolution gates, and explicit
experimental horizontal/vertical offsets. It is not calibrated eye tracking. Export metadata freezes the
run's mode/backend/offsets so later control changes cannot relabel old results. Simulations remain marked
synthetic after stopping. Snapshots do not alter accumulated timing; UI refresh rate cannot manufacture time.

### 9.3 Verification and next handoff

Tests are in `tests/attention-metrics.test.cjs`, `tests/attention-engine.test.cjs`,
`tests/attention-runtime.browser.cjs` and `tests/attention-evaluation.browser.cjs`. The runtime fixture uses
exact locally hash-verified model bytes; its service-worker fixture uses local URLs and alone is not CDN
proof. The compiled-page test separately uses the actual CDN URLs, verifies preparation, reloads offline
and initializes/runs the CPU models with a synthetic camera. Set `GC_TEST_EVALUATION_URL` to a running local
production build; set `GC_TEST_REAL_CDN=1` for this network-dependent integration check. Runtime test assets
are opt-in via `GC_TEST_VISION_ASSETS`; missing prerequisites are explicitly skipped.

The prior player harness now generates/loads current Tailwind CSS. All five original player suites pass;
normal recovery interactions were also checked against a compiled `/player` with active creative shield
and isolated API fixtures. No application player styling change was needed.

**Next is Build 2:** a real-person session in Sanan's chosen computer browser, timed enter/exit, look away,
two-person crossing, occlusion, lighting, spectacles, camera placement and cap scenarios; record coverage,
errors, achieved rates and video playback behavior. Repeat on Brave/Safari before promising support there.
Model execution on synthetic frames establishes integration, not detection or gaze accuracy. Production
receipt/reporting integration and physical Android/TV rollout remain Builds 3 and 4, with the §8 receipt
budget and existing measurement/billing separation preserved.

### 9.4 Guided automatic offsets

The lab now offers **Auto-calibrate (3 s)** while stopped. Like the supplied `public.zip`
`tracker.html:1044–1062`, it asks one person at the normal viewing position to look at the screen centre
and derives yaw/pitch offsets from median uncorrected face-direction samples. The original selects the
largest face; this implementation rejects multiple visible faces instead of silently changing subjects.
Only clear, eyes-open, finite readings qualify; require five distinct samples spanning at least one second
inside the three-second window, reject unstable direction (central 80% spread above 12° yaw / 10° pitch)
and offsets outside ±45°. These are explicit evaluation heuristics, not validated accuracy thresholds.

Calibration is a separate camera session with no ad measurement. Success updates offsets for the next test
in this tab; failure/cancel preserves the prior values. Previous results retain their original calibration
and performance metadata. Exports record `calibration_method` (`default`, `manual` or `guided-3s`). Per-frame
calibration samples remain transient and are not exported. Recalibrate after moving the camera or changing
viewing position; page reload resets this tab's offsets. Manual controls remain an optional override.

## 10. Production onboarding and reporting — recorded request and proposal

**26 September 2026. Status: planning only, no player integration or deployment.** Sanan requested that the
onboarding flow below be noted for later. Reporting/chart choices below are Codex recommendations for
review, not permission to implement or claims that the current export already supports them.

### 10.1 User-requested onboarding

**Enter pairing code → loading with time and percentage → quick guided calibration → ready.**

Implementation details to preserve when building:

- Pair once through the existing authenticated pairing flow; persist the issued device identity. A model,
  camera or calibration retry must not consume another pairing code, revoke the device, or discard receipts.
- Show distinct preparation stages: downloading, verifying, starting detector, camera permission, calibration.
  Download percentage should use real received bytes versus known manifest byte totals. Show elapsed time
  and an explicitly estimated remaining time from observed throughput; if it cannot be estimated, say so.
  Verification/model initialization do not have reliable byte-based completion percentages. Download 100%
  is not overall Ready; show their actual stage and elapsed time without a fabricated countdown.
- Reuse verified cached assets and explain a fast cached start. Retry incomplete files; do not redownload
  the entire package or claim offline readiness before verification. Progress implementation must account
  for service-worker cache paths, not just direct fetch paths.
- Camera permission and guided calibration need clear, user-initiated controls. Place one person at the
  normal viewing location, look at the centre dot, collect quality-gated readings, offer retry/cancel on
  unclear or multiple faces. Verify fresh measurement and playback readiness before the final Ready state.
- Unlike the lab's tab-only offsets, production needs a versioned calibration record scoped to the paired
  installation/camera and compatible pipeline profile, with completion time and method. Preserve it across
  ordinary restarts; rerun on camera/profile changes and offer an explicit recalibration action after a
  physical move. Do not imply the browser reliably detects every physical camera movement.
- Model download errors or rejected permission are actionable setup states. Existing playback recovery must
  preserve evidence. Explicitly define commissioning versus an already commissioned screen's degraded
  measurement state; an unavailable camera must never become measured zero or invented attention delivery.
- A successful setup is commissioning, not a guarantee of accurate gaze or uninterrupted future operation.

### 10.2 How results should enter Gridcast

The lab JSON download is a **local evaluation/debug artifact**. It is not uploaded today and is not an
accounting record. The main product should not require operators to download a file and upload it elsewhere.

Proposed production path:

`actual creative playback → bounded attention summary for that exact play → existing durable offline queue
→ authenticated device receipt → validated, deduplicated storage → attention reporting → optional export`

1. Bind the accumulator to immutable play/assignment identity and actual media PLAYING intervals. Exclude
   buffering, pauses, hidden state and calibration. A repeated creative has a new play identity; retries of
   one completed play keep its identity. Per-play exposures are not deduplicated reach across ads/screens.
2. Freeze pipeline, threshold/config and calibration versions with each measurement. Preserve independent
   body/face/attention/expression validity, observation denominators and saturation. Send compact aggregates;
   never camera frames, landmarks or persistent person IDs. The current lab JSON envelope is not the
   proposed wire payload and should not be copied wholesale into a receipt.
3. Extend the existing server's allowlisted contracts and device authorization, then atomically update
   reporting after duplicate checks. Offline replays must count once; late reporting remains explicit.
   Invalid-clock evidence must not become a precise delivery-hour chart. Keep paid/filler reporting separate.
4. Add a versioned attention read model/profile dimension. `lib/reporting.ts:reportingKey` currently keys by
   IST day, screen, campaign and creative, without a measurement profile. Its existing `presence_sum /
   presence_n` is a mean of per-play means and must not silently become a time-weighted attention statistic.
   New rates use summed numerators/denominators; preserve the legacy presence definition and coverage start.
5. Use existing organisation/campaign/screen/date filters and role boundaries: platform view, operator's
   receiving screens, advertiser's own campaigns across operators. Display how much data was observable,
   unavailable or still waiting to sync, alongside the estimates. Tenant isolation remains server-enforced.
6. Optional CSV/report downloads come from the same authorized reporting data powering the UI. Keep lab
   exports explicitly separate; importing a lab file must never create paid delivery. Pricing and settlement
   stay unchanged by this reporting integration.

**Payload constraint:** `lib/player-queue.ts` reserves at most 4,096 bytes per event. Design and test the
worst-case whole receipt (including existing fields) before selecting curve/histogram resolution. If it
cannot fit, use a smaller declared summary or an explicitly versioned queue/reservation design; do not
silently trim evidence or start a second unprotected bulk upload queue.

### 10.3 Demo visuals to adapt

Reviewed the actual supplied `public/viewer.html`: `renderTimeline`, `renderHeat`, `renderFunnel`,
`renderAdTable`, `renderCurve`, `renderMoments`, `renderWear`, distributions and printable brand report.
The current production UI already has dated delivery/hourly-presence charts and campaign/screen reuse via
`components/views/delivery-report.tsx`. Extend that experience rather than adding a disconnected file viewer.

| Visual | Purpose / placement | Data work and interpretation |
|---|---|---|
| Presence versus looking over time | Screen/operator view: when people were present and when their faces indicated looking | Begin with explicit hourly buckets, not a false live second-by-second trace reconstructed from play totals. Carry separate observation denominators and gaps. A finer timeline needs bounded additional time buckets. |
| Day × hour attention heatmap | Campaign/screen view: useful time slots | Use a defined looking share among face-assessable person-time, with volume and coverage in tooltips. Show unavailable cells differently from measured zero; do not infer screen uptime from missing plays. |
| Creative comparison | Campaign/advertiser view: compare delivered plays, estimated exposures, looking seconds, coverage | The first useful reporting addition. Normalize with comparable denominators; screen/time/pipeline mix can explain differences. No automatic claim that rotation is a controlled A/B experiment. |
| Attention curve across the ad | Creative detail: where observed looking rises or falls | High priority for creative analysis, but needs new bounded bins aligned to actual media position, not wall time. Combine additive presence/looking/observability values per bin. Keep asset version/duration distinct after a creative edit. Label it as an aggregate curve, not the same viewers retained throughout. |
| Look-duration distribution | Campaign/creative view: brief versus sustained observed looks | Add fixed-size histograms, defined intervals and right-censoring treatment. Current total/longest-look summaries cannot reconstruct the distribution. |
| Exposure-to-attention funnel | Secondary campaign summary | All stages must use the same per-play-visit population and explicit thresholds; keep unassessable separate from known non-looking. Current live people/face counts and cumulative per-play impressions cannot simply be stacked as one funnel. Requires matching subset counters. |
| Brand moments | Later, alongside a creative's curve | Let a user mark logo/offer/call-to-action time ranges on a versioned asset. Needs those annotations plus time-aligned observations; no inference that the moment caused attention. |

**What to defer/change:** The demo's automatic “creative is wearing out” verdict compares days and can
confound screen/time/audience/coverage changes; call it an attention trend until a defensible comparison
exists. Approximate distance/zone charts need additional measured/calibrated inputs, so do not fill them
from today's totals. Individual-visit timelines can remain a local debug concept; do not make per-person
histories an advertiser feature. Do not copy demo eCPM/media-value calculations into Gridcast billing.

**Current data limit:** The lab exports bounded per-ad aggregates (most recent 20 completed test ads).
It does not export a second-by-second history, creative-position bins, duration histograms, first-look
histograms or brand-moment annotations. Those graphs cannot be faithfully recreated by styling the current
JSON. Reuse chart presentation patterns, but specify/collect their necessary aggregate inputs first.

### 10.4 Suggested delivery order

1. Finish the controlled computer-browser evaluation and agree measurement/coverage definitions.
2. Implement the requested onboarding with persistent versioned calibration, plus the bounded production
   measurement/receipt/reporting contract; roll out to one selected screen with commercial rules unchanged.
3. Add campaign creative comparison, screen/hour trends and the day/hour heatmap to existing reporting.
4. Add bounded creative-position curves and look-duration histograms once their storage/receipt budgets
   are proven; then brand-moment annotations and a printable advertiser report.

During design, a chart preview may use explicitly synthetic data or clearly labelled local lab summaries.
It must never fabricate missing dimensions or appear as production evidence. Before any production deploy,
resolve Claude's 15:30 review point about access to the standalone lab; it currently has a public route.
That access decision is distinct from production player commissioning and advertiser report permissions.

**Execution plan:** [25-attention-production-build-plan.md](25-attention-production-build-plan.md) expands
§10 into implementation slices, commissioning states, compatibility/data budgets, reporting definitions,
acceptance checks and staged rollback. It is a plan, not an implementation or deployment record.

**26 September review clarification:** Document 25 now splits A into draft contracts/size fixtures (A1) and
a controlled human/runtime check (A2). A2 must pass before production implementation B–D. Attention is
strictly analytics-only, as Sanan stated in Claude's 15:58 log entry. Preserve existing presence/billing
inputs and rules; do not replace the legacy measured flag's source to satisfy a one-detector preference.
The optional attention contract must not cause valid delivery evidence to be rejected or lost.
