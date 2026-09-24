# Gridcast — through WP5 implementation and rollout handoff

Prepared 24 September 2026 against source HEAD `13083f5`. No commit or push.
This updates implementation status; historical audit findings in document 10 remain historical.

## Implemented

| Work package | Result | Material boundary |
|---|---|---|
| WP0 deployment integrity | Production requires Firestore and a real signing secret; no demo seed/reset; supported Next.js 15.5.26 and patched PostCSS | Live application changes only after a deliberate rollout. Vercel is not retired. |
| WP1 authorization | Deny-by-default routes, capabilities, tenant/relationship checks, field allowlists, redaction, session revision invalidation | Server IAM bypasses client rules, so API authorization remains mandatory. |
| WP2 devices and delivery | Expiring one-use pairing, hashed tokens, revocation, real heartbeat, immutable assignments, stable event IDs and sequence reservations, observed player progress, persistent browser queue | Software-reported playback is not hardware attestation. Assignment validity is 10 minutes; delivery retry is 72 hours. No claim of 30-minute offline YouTube playback. |
| WP3 provenance/privacy | Exact COCO-SSD version, self-hosted model/checksums, configuration revision, device/server timestamps, failure is null, camera data stays local | Counting accuracy still needs physical ground truth. Offset estimates include network uncertainty. Historical local demo data stays visibly synthetic. |
| WP4 storage | Named Mumbai Firestore; per-document transactions; unique account reservations; append-only evidence; bounded scoped reporting | Compatibility layer reads up to 2,000 domain records and 1,500 report rows. It is a pilot implementation, not an unlimited event analytics service. |
| WP5 inventory | Screen onboarding, reverse quote with provenance, groups, explicit bookings, distinct-advertiser and physical capacity checks, central eligibility, video upload/verification, closest aspect, loop pacing | Legacy YouTube duration is operator-declared; uploaded video duration is verified. WP6 settlement remains unchanged. |

## Decisions and corrections

- The user asked us to choose the counting implementation in plain terms. Keep the existing
  COCO-SSD method; record `coco-ssd@2.2.3/lite_mobilenet_v2` rather than claiming YOLOX runs.
  Platform-only measurement controls remain locked. Remote camera-image paths are removed.
- Advertiser slots are the number of distinct advertisers sharing a screen. Appearances per
  loop consume physical time. A 15-second creative on 10-second slots consumes two slot units.
  An underfilled loop stays blank for unused time rather than replaying booked ads too often.
- The reverse calculator preserves the operator's self-reported per-advertiser price.
  The original spec's one-appearance per-play example is shown separately from repeated
  appearances; this avoids silently changing the commercial unit.
- Saved booking rate references are server-generated and stay fixed when a screen quote or
  campaign default changes. This does not implement settlement/accounting (WP6).
- Active, pending and paused bookings reserve inventory. Draft, complete and cancelled bookings
  do not. Screen/config/group edits revalidate existing reservations before committing.
- Budget thresholds warn; automatic budget stopping is not introduced.
- Group selection snapshots screen IDs. Dynamic membership changes do not silently expand a
  campaign's agreed inventory.

## Actual cloud preparation

- Project `gridcast-508011`, named Enterprise/native Firestore `gridcast`, Mumbai `asia-south1`,
  deletion protection enabled. Deny-all client rules were deployed and source-verified earlier.
- All 24 required indexes were deployed and read back `READY`.
- Private `gridcast-508011-media-india` bucket in Mumbai; uniform access and public access
  prevention enforced. The existing hosting service has bucket-scoped object access.
- `gcAuthSecret` exists in Secret Manager with Mumbai replication and secret-level runtime access.
  The enabled version is random text; an unused initial binary-format version was disabled.
  No secret value belongs in this document or the shared log.
- Initial production data contains only Gridcast's organisation, the designated platform
  administrator, a platform configuration, email reservation, settings and schema marker.
  Zero screens, zero advertisers, zero demo plays, no camera images.
- Administrator email: `sanan@consultsgx.com`. Temporary credential is in a private local
  handoff outside the source repository; a password change is mandatory. Use `/control`
  after the new app rollout. Existing public demo credentials are not imported.
- Existing App Hosting remains Singapore (`asia-southeast1`). India database/object storage
  does not imply an India application runtime. App Hosting has no India region at review time.
  Moving computation to Cloud Run Mumbai would be a separate migration.

## Validation and important failures

- Authorization, domain, device and adapter unit/integration tests pass; see the latest log
  for the final count rather than treating this document as a permanent test tally.
- Five actual Firestore Enterprise emulator tests passed, including separate Node processes
  racing session revocations, email creation and duplicate delivery, plus a forced transaction
  retry. Fixtures are restricted to an emulator and a demo project; production is never a test target.
- Actual cloud SDK readback of the new administrator's bootstrap succeeded with empty delivery
  data, demonstrating named-database and index compatibility without writing fake telemetry.
- Chrome tests exercise IndexedDB persistence/retries and the actual player component using
  synthetic local video and deterministic detector results. They cover actual playing time,
  duplicate end events, lost acknowledgements, loop filler, confidence settings, camera failure
  and recovery. These are not camera-accuracy or hardware tests.
- Actual local HTTP testing verifies upload, server metadata, approvals, booking, pairing,
  playlist, signed media byte ranges and invalid-file/signature rejection.
- Dependency installation initially timed out; retry succeeded. Initial ffprobe bundling
  resolved its executable relative to a compiled chunk; explicit server externalization fixed it.
  The package's macOS ARM-labelled binary is x86-64, so local Apple Silicon uses the documented
  `GC_FFPROBE_PATH=/opt/homebrew/bin/ffprobe` override. Linux production uses the bundled x64 binary.
- The security audit has no critical/high findings after Next/PostCSS updates. Two moderate
  reports remain on the same uuid/gaxios chain: the vulnerable API is UUID v3/v5/v6 with a
  caller-supplied output buffer; the inspected gaxios integration uses v4 for multipart boundaries.
  No unsupported transitive major override was forced merely to suppress the advisory.

## Rollout checklist

1. Keep this source diff reviewable; no automatic Git commit/push.
2. Build the final source tree and verify uploaded Linux ffprobe is present in deployment tracing.
3. Deploy the tested local source to existing Firebase backend only when the rollout is authorized.
4. Verify health reports Firestore, unauthenticated entity/reset requests fail, and `/control` works.
5. Sign in using the private handoff, change the temporary password, create the first real operator,
   then test one real screen/camera. All older paired devices need fresh pairing codes.
6. Do not migrate synthetic demo delivery, delete the old deployment, or retire Vercel silently.

Remaining pilot gates: physical counting ground truth, actual device commissioning, venue LOIs,
India application-hosting decision if required, full offline media requirements, and WP6 accounting.

## Official references checked

- [Firestore database-specific IAM and named databases](https://firebase.google.com/docs/firestore/manage-databases)
- [App Hosting supported locations](https://firebase.google.com/docs/app-hosting/about-app-hosting#app-hosting-locations)
- [Next.js September 22 security release](https://nextjs.org/blog/nextjs-security-update-september-22-2026)
