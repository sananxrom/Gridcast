# Gridcast — Phase 1 Prototype

Next.js 14 (App Router) · TypeScript · Tailwind · shadcn-style components.
Four surfaces over one API, with real webcam people-counting on the player.

## Run

```bash
npm install
npm run dev          # → http://localhost:4000
```

Data persists to `data/db.json` locally. `POST /api/reset` reseeds.

## Surfaces

| Route | Who | What |
|---|---|---|
| `/` | — | Sign in — pick a demo account |
| `/admin` | Sanan (Gridcast) | All orgs, screens, campaigns, approvals, device health |
| `/operator` | Ravi / Priya | Own screens only: pricing, codes, advertisers, campaigns, creatives, settlement |
| `/advertiser` | Fitline Gym | Read-only delivery |
| `/player` | a screen | Enter screen code → plays the loop, counts people |

## End to end

1. Sign in as **Ravi Mehta** → *My screens* → copy a screen code.
2. Open `/player` in another tab or on a phone → enter the code → allow the camera.
3. Plays approved creatives on a loop, counting people every 2s.
4. Counts appear live on the screen page, in Admin, and in the Advertiser view.

Screen codes are **permanent** — replacing the box reuses the same code.

## People counting

TensorFlow.js + COCO-SSD (`lite_mobilenet_v2`) in the browser. Counts `person`
detections above 0.5 confidence, samples every 2s, averages across a play, posts
`avg_persons`.

**This is presence sampling, not unique reach.** No tracking, no re-identification.
A play with no camera is recorded `measured: false` with a null count — never zero,
never estimated.

Camera needs HTTPS or localhost. Vercel serves HTTPS.

## Design

- **Primary** `#0F766E` teal — settled / verified
- **Warn** `#A16207` ochre — open / pending
- **On air** amber — reserved for a screen that is live, nothing else
- Cool-biased neutrals, dark mode via `.dark`

Tokens live in `app/globals.css`; components in `components/ui` follow shadcn
conventions (`components.json` is configured, so `npx shadcn@latest add …` works).

## Deploy

Push to GitHub, import in Vercel. No build config needed.

Serverless has no writable filesystem — add **Upstash Redis** (Vercel → Storage)
or data resets on every cold start. It sets `KV_REST_API_URL` / `KV_REST_API_TOKEN`
automatically. `GET /api/_health` reports the active store.

**After deploying over an older build**, reset once so the seed matches the schema:

```bash
curl -X POST https://YOUR-APP.vercel.app/api/reset
```

## Not built

Unique reach, dwell, attention, demographics · dynamic pricing · RTB / OpenRTB ·
automated billing · self-serve advertiser signup · group editor · report exports.
Pages that will exist are in the nav marked **soon**.
