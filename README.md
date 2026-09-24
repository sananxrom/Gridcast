# Gridcast — Phase 1 pilot build

Next.js 15 App Router · React 18 · TypeScript · server-side Firestore transactions.

## Local development

```bash
npm ci
cp .env.example .env.local
# Set a private GC_DEMO_PASSWORD (12+ characters) and GC_AUTH_SECRET (32+ characters).
npm run dev
```

A fresh local file database uses explicitly configured demo credentials. Existing
files are never reset automatically. Demo data is synthetic and labeled. Production
requires Firestore, a real signing secret and an explicitly provisioned account;
production never seeds or resets a database.

## Operator journey

1. Create a screen, recording its operating window and advertiser capacity.
2. Generate a one-use pairing code in screen details; enter it on `/player` within
   ten minutes. Re-pairing revokes the old device credential.
3. Create an advertiser and creative. Upload MP4/WebM video (up to 25 MB); the server
   checks duration and dimensions. Platform approval remains a separate step.
4. Book explicit appearances per screen and loop. Pending, active and paused bookings
   reserve capacity; drafts, complete and cancelled bookings release it. Group selection
   copies its current screen list into the campaign; membership never expands silently.
5. Activate the campaign. Unused loop time is blank and never generates a play report.

Legacy YouTube creatives are supported online. Uploaded video variants use the closest
aspect ratio with letterboxing. Saved booking prices retain their original reference;
changing a screen's quote does not rewrite past campaign agreements.

## Measurement and delivery

The browser runs COCO-SSD `2.2.3/lite_mobilenet_v2` with TensorFlow.js `4.22.0`.
Model files are served from `public/models/coco-ssd`, with source and SHA-256 records.
The applied confidence setting and two-second sampling interval govern counting.

Presence means average people in front of the screen while an ad plays. It is not
unique reach, attention or an impression count. A camera/model failure produces
`measured:false`, a null count and zero samples. Only counts leave the device;
remote camera previews and frame upload/read endpoints are removed.

Reports carry device start/end times, server receipt, exact model/configuration version
and source. Billability requires observed playback progress and duration; this remains
a report from authenticated software, not hardware attestation or independently audited
physical display. Camera accuracy still requires a real ground-truth test.

The IndexedDB queue retains up to 5,000 reports and retries for 72 hours. Failed reports
remain visible/exportable. Assignment validity is ten minutes: a disconnected player
stops starting new ads when authorization expires. The queue does not provide offline
YouTube playback or promise 30 minutes of uninterrupted offline video.

## Data and cloud arrangement

- Named Firestore database `gridcast`, Mumbai (`asia-south1`), Enterprise/native.
- Private video bucket `gridcast-508011-media-india`, Mumbai, public access blocked.
- Existing Firebase App Hosting backend remains Singapore. App Hosting currently offers
  no India region; an India runtime would need a separate hosting migration.
- Camera images and synthetic demo delivery are not imported into production.
- Server APIs enforce ownership/capabilities. Direct client Firestore access is denied.
- Writes are per-document transactions, including billing accrual and event deduplication.
- Dashboard history is capped at 1,500 reports with visible truncation; it is not an
  unlimited all-time analytics system. Domain reads stop safely at 2,000 records until
  pagination is implemented. High-volume telemetry needs further repository scaling.

`apphosting.yaml` declares the runtime configuration. Cloud preparation does not mean
this code is live. Consult the latest `AI-LOG.md` entry and the through-WP5 handoff for
actual rollout status. Deployment must preserve the current site until the tested build
is deliberately rolled out; do not run a production reset.

## Verification

```bash
npm test
npx tsc --noEmit --incremental false
npm run build
node --test tests/device-queue.browser.cjs tests/player.browser.cjs
```

The browser tests use isolated Chrome and synthetic media/model results. Emulator tests
are separately guarded to `FIRESTORE_EMULATOR_HOST=127.0.0.1:8185` and a demo project;
they never target cloud data. See `tests/firestore-emulator.test.cjs`.

## Still outside this build

WP6 settlement/accounting; automated invoicing; advertiser self-signup; hardware-attested
playback; validated camera accuracy; indefinite event analytics; full offline media caching.
Budget exhaustion warns an operator and does not automatically stop campaigns.
