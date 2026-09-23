# Gridcast — Next Steps

**Written:** 23 Sep 2026 · **Against:** `sananxrom/Gridcast` @ `22c7936` (Mac) / `d20b7a0` (cloud checkout)
**Status of this doc:** engineering plan. Supersedes nothing; it sits after `2.1 Phase 1 Build Spec` and `3.2 Implementation Record`.

---

## 0. Where the build actually stands

The product surface is further along than the substrate under it.

**Built and working:** four role-scoped surfaces (operator / admin / advertiser / platform), real sign-in (PBKDF2 + HMAC session tokens), the device-config engine with four-layer resolution and server-enforced locked keys, screens with factor-based pricing and drift detection, campaigns → creatives → playlist, a web player that runs from its resolved config and counts people on-device, org/profile/team management, and a seeded demo dataset that makes all of it demonstrable.

**Not built:** the trust layer. Every number the product sells rests on an endpoint anyone can POST to.

Concretely, from an audit of the current tree:

| Hole | Where | Effect |
|---|---|---|
| `POST /api/reset` is unauthenticated | `lib/api.ts:39,503` | One curl wipes and reseeds production |
| Device routes accept a bare `screen_id`, no token | `lib/api.ts:49-51` | Anyone can inject billable plays and arbitrary `avg_persons`; `accrued_spend` moves on that input |
| No org check on ~12 routes | `screen/:id`, `campaign/:id`, `config/*`, `creative/:id/approve`, `settings` | Any signed-in user of any org reads and mutates another operator's screens, pricing and configs by id |
| `GC_AUTH_SECRET` has a hardcoded fallback | `lib/auth.ts:11-13` | The fallback string is in the public repo — a deploy missing the var can have `platform_admin` tokens forged |
| Every seeded account shares the password `gridcast` | `lib/seed.ts:56-57` | Including `sanan@xrom.in`, `must_change: false` |
| `POST /settings`, `POST /org` have no capability check | `lib/api.ts:368,406` | Any user rewrites platform settings or creates an org + its admin login |
| Privilege decided by request body | `lib/api.ts:392` — `body._as === 'platform_admin'` | Client-supplied, not token-derived |

`transparent vertically, isolated horizontally` is the stated rule. Horizontal isolation currently exists in exactly one place — `GET /bootstrap`'s `scope()` — and nowhere else.

**So the next step is not a feature.** It is making the platform's own claims true, in this order: authorization → device identity → measurement provenance. Everything in §5 onwards is worth less until those three land, because it is all computed from data that can be fabricated.

---

## 1. WP0 — Deployment integrity (½ day)

Two deploy targets currently exist: Vercel (`gridcast-mu.vercel.app`, referenced in the platform config baseline at `lib/seed.ts:141`) and Firebase App Hosting. Pick one. Two live origins with two databases means two versions of the truth and doubled attack surface.

Recommendation: **Firebase App Hosting**, since `apphosting.yaml` now declares the env block, and drop the Vercel deployment — or the reverse; the point is to stop maintaining both.

1. Confirm the three secrets resolve at runtime: `GC_AUTH_SECRET`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`.
2. `GET /api/_health` must report `"store":"redis"`. If it reports `"file"`, data lives on a per-instance tmpfs with `minInstances: 0` — every cold start reseeds and parallel instances diverge.
3. Delete the fallback in `lib/auth.ts:13`. Throw on boot instead:
   ```ts
   const SECRET = process.env.GC_AUTH_SECRET;
   if (!SECRET) throw new Error('GC_AUTH_SECRET is not set');
   ```
   A deploy that fails loudly is strictly better than one that signs tokens with a public constant.
4. Gate `POST /reset` behind `platform_admin` **and** an explicit `GC_ALLOW_RESET=1`, or delete the route.
5. Remove the shared demo password. Seed users with `must_change: true` and no known password; issue the first platform-admin credential out of band.

**Acceptance:** `_health` reports redis; `curl -X POST .../api/reset` returns 401; no password string exists in `lib/seed.ts`; a deploy without `GC_AUTH_SECRET` fails to start.

---

## 2. WP1 — Authorization, done once (2–3 days)

The dispatcher already resolves `claims`, `actor` and `isAdmin` at the top of `handle()`. The gap is that individual routes then forget to use them.

**Change the shape, not each route.** Every `:id` route currently loads its entity ad hoc. Replace with one helper:

```ts
// lib/api.ts
function own<T extends { org_id: string }>(
  rows: T[], id: string, actor: Actor, cap?: Cap
): T {
  const row = rows.find(r => (r as any).id === id);
  if (!row) throw new HttpError(404);
  if (!isAdmin(actor) && row.org_id !== actor.org) throw new HttpError(404); // 404, not 403 — don't confirm existence
  if (cap && !can(actor.role, cap)) throw new HttpError(403);
  return row;
}
```

Then every entity route becomes `const screen = own(db.screens, id, actor, 'screens')`. Routes to convert: `screen/:id` (GET+POST), `screen/:id/exclusions`, `screen/:id/reprice`, `screen/:id/config`, `campaign/:id` (GET+POST), `creative/:id/approve`, `config` (all five), `group/resolve`, `advertiser`, `org/:id`.

Three more fixes in the same pass:

- **Kill blind assignment.** `POST /screen/:id` does `Object.assign(screen, body)` (`lib/api.ts:350`) — a client can set `org_id`, `code`, `monthly_value`. Whitelist the writable fields, exactly as `POST /campaign/:id` already does.
- **Derive privilege from the token.** Delete the `body._as` check at `:392`; read the role from `claims`.
- **Creative approval is platform policy.** `POST /creative/:id/approve` must require `platform_admin`; the operator's own approval is a separate state (`operator_ok`) if you want one.

Write the capability matrix down as a table in code — route → required cap — and assert it in the dispatcher rather than per-handler, so a new route is deny-by-default.

**Acceptance:** a test that signs in as `sales` in org B and, for each route above, gets 404/403 against an org-A id. This is the first thing in the repo that deserves an automated test; `playwright` is already a devDependency with zero specs.

---

## 3. WP2 — Device identity and honest proof-of-play (3–4 days)

Today `POST /pair` returns `token: device.id`, and the player throws it away (`app/player/page.tsx:185-187`), keeping only `screen.id` in localStorage. Every later call is anonymous.

**Device token.** Issue a real one at pairing — same HMAC scheme as `lib/auth.ts`, claims `{did, screen, org}`, long expiry, stored server-side so it can be revoked on unpair. Player persists it and sends `Authorization: Bearer`. Remove `deviceRoute` from the open list; resolve `screen_id` from the token, never from the path.

**Play record integrity.** The server currently fabricates both timestamps and sets `billable: true` unconditionally (`lib/api.ts:246-249`). Change the POST body to carry what only the device knows:

```
{ play_uid, seq_no, started_at_device, ended_at_device, duration_ms,
  campaign_id, creative_id, avg_persons, sample_count, measured, model_ver }
```

Server stores those **plus** `server_received_at` and `clock_offset_ms = server_now - ended_at_device`. `play_uid` is the idempotency key — a replayed batch must not double-bill. `billable` becomes a rule (`duration_ms` within tolerance of the creative's declared duration, seq_no not seen before), not a constant.

**Offline buffer.** `offline_buffer_plays` (5000), `telemetry_batch` and `telemetry_retry_h` are schema-only — nothing reads them (`lib/config.ts:181-192`). Today a failed POST drops the play silently (`page.tsx:52-55`). Retail wifi in Chandigarh will drop out daily; a play lost is revenue lost. Queue to IndexedDB, flush in batches with exponential backoff, dedupe server-side on `play_uid`.

**Heartbeat.** There is no heartbeat route; `last_heartbeat_at` only moves as a side effect of `/play` and `/nowplaying`. A healthy screen with an empty playlist reads as offline after 900 s. Add `POST /heartbeat` on the interval the config already declares (`heartbeat_s: 30`) carrying `app_ver`, `agent_ver`, uptime, free disk, and the applied `config_version`.

**Acceptance:** pull the ethernet on a paired player for 30 minutes of playback; every play lands exactly once on reconnect, with device timestamps and a non-zero clock offset recorded.

---

## 4. WP3 — Measurement provenance (2 days)

Three contradictions, all visible to anyone who looks closely — which, for a company selling measurement, is the whole risk.

1. **The model.** Config declares `model: yolox-tiny` as a *locked* key whose stated reason is "recorded against every measurement as `model_ver`". The player actually loads COCO-SSD `lite_mobilenet_v2` from jsDelivr (`page.tsx:146,214-215`) and the server hardcodes `model_ver: 'coco-ssd@2.2.3'` (`api.ts:248`). Resolve it one way or the other, then make `model_ver` flow from what the device actually ran — never a server literal. Self-host the model files too: a CDN block at a venue firewall currently kills measurement silently.
2. **Frames.** The pairing screen says "No video is stored or transmitted" and `upload_frames: never` / `retain_frames: false` are locked. Meanwhile `preview_frames` ships a JPEG every 5 s and the server persists it for 30 minutes (`page.tsx:121-129`, `api.ts:457-464`). Reconcile: rename the setting to what it does, scope it to a time-boxed setup window with explicit on-screen indication, and change the copy. Under DPDP this is the sentence that matters most in the product.
3. **`config_version`.** Does not exist (0 hits in the repo). Stamp a monotonic version on every config write, have the player report the version it applied on each heartbeat, and surface "config pending / applied" per screen. Without it nobody can answer "is this screen actually running what I set?"

Also: `next()` can fire twice (the `setTimeout` and the YouTube `ENDED` event both call it), double-reporting a play. Guard it with the slot id.

---

## 5. WP4 — The storage decision (1 day to decide, 3–5 to execute)

`data/db.json` is 265 KB with 372 plays — about **470 bytes per play**, and every single mutation re-serializes and re-uploads the entire blob. `GET /bootstrap` already slices to the last 1,500 plays purely to bound the response. There is no locking: two concurrent writes to different entities silently clobber each other on serverless.

20 screens × 12 h × 360 plays/day ≈ 7,200 plays/day ≈ 3.4 MB/day. The blob model breaks within a fortnight of the first real installs, and a single 900 KB preview frame row triples it.

Decide now, before the field pilot writes data you have to migrate:

- **Firestore with real collections** (not a blob — the 1 MB document limit makes a blob impossible anyway). Fits the Firebase deployment, gives per-document writes and indexed queries.
- **Postgres (Neon/Supabase)**, which is what the Phase 1 spec's schema is written against and what row-level security was designed for.

Either way: `plays` and `presence` become append-only and time-partitioned; `frames` leave the database entirely (object storage or nothing); everything else keeps its shape. Keep the `lib/store.ts` adapter seam — that is what makes this a two-file change rather than a rewrite.

---

## 6. WP5 — Inventory correctness (4–5 days)

The pieces that decide what actually plays are the thinnest part of the build.

- **Screens cannot be created.** No `POST /screen`, no UI — screens exist only from `seed()`. Nothing onboards. Build create + the **reverse calculator** from spec §4B (revenue ÷ clients → slot price; ÷ fill rate → capacity value → implied quality factor), which is the only onboarding conversation an operator can actually have.
- **Booking oversells silently.** Campaign targeting is a plain `screen_ids[]`. `advertiser_slots` is displayed and the bar turns hot past it, but nothing blocks. Add the `campaign_screen` join with `slots_per_loop`, and check overlap across the date range against both `advertiser_slots` and loop capacity (`loop_length_s / slot_duration_s`).
- **The eligibility chain is four inline conditions** in the playlist loop (`api.ts:223-227`). Budget exhaustion, slot capacity, operating hours and daypart are not checked — a campaign past 100% of budget keeps playing and keeps accruing. Implement the nine-step ordered chain from spec §4C as one function, and write `eligibility_log` rows. The first support question will be "why didn't my ad run in Sector 22", and today it is unanswerable.
- **Advertiser blocks are dead code.** `exclusions.advertisers[]` is written back as `[]` and never consulted. Advertiser-side venue exclusions don't exist at all.
- **Dynamic group rules are evaluated in two places** (`api.ts:362-366` and `config.ts:307-310`) — they will drift. One implementation. And there is no group editor.
- Creatives are pasted YouTube IDs. Real file upload, duration verification and format/aspect matching are Phase 1 per spec §4; the player's "nearest aspect + letterbox" fallback has nothing to select from today.

---

## 7. WP6 — Money (3 days)

- **Settlement is computed in a React render** (`app/operator/page.tsx:321-343`) and never persisted. It also takes the owner share of *the first matching screen only* (`:325`), so a multi-screen campaign with differing `owner_share_pct` settles wrong. Persist `settlement_line` decomposed, per period, exactly as spec §4E specifies — the decomposition *is* the transparency promise that makes operators willing to release `network_slots` later.
- **No payment records.** `invoice_status` is a three-state enum with no amounts and no dates. Add the `payment` table; reconciliation otherwise lives in a spreadsheet that diverges within a month.
- **Alerts.** One 80% threshold, computed client-side per page load, no 100% alert, nothing persisted, no notification. Make accrual emit an alert row server-side at 80% and 100%.
- **No rate-card versioning.** Factors live directly on the screen and are recomputed in place (`api.ts:354-355`), so a price change silently rewrites what past campaigns were booked against. `screen_rate` with `rate_card_version` + the campaign storing the `screen_rate.id` it booked against is the spec'd design, and it is much cheaper to add before there are real bookings than after.

---

## 8. What runs in parallel, off the keyboard

From spec §7, still not done, still the cheapest way to kill the plan if it deserves killing:

1. **25 venue LOIs** — venue provides TV, power, internet; revenue share; no minimum guarantee. Under 12 of 25 signing and the model as specified does not exist.
2. **Ground truth** — one student, one clicker, three venues, one week, hand-count against the agent's output. This is the only thing that tells you what the presence number is worth, and it is a prerequisite for selling it. It also settles WP3's model question with evidence instead of preference.

Neither is blocked by any of the work above. Both should start this week.

---

## 9. Suggested sequence

| Sprint | Work | Why this order |
|---|---|---|
| 1 (week 1) | WP0 + WP1 | Nothing else is safe to demo to a stranger until org isolation is real |
| 2 (weeks 2–3) | WP2 + WP3 | Makes plays and counts trustworthy; everything downstream is computed from them |
| 3 (week 3) | WP4 decision + migration | Must land before the pilot writes data worth keeping |
| 4 (weeks 4–5) | WP5 | Onboarding + booking + eligibility: what a real operator needs on day one |
| 5 (week 6) | WP6 | Money, once there are real plays to settle |
| Throughout | LOIs + ground truth | Can invalidate the plan; costs ~₹20,000 |

**The single next thing:** WP0, today — it is half a day and it closes an unauthenticated production wipe and a forgeable admin token.

---

## 10. Standing gaps not scheduled above

- No tests of any kind; `playwright` installed with zero specs.
- No Android or Windows player, despite `target_platform` being threaded through the whole config schema.
- 16 `soon:` settings and eight stub pages (Reports, API keys, webhooks, group editor, trends/exports, admin billing).
- Seeded synthetic plays carry `source: 'seed'` but are indistinguishable from real data in every aggregate on every page — they will eventually be quoted at someone.
- Session tokens are 7-day, stored in `localStorage`, with no revocation list — a password change issues a new token but old ones stay valid, contradicting the copy in `components/views/account.tsx:95`.
- Pairing codes use `Math.random()` and `POST /pair` is open and unthrottled.
