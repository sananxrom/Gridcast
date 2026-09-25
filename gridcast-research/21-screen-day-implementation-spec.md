# `screen_day` — implementation spec

> Implementation update, 25 September 2026: see [22-reporting-release.md](22-reporting-release.md) for implemented scope, corrected attribution/coverage semantics, verification and deliberate limits. The proposal below records the original reasoning.
**Written:** 25 Sep 2026 · **Base:** `6c86627` · live `725b90f` / `build-2026-09-24-012`
**Status:** build spec for Codex. Implements doc 17 §2.2. Nothing here is implemented.
**Prepared by Claude in the folder so Codex reviews and ships rather than authors.**

Every line below was checked against the working tree. Line numbers are given for orientation;
**search for the quoted code, not the number** — both agents are editing this file.

---

## 0. What already landed, and what this is not

Already in the tree, additive, `tsc` clean, node suite at baseline:

- `app/globals.css` — two AA contrast fixes (`--warn` ink 2.97 → 5.72, `--onair-foreground`
  white → warm near-black, 2.67 → 6.59). Behaviour change, small, verified. See the 11:06 log entry;
  it also retracts doc 18 §A.0, which was wrong.
- `lib/metrics.ts` — **new file, nothing imports it.** One definition per displayed metric.
- `components/ui/explain.tsx` — **new file, nothing imports it.** The `(i)` popover.

Those two new files cannot change what any page renders. Wiring them up is step 5 below.

**This spec does not touch:** the settlement buckets, the budget reservation path, the assignment
lifecycle, rotation, or anything that decides whether a play is billable. `screen_day` is a
**read-model**. If implementing it requires changing a billing predicate, stop — something has been
misread.

---

## 1. The rule this exists to enforce

> No displayed aggregate is computed from the receipt window. Counts, averages and trends come from
> rollups. The receipt window is for evidence, diagnostics and a liveness proof — never for a number
> anyone acts on.

`lib/access.ts:403` is `db.plays.filter(...).slice(-1500)`; `lib/firestore-store.ts:19` sets
`HISTORY_LIMIT = 1500`. At ~2,520 plays/screen/day that window is ~3.5 h at 4 screens and ~5 min at
100. Every dashboard figure is a `.filter()` over it.

The worst instance is customer-facing: `app/advertiser/page.tsx:59` renders `myPlays.length` as
**plays delivered** — the number an advertiser is invoiced against — from the truncated window.

---

## 2. The document

One row per screen per **delivery** day. Written in the receipt transaction, beside
`accrueSettlement`.

```
screen_day/{screen_id}__{YYYY-MM-DD}
  id                 same as the document key
  org_id             the SCREEN's org — so lib/firestore-store.ts:277 write guard passes untouched
  screen_id
  date               YYYY-MM-DD in IST, from the delivery time (see §3)

  plays_rendered     rendered === true, paid only
  plays_not_rendered rendered === false, paid only
  plays_billable     billable === true
  plays_filler       assignment.kind === 'filler', regardless of rendered

  plays_measured     paid plays with presence.measured === true
  presence_sum       sum of avg_persons over those plays        ← store the numerator
  presence_n         count of those plays                       ← and the denominator

  filler_measured    filler plays with presence.measured === true
  filler_presence_sum
  filler_presence_n

  airtime_ms         sum of playing_duration_ms over rendered paid plays
  filler_airtime_ms  same for filler

  campaigns_seen     { [campaign_id]: rendered_count }   bounded by advertiser slots, not play volume
  nonbillable        { [reason]: count }                 from the existing `reasons` array

  first_at, last_at  ISO, delivery time
  updated_at         server receive time
```

**Why the sum and the count, never the mean.** *Unmeasured is null, never zero.* Storing
`presence_sum / presence_n` separately means an unmeasured play lowers the denominator instead of
dragging the average toward zero, and lets a caller choose row-weighted or screen-weighted
deliberately rather than by accident. Never add a `presence_avg` field.

**Why filler is separate and still measured.** Filler occupies the camera. Those samples must never
reach an advertiser's number, and they are worth keeping. They are **presence recorded against no
campaign** — not footfall, not reach, not unique visitors.

Size: screens × days. 300 screens × 365 = ~110k rows/year.

---

## 3. Where it is written

`lib/devices.ts`, currently line 272:

```ts
  accrueSettlement(db,play,assignment,playedAt);
```

Add a sibling **immediately before** it:

```ts
  accrueScreenDay(db,play,assignment,screen,playedAt,presenceRow);
  accrueSettlement(db,play,assignment,playedAt);
```

**The ordering is the whole point.** `accrueSettlement` (`lib/settlement.ts:55`) opens with:

```ts
if (!play.billable || assignment.rate_type !== 'per_play' || !assignment.econ_version) return;
```

The plays it discards — non-billable, non-rendered, filler, flat-rate — are exactly what a delivery
rate and a billable-rate-drop signal are made of. `screen_day` must therefore be a **separate call
placed before that early return**, never an extension of `accrueSettlement`. Folding it in would
rebuild the defect it exists to fix.

Everything needed is already in scope at that point: `play` (carries `rendered`, `billable`,
`org_id`, `screen_id`, `campaign_id`, `nonbillable_reasons`, `server_received_at`), `assignment`
(carries `kind`), `screen`, and `playedAt` — the clock-corrected delivery time, `start + offset`.
Confirm how the presence row is available at that line and pass it, rather than re-deriving it.

**Date derivation must match settlement.** `lib/settlement.ts:31`:

```ts
const date = new Date(at + 330 * 60e3);   // IST
```

Use the same `+330` shift and take `.toISOString().slice(0,10)`. A `screen_day` that disagrees with
its `settlement_bucket` about which day a play belongs to is worse than no rollup.

**Idempotency.** The receipt path already rejects duplicates before reaching this line — the same
guard that protects `accrueSettlement`. Do not add a second mechanism; rely on the existing one and
add a test that proves a replayed receipt moves no counter.

**Late reports.** A backlog flushed 48 h later lands in the day it **played**, never the day it
arrived. This follows automatically from keying on `playedAt`; test it explicitly.

---

## 4. Store wiring

`lib/firestore-store.ts`:

1. Add `'screen_day'` to `COLLECTIONS` (line 18), beside `'settlement_buckets'`.
2. Prefetch the row in the receipt transaction the way line 259 prefetches the settlement bucket —
   `referenced(tx,'screen_day',[key],snapshot.screen_day)` — so the write is a read-modify-write
   inside one transaction, not a blind put.
3. Read paths: org-scoped `[['org_id','==',orgId]]`, plus `screen_id` and `date` range filters for
   the metrics endpoint.
4. `firestore.indexes.json`: composite on `(org_id, date)` and `(screen_id, date)`. Create and wait
   for READY **before** rollout — the existing discipline, 57 indexes today.

The `org_id` is the screen's org, so the cross-org write guard at line 277 needs **no exception**.
Do not widen that guard. It is the single control preventing tenant corruption.

---

## 5. Repointing (a separate commit from §3–4)

Land the writer first and let it accumulate. Read from it only once rows exist.

| today | replace with |
|---|---|
| `app/advertiser/page.tsx:59` `myPlays.length` | `sum(plays_rendered)` over the range |
| `app/advertiser/page.tsx:61` measured ratio | `sum(presence_n) / sum(plays_rendered)` |
| `app/admin/page.tsx:168,271` `d.plays.length` | real lifetime or period total — **never a capped count** |
| `app/admin/page.tsx:180` recent-plays feed | liveness line + exception list (doc 17 §2.3) |
| `lib/api.ts:364` `playsToday` | one `screen_day` row |
| `app/operator/page.tsx` `plays7` | 7 rows |
| avg people, everywhere | `presence_sum / presence_n` over a stated period |
| `trendScreen` sparklines | 7 rows, no scan |
| `exportName` CSV | the query, not the loaded rows |

Each figure gets `<Explain metric="…" period={…} completeness={…} />` from
`components/ui/explain.tsx` as it is repointed. `completeness.truncated` should be fed from
`history.truncated`, which the API already returns — that is the per-number version of the banner in
`components/views/history-notice.tsx`.

**Do not repoint anything before the writer has been running.** A rollup read against an empty
collection renders zeros, which is worse than a truncated number because it looks deliberate.

---

## 6. Tests

New file `tests/screen-day.test.cjs`, in the style of `tests/settlement.test.cjs`:

1. A rendered paid play increments `plays_rendered`, `airtime_ms` and `campaigns_seen[campaign]`.
2. A non-rendered play increments `plays_not_rendered` and **not** `plays_rendered`; its
   `nonbillable` reason is recorded.
3. A rendered-but-not-billable play increments `plays_rendered` and not `plays_billable` — the
   delivery-rate/billable-rate gap.
4. A measured play adds to `presence_sum`/`presence_n`; an **unmeasured** play adds to neither while
   still counting in `plays_rendered`. Assert the derived mean is unchanged by the unmeasured play.
5. Filler lands only in `plays_filler`/`filler_*` and never in the paid counters or
   `campaigns_seen`.
6. A duplicate receipt moves no counter.
7. A play delivered on day D and reported on day D+2 lands in D's row.
8. Two screens in the same org write two rows; a screen in another org is untouched by either.
9. `screen_day` and `settlement_bucket` agree on the period for a play near the IST midnight
   boundary — the 18:30 UTC edge.
10. `sum(plays_billable)` over a period equals `settlement_bucket.billable_plays` for the same
    campaign/screen/period. **This is the invariant that proves the read-model did not drift.**

Run against the **195 pass / 4 fail / 4 skip** baseline — the four failures are `ffprobe-static`
missing a linux/arm64 binary and are environment, not code. On macOS the mirror-image failure
appears; Codex has hit it.

---

## 7. Order

1. `accrueScreenDay` + store wiring + indexes + `tests/screen-day.test.cjs`. Ship. Let it fill.
2. A `/metrics?scope=&from=&to=` read endpoint over the rollup.
3. Repoint the advertiser page first — it is the customer-facing wrong number.
4. Repoint operator and admin; delete the client-side scans.
5. Wire `Explain` as each figure moves.
6. Exception-first overview, `/bootstrap` split, grid pagination — doc 17 §2.3–2.6.

## Do not

- Do not fold this into `accrueSettlement`.
- Do not store a mean. Store the sum and the count.
- Do not let filler presence reach an advertiser figure.
- Do not widen the cross-org write guard.
- Do not repoint a figure before the writer has produced rows.
- Do not raise `HISTORY_LIMIT` instead. It moves the cliff; it does not remove it.
