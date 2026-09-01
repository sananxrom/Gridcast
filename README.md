# Gridcast — Phase 1 Prototype

Four surfaces, one small Express API, real webcam people-counting.

## Run locally

```bash
npm install
npm start          # → http://localhost:4000
```

Data persists to `data/db.json`. Delete it (or POST `/api/reset`) to reseed.

## Surfaces

| URL | Who | What |
|---|---|---|
| `/` | — | Sign in — pick a demo account |
| `/admin.html` | Sanan (Gridcast) | All orgs, all screens, campaigns, creative approvals, device health |
| `/operator.html` | Ravi / Priya | Own screens only: pricing factors, screen codes, advertisers, campaigns, settlement |
| `/advertiser.html` | Fitline Gym | Read-only delivery: plays, people present, budget used |
| `/player.html` | a screen | Enter screen code → plays the loop, counts people |

## Trying it end to end

1. Sign in as **Ravi Mehta** → *My screens* → copy a screen code (e.g. `A1B2C3`).
   Codes are **permanent and locked to the screen** — replacing the box reuses the same code.
2. Open `/player.html` in another tab or on a phone → enter the code → allow the camera.
3. It plays the approved creatives on a loop and counts people in frame every 2 seconds.
4. Back in **Admin → Overview** or **Advertiser**, plays and people-counts appear.

The player remembers its screen in `localStorage`. Clear site data to re-pair.

## People counting

TensorFlow.js + COCO-SSD (`lite_mobilenet_v2`) in the browser. Counts `person` detections above 0.5 confidence, samples every 2s, averages across a play, and posts `avg_persons`.

**This is presence sampling, not unique reach.** No tracking, no re-identification. A play on a screen with no camera, or with the camera denied, is recorded as `measured: false` with a null count — never zero, never estimated.

Camera requires HTTPS or localhost. Vercel serves HTTPS, so it works there.

## Deploying to Vercel

```bash
git init && git add -A && git commit -m "Gridcast prototype"
# push to GitHub, then import the repo in Vercel
```

Serverless has no writable filesystem, so add a KV store or the data resets on every cold start:

1. In the Vercel project → **Storage** → create an **Upstash Redis** (or Vercel KV) database and connect it.
2. It sets `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically. Redeploy.

`GET /api/_health` reports which store is active (`redis` / `file` / `memory`).

## Campaigns

Click any campaign row to open its detail page: per-screen delivery with share of total,
per-creative performance, and the full play log with people counts and sample counts.
Pause / resume from the header.

**+ New campaign** builds one in four steps — client and dates, rate and budget,
screens, creatives. Rate is **per play** (accrues as plays log) or **flat fee**
(accrues evenly across the flight). Screens can be ticked individually or selected
by group: static lists, or dynamic rules over venue type / size / location tier.
Creatives can be pasted in as YouTube URLs or picked from the advertiser's existing set;
new ones start `pending` and must be approved before they play.

## After redeploying over an existing KV store

The seed only runs when the store is empty. If you deployed an earlier build, the saved
data has no screen codes and no groups. Reset it once:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/reset
```

## Not built

Tracking, dwell, unique reach, dynamic pricing, RTB, network campaigns, automated billing, real payments. See `06-phase1-build-spec.md`.
