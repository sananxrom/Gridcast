# What the dashboards show, and why most of it breaks at 100 screens

> Implementation update, 25 September 2026: see [22-reporting-release.md](22-reporting-release.md) for implemented scope, corrected attribution/coverage semantics, verification and deliberate limits. The proposal below records the original reasoning.
**Written:** 25 Sep 2026 · **Base:** `93eb350` · live `build-2026-09-24-007` (`5b18cae`)
**Status:** analysis + build plan. Raised by Sanan ("recent plays don't make sense at 100s of screens").
**Scope:** platform admin overview, operator overview/screens/analytics, screen detail.

---

## The one bug, wearing twelve costumes

Sanan's observation is right but it understates the problem. The issue is not that a list gets long.
It is that **every aggregate in the product is computed in the browser by filtering a bounded,
recency-ordered slice of the play firehose.**

`lib/access.ts:403`:

```ts
const plays = db.plays.filter(...).slice(-1500);
```

`lib/firestore-store.ts:276-282` does the same server-side with `HISTORY_LIMIT = 1500`, ordered by
`ended_at desc`, and returns `history.truncated`. Everything downstream — sparklines, averages,
counts, exports — is a `.filter()` over that array.

**What 1,500 rows actually covers.** A screen with a 60 s loop carrying three 20 s ads produces
~180 plays/hour. Over a 14-hour trading day that is ~2,520 plays per screen per day.

| Network size | Plays/day | The 1,500-row window is… |
|---|---|---|
| 4 screens (today) | ~10 000 | about 3.5 hours |
| 25 screens | ~63 000 | about 20 minutes |
| 100 screens | ~252 000 | about **5 minutes** |
| 300 screens | ~756 000 | about **100 seconds** |

Everything below follows from that one table.

**Why this is dangerous rather than merely wrong.** It does not throw. It does not render an error
state. It returns a plausible, precise-looking number that quietly redefines itself from "this month"
to "the last ninety seconds" as the business grows. The failure arrives exactly when the company is
finally worth something, and it arrives as an operator disputing an invoice.

**We already solved this — for one column.** Doc 16 established: *settlement is computed from
authoritative buckets, never from the truncated receipt history.* That discipline is correct and we
applied it only to money. Every other number on every other page still comes from the firehose.
This document extends the same rule to the rest of the product.

---

## Part 1 — The specific defects

### 1.1 "Play reports: 1,500" — a UI that displays its own cap

`app/admin/page.tsx:168` and `:270`, and operator analytics:

```tsx
<Stat label="Play reports" value={d.plays.length.toLocaleString('en-IN')} hint="across network" />
```

Past the cap this renders `1,500` forever, formatted with a thousands separator so it reads like a
measured figure. A platform admin will report it to an investor. **Worst defect in the product** —
not because it is the most wrong, but because it is the most confidently wrong.

### 1.2 Recent plays as a feed (admin overview, `:172-180`)

`d.plays.slice(-12).reverse()`. At 300 screens the network produces ~300 plays/minute, so those
twelve rows cover **about two seconds**. It is a lava lamp: motion that proves the pipe is alive and
carries no other information. Twelve rows is not "too long" — twelve rows is *too short to mean
anything*, which is the same defect from the other end.

No decision hangs on an individual play. The decisions that exist are: *is anything not playing that
should be?*, *is anything playing but not billing?*, *has a camera stopped measuring?*

### 1.3 "Recent plays" on screen detail (`screen-detail.tsx:211`, `lib/api.ts:367`)

Server-capped at 40 rows — better, but at 180 plays/hour that is **13 minutes**, presented under a
heading that implies a log. Sanan is right that it is the wrong component.

But it should not be deleted. There is exactly one job it does well: **proving a specific screen
works, during install or during a dispute** — the row carries source, billable, model version and
measured persons, which is the evidence trail. Keep the rows, move them behind a *Diagnostics* tab on
the screen, time-bound them explicitly ("last 40 reports · 13 min"), and stop presenting them as
history.

### 1.4 Per-screen counts truncated by *other screens'* traffic

`lib/api.ts:364`:

```ts
stats: { plays: plays.length, playsToday: plays.filter(p => p.ended_at.slice(0,10) === today).length, ... }
```

`plays` here is the **org-wide** window, ordered by recency. So a quiet pharmacy screen's "Play
reports today" is silently truncated by a busy mall screen in the same org. The quiet screen can show
**0 plays today while playing normally all day** — because the window filled up with someone else's
traffic. Same defect in `plays7` on the operator screen card (`app/operator/page.tsx`).

This one produces a support ticket that looks like a device fault and is not.

### 1.5 "Avg people / play" is three different numbers, and the UI picks one by accident

```tsx
const m = d.presence.filter(p => p.measured);
m.reduce((a,b) => a + b.avg_persons, 0) / m.length
```

The mean of *rows in the window*. That is traffic-weighted: a busy screen with low dwell dominates,
because it contributed more of the last 1,500 rows. It is not the mean across screens, not the mean
across the day, and not the mean an advertiser would recognise. At four screens the three converge.
At a hundred they do not.

A presence figure must state its denominator. Pick one deliberately — **mean persons per measured
play, over an explicit period** — and put the period in the label.

### 1.6 Sparklines flatten silently

`trendScreen` → `daySeries(...)` over presence joined to the truncated plays, bucketed into seven
days. Past the cap the older buckets are empty not because nothing played but because those rows fell
out of the window. A seven-day trend renders as a spike on the right and nothing behind it, which
reads as "this screen just started working."

### 1.7 Export exports the window, not the query

`exportName="screen-plays"` / `"recent-plays"` on `DataTable` serialises the loaded rows. An operator
who exports a delivery report for an advertiser hands over 40 rows and calls it a month.
**This is the one that becomes a commercial dispute**, and it is one click away on a page that
otherwise looks authoritative.

### 1.8 There is no time control anywhere in the product

Not a gap in a component — a missing primitive. Every figure is either "the loaded window" or
"lifetime". There is no today / 7d / 30d / custom-range anywhere, so there is no way for the UI to
*ask* for a correct number even if the data existed. Every defect above is downstream of this.

### 1.9 The screens grid does O(screens × plays) work per render

`view === 'screens'` maps every screen to a card, each calling `presFor(s.id)`, `avgOn(s.id)`,
`plays7(s.id)`, `bookedOn(s.id)` — each a full scan of `d.presence` / `d.plays` / `d.campaigns`. 300
screens × 1,500 presence rows = 450 000 comparisons per metric per render, plus 300 venue photos with
no virtualisation or pagination. The page will be visibly janky long before the data is wrong.

### 1.10 `/bootstrap` is a single payload that grows on every axis

One endpoint returns orgs, screens, campaigns, advertisers, creatives, groups, devices, configs,
settlement buckets, **plays and presence**. Every mutation calls `reload()`, which refetches all of
it: pausing one campaign re-downloads the entire network. At 300 screens and 1,500 plays with
presence joined, that is a multi-megabyte response on a shop-floor connection, per click.

---

## Part 2 — The fix

### 2.1 The rule

> **No displayed aggregate is computed from the receipt window.** Counts, averages and trends come
> from rollups. The receipt window is for evidence, diagnostics and a liveness proof — never for a
> number anyone acts on.

This is doc 16's settlement rule, generalised. It is the same sentence with "settlement" removed.

### 2.2 `screen_day` — the rollup that fixes nine of the ten defects

A sibling of `settlement_bucket`, written in the same transaction as the play receipt, idempotent on
the play id, attributed to the **delivery** day (so an offline backlog lands in the day it played):

```
screen_day/{screen}__{YYYY-MM-DD}
  org_id: <screen's org>          ← existing cross-org write guard passes untouched
  screen_id, date
  plays_rendered, plays_billable, plays_not_rendered
  plays_measured, presence_sum, presence_n        (mean = sum/n, denominator visible)
  campaigns_seen: { <campaign_id>: <count> }      (bounded by slots, not plays)
  uptime_minutes, first_at, last_at
  updated_at
```

Bounded by screens × days: 300 screens × 365 days = ~110 000 rows/year. Nothing.

What it buys:

| Today | With `screen_day` |
|---|---|
| "Plays 7d" = scan of a truncated array | sum of 7 rows, exact |
| "Play reports today" = truncated by sibling screens | one row, exact |
| Avg people = mean of window rows | `presence_sum / presence_n` over a stated period |
| Sparkline = day-bucketed window | 7 rows, no scan |
| "Play reports: 1,500" | real lifetime total, or a stated period |
| Export = 40 loaded rows | query the buckets for the range |
| O(screens × plays) per render | O(screens × days-in-range) |

Presence keeps its provenance: `presence_n` is the count of **measured** plays, so an unmeasured play
lowers the denominator rather than counting as zero. *Unmeasured is null, never zero* — the rule
survives the rollup, because the rollup stores the denominator instead of the average.

### 2.3 What the dashboards show instead

Three principles, in order.

**Exceptions, not events.** The admin overview's job is *what is not normal right now*:

- screens that should be playing and are not (scheduled, paired, no report in N minutes)
- screens where the **billable rate** dropped — rendered but not billing means clock skew, camera
  policy, or assignment failure, and it is money leaking in real time
- screens where **measurement** stopped but playback continued — a dead camera is a revenue event
  under our own positioning, not an IT ticket
- creatives awaiting approval, budgets near commitment

Each row is an exception with a screen to open. An empty list is the correct and desirable state, and
it should read as reassurance, not as an empty table.

**Rates with denominators, not counts.** "97.2% of expected plays delivered today (243 110 /
250 400)" is scale-invariant and immediately actionable. "252,431 plays" is neither. Expected plays
is derivable: booked appearances × operating minutes ÷ loop length.

**Recency as a liveness proof only.** Replace the recent-plays table with one line — *"last report 8 s
ago from Sector 17 Café · 312 screens reported in the last 5 min"* — plus a sparkline of network
plays/minute from the rollup. That delivers everything the feed delivered (the pipe is alive) in one
row instead of twelve that go stale in two seconds.

### 2.4 The time control (do this first)

A single range control in the page header — Today / 7d / 30d / This month / Custom — that every
figure on the page reads from, and that every export serialises into its query. Until it exists, no
correct number can be requested. It is also the cheapest item here.

### 2.5 Split `/bootstrap`

`/bootstrap` keeps the entities the shell needs to render (orgs, screens, campaigns, advertisers,
creatives, groups, devices, configs, caps) and **drops `plays` and `presence` entirely**. Aggregates
move to `/metrics?scope=…&from=…&to=…` served from the rollups; receipts move to a paged
`/plays?screen=…&from=…&to=…` used only by diagnostics and export. `reload()` after a mutation
refetches entities, not the firehose.

### 2.6 Pagination and virtualisation

The screens grid pages (or virtualises) and computes its per-card figures from the rollup range, not
from per-card array scans. Same for any table that can exceed a few hundred rows.

---

## Part 3 — Order, and one warning

1. **Time range control** — no correct number can be asked for without it. Cheapest, unblocks the rest.
2. **`screen_day` rollup**, written with the play receipt alongside `settlement_bucket`. Same
   transaction, same idempotency, same delivery-time attribution. These two should be built together;
   they are the same mechanism with different columns.
3. **Repoint every figure** at the rollup; delete the client-side scans.
4. **Exception-first overview**, replacing the recent-plays feed on admin and adding the billable-rate
   and measurement-dropout signals, which do not exist today in any form.
5. **Split `/bootstrap`**; page the screens grid.
6. **Move screen-detail plays behind a Diagnostics tab**, time-bounded and labelled as evidence.
7. **Fix export** to serialise the query, not the loaded rows.

### The warning

**The demo network will hide all of this.** Four operators, a dozen screens, a few hundred seeded
plays — every number on every page will be correct, every list will be a sensible length, and the
product will look finished. None of the defects above are visible below roughly 25 screens.

So this cannot be validated by looking at the demo. It needs a **synthetic load fixture**: one
operator, 200 screens, 30 days of plays at realistic loop density (~15 million rows), and an assertion
suite that every displayed figure matches a figure computed independently from the full dataset.
That fixture is also what the burn-in and chaos work in doc 10 needs, so it is not extra scope —
it is the same fixture arriving earlier.

## Do not

- Do not compute a displayed aggregate from `d.plays` or `d.presence`.
- Do not display a count that is silently capped, and never format a cap with a thousands separator.
- Do not present a play feed as history at any scale.
- Do not export the loaded rows under a name that implies the full range.
- Do not report a presence average without its period and its denominator.
- Do not raise `HISTORY_LIMIT` as a fix. It moves the cliff; it does not remove it.
