# Complete the CV replacement: one active runtime

Status: built and locally verified as player 0.10.4 on 28 September 2026; independent source QC cleared the final candidate. Firebase release is pending. Prepared 27 September after Sanan’s replacement clarification; this completes document 28’s intended replacement without changing the accepted models or metric thresholds.

## Intended result

Every existing and new camera-enabled screen with a supported local camera automatically uses the full EfficientDet body plus MediaPipe face system. There is no old/new model choice and no per-screen new-CV opt-in. Camera availability/enablement, diagnostic display visibility and optional calibration remain separate concepts. A CV failure never invents zero readings or prevents otherwise authorized media playback.

Retain honest historical reports and receipt validation. They are stored-data compatibility, not a reason to keep an executable old detector in the application. Sanan accepts a one-time reload or re-pairing while testing; he should not have to enable a CV generation for each screen.

## Confirmed gap and review response

Normal current protocol-3 playlists already derive the new profile from `screen.has_camera` and local camera source, independently of `attention_settings.enabled` (`lib/api.ts:63`). The reported manual-enabling symptom is not yet traced to a particular device/control; the coordinator's clarification question remains unanswered. This does not block the clear replacement requirement.

Actual remaining paths:
- `components/views/screen-detail.tsx:21` exposes the legacy opt-in.
- `lib/config.ts:133,155` still presents COCO and legacy attention controls.
- `lib/devices.ts:173,226` permits new protocol-2 grants without the new binding.
- `app/player/page.tsx:716-729,803` still loads/runs COCO without a V2 schedule; startup at line 919 accepts cached schedules through `lib/player-media-cache.ts:74` without a new-profile requirement.
- `public/player-sw.js` installs the old attention worker/manifest and permits COCO asset caching. It does not itself explicitly precache the entire COCO model at install; the problem includes its cache allowlist and fetch path.

Claude's three additions are accepted in intent: structurally remove old execution/downloads, explain update requirements, retain old evidence. Two implementation refinements:
1. TensorFlow/COCO also powers `/vision-lab/combined` through `lib/vision/legacy-sampler.ts`. Retire that executable legacy comparison path from the shipped app before removing dependencies. Preserve its historical findings/data and the useful new `/vision-lab/evaluate` interface. Do not delete shared metrics/calibration helpers just because an old module owns them today.
2. Check actual reachable modules and model requests, rather than relying solely on a substring ban. Legitimate historical provenance can contain `coco-ssd`; a text match is not proof that the old detector can execute. Production player must have no TF.js/COCO executable import or legacy detector/model request.

## Build sequence and ownership

### 1. Builder: remove old execution and configuration

- Remove production COCO and optional Attention-V1 worker dispatch branches, imports, timers/state and hidden routes that can activate them. Reuse the approved new runtime, model files, thresholds and definitions unchanged.
- Remove old model/profile/enable controls and their writable activation route. Existing stored legacy flags must not select a detector or gate the new system. Retain only compatibility fields genuinely needed to validate saved evidence; do not silently rewrite old provenance.
- Present the actual combined model as read-only status. Keep camera enabled/source controls, diagnostics visibility and optional recalibration understandable and separate.
- Retire the old executable comparison lab, preserving useful historical fixtures/results and the new evaluation lab. Then remove unused TensorFlow/COCO packages and lockfile entries and obsolete shipped model assets. Trace dependencies first so shared helpers remain available.
- Update service-worker shell version and model caching rules. Refresh the current shell and only obsolete model/shell cache entries as appropriate. Preserve IndexedDB queues, authorizations/usage counters, uploaded-media cache, calibration and useful new-model cache; never clear browser storage wholesale.

### 2. Builder: finish upgrade behavior

- New playback and screen-test grants require the current measurement-capable protocol. Older players receive a useful update/reload response through an error/status format they already understand. Do not assume server deployment can replace JavaScript already running in another browser.
- New player startup must not invoke old CV from a saved legacy schedule. Fetch current configuration/bindings online, retaining existing financial assignments/remaining allowance where valid. Prevent an offline legacy schedule from activating removed code.
- If existing media authorization can truthfully continue unmeasured, preserve that behavior; never fabricate or relabel a measurement binding to continue. Where the old schedule cannot safely be used, show the specific connect/reload requirement. Distinguish an authorization upgrade requirement from a model failure, which must not block valid playback.
- Already-issued receipts continue validating against their original device, screen, assignment, model and allowed backlog window. No extra budget reservation, receipt duplication, identity reassignment or queue deletion as a migration shortcut.
- Preserve camera-disabled screens. IP-camera and unsupported-worker cases remain explicitly unavailable, not COCO fallback. Keep successful body measurement when the face stage fails; neither failed calibration nor hidden diagnostics disables measurement.

### 3. QC and Tester: inspect the frozen candidate

Builder owns implementation and affected implementation checks. QC independently reviews removal completeness, state/control separation, upgrade behavior and evidence/financial invariants. Tester owns the focused acceptance matrix below, avoiding duplicate suite runs or simultaneous physical browser control. Coordinator reviews reports, resolves disagreements, integrates, logs and performs the authorized Firebase release when implementation is requested. Nobody starts a build merely because this plan exists.

## Focused acceptance criteria

1. Existing and newly created camera-enabled screens select both new models with legacy attention flags absent or false. No per-screen model opt-in. Camera-disabled stays off.
2. Diagnostics on/off changes only visible UI; both models and per-play metrics continue. Default, failed and cancelled calibration allow playback/counting as applicable.
3. Runtime/dependency/network inspection shows no production TF.js/COCO execution or old-model download; the new evaluation lab still works after dependency cleanup.
4. Old-protocol request receives explicit reload/update guidance and no new legacy grant. Online and offline cached-legacy startup never invokes old CV; preserved authorized media/records are handled honestly.
5. Previously issued legacy and V2 receipts remain valid within policy; upgrade reuses valid remaining financial allowances without resetting queued evidence or granting duplicate spend.
6. Missing worker WebGL 2, independent face failure and model download failure show unavailable/recovery states while eligible ads continue; healthy body counting stays active when face alone fails.
7. One practical deployed check after reload: laptop Safari / Demo Mohali Retail Media 1 and user-tested old-iMac Chrome / Demo Mohali Retail Media 2. Confirm reported version, both stages, a creative transition and dashboard reporting. Distinguish actual device observations from simulated tests; no long soak or new accuracy gate.

Run TypeScript and one production build for the frozen revision plus the affected focused checks. Repeat only where failures or subsequent changes warrant it. Pin any changed measurement implementation correctly and retain prior receipt provenance. Do not make unrelated metrics/threshold changes.

## Deferred from this release

YouTube transition chrome, reporting headline redesign beyond truthful current model/config display, maintenance rate-limiter changes, saved-record deletion, revoking Safari pairings, Android device qualification, main-branch merge, credential rotation and unrelated research-file cleanup remain separate work. Claude's review suggestions do not authorize those actions. No new hardware compatibility implementation is needed to unblock the old iMac, which Sanan reports working in Chrome.

## Authorized implementation addendum — 27 September 2026

Sanan authorized starting after the 23:50 review. Builder owns application/test implementation; QC performs independent frozen-candidate review, Tester focused acceptance, coordinator integration/Firebase release and read-only blocked-record investigation.

Add two bounded items to this release: (1) correct V2-only report tables/hourly display/export that otherwise read globally unmeasured, preserving model-specific units and historical legacy distinction without a broad mixed-profile dashboard redesign; (2) collect sanitized aggregate per-stage attempted/completed/accepted/slow-rejected counts and response latency including rejected results, with session/window identity and bounded retained history visible in existing diagnostics. Include actual face/association/coverage reasons where available, without inventing evidence. Preserve fresh-result thresholds and existing measurement definitions; do not treat the cafe trend as proof of throttling. Camera frames, geometry and temporary track IDs remain local.

Inspect blocked/failed/invalid-time evidence without deletion. The local blocked record may require its original player browser; inability to retrieve that offline browser does not authorize clearing or rewriting it and does not block the independent build. No unrelated pairing revocation, full history rewrite, main merge or credential rotation is included.
