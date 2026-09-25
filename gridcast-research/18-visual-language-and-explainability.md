# Making it visual, and making every number explain itself

> Implementation update, 25 September 2026: see [22-reporting-release.md](22-reporting-release.md) for implemented scope, corrected attribution/coverage semantics, verification and deliberate limits. The proposal below records the original reasoning.
**Written:** 25 Sep 2026 · **Base:** `93eb350` · live `build-2026-09-24-007` (`5b18cae`)
**Status:** analysis + build plan. Raised by Sanan: "what can be made more visual — charts, graphs",
"(i) buttons to explain what that info is exactly", and "this also includes campaign dashboards".
**Depends on:** doc 17. Nothing here can be built before the `screen_day` rollup, because today's
numbers are computed from a truncated window (doc 17 §1) and a chart drawn on them is a *convincing*
wrong answer rather than a plain one.

---

## Part A — Visual

> **Correction, 25 Sep 11:06 IST — §A.0 below was wrong and is superseded.** It claimed a normal-sighted
> user cannot tell `--warn` from `--onair`. That measured raw tokens without reading how they render:
> `components/ui/badge.tsx` gives `onair` a **solid fill plus a blinking blip** and `warn` a **12% tint with
> coloured ink**, which already separates them by weight, exactly as the file's own comment says. The
> proposed fix — lightening `--warn` — would have dropped `text-warn` contrast from 2.97 to 1.55, because
> `--warn` is ink, not fill.
>
> The real defects, found by reading the components, were two **AA contrast** failures, both now fixed in
> `app/globals.css`: `--warn` ink 2.97 → **5.72** (36 84% 44% → 34 92% 30%), and `--onair-foreground`
> white-on-orange 2.67 → **6.59** (white → 30 100% 8%). Both fixes are "darker", and both widen
> warn↔onair separation as a side effect. Dark mode needed no change.
>
> **What survives:** a single-hue system cannot carry a *categorical chart* palette, so every chart below
> stays sequential, emphasis or status. Status colours are not a chart palette and must not be validated as
> one — that was the category error.

### A.0 The blocker nobody has hit yet: the palette cannot carry a chart

`app/globals.css:20` states the design rule plainly:

> *"#A16207 ochre — the brand colour, and the only accent hue. States are told apart by weight and
> fill, not by inventing hues."*

That is a good decision and this document does not propose overturning it. But it has an unexamined
consequence: **a single-hue system can carry sequential, emphasis and part-to-whole charts very well,
and cannot carry a categorical chart at all.** Every "five advertisers in five colours" chart is
impossible here, and should be — five generated hues in a 6°-wide amber band are indistinguishable.

There is also a live defect in the status ramp. Converted to hex and run through the standard
separation checks:

| Token | Hex | Meaning |
|---|---|---|
| `--primary` | `#a26907` | brand / action |
| `--warn` | `#ce8312` | open, pending, awaiting approval |
| `--onair` | `#ef8206` | **live, playing now** |
| `--ok` | `#76490f` | settled, verified |
| `--destructive` | `#b81e1e` | offline, failed |

```
[FAIL] Normal-vision separation  worst pair #ef8206 (onair) ↔ #ce8312 (warn)  ΔE 5.8  — floor is 15
[FAIL] CVD separation            same pair  ΔE 2.1 (protan)
[FAIL] Chroma floor              #76489f (ok) chroma 0.092 — reads as grey
```

`--warn` and `--onair` are 4° of hue apart at nearly the same lightness (44% vs 48%). **A person with
normal colour vision cannot reliably tell "awaiting approval" from "on air."** Under protanopia they
are the same colour. These two states mean opposite things — one needs you, one needs nothing — and
they are the two most frequently rendered badges in the product.

**Fix, inside the existing rule.** Do not add hues. Separate the two by *lightness and fill*, which is
what the rule already says the system does:

- `--onair` stays the hottest point and keeps its blink; it is the only filled, saturated badge.
- `--warn` moves materially lighter (or becomes an outline badge on a tinted ground) so the pair
  separates on L, not on hue.
- `--ok` at chroma 0.092 is fine as *ink* and unusable as a *mark*; charts must not use it as a series
  colour.
- Every status keeps an icon and a word beside it. Status is never colour alone — which the existing
  `StatusBadge` already does correctly and must keep doing.

**Consequence for every chart below:** sequential (one hue, light→dark), emphasis (one series in
ochre, the rest in de-emphasis grey), and status (reserved, iconed) only. Where five things genuinely
must be told apart, the answer is small multiples, a table, or fold-the-tail-into-Other — never a
sixth amber.

### A.1 What should NOT become a chart

Worth saying first, because "make it more visual" usually produces worse dashboards.

- **Money.** Settlement is a table. An operator checking what they are owed wants to read a number and
  reconcile it, not estimate it off a bar. Keep `Settlement` tabular.
- **Anything with fewer than five data points.** A four-screen operator's "screens by venue type" is a
  sentence, not a donut.
- **Single ratios.** Slot fill is already a `Progress` meter and that is correct — a pie of two slices
  is the classic mistake.
- **Exception lists.** Doc 17 §2.3 makes the overview exception-first. An exception list must stay a
  list; its ideal state is empty, and an empty chart is a bug report.

### A.2 What genuinely earns a chart

Seven, in priority order. Each says its job, its form and its colour job — decided in that order.

**1 · Network delivery rate over time — the headline.**
Job: trend, one measure. Form: **line, single series, with a target baseline**. Colour: one hue;
the line ochre, the baseline recessive grey, dips below target picked out with the status ramp.
Delivered ÷ expected, daily, from `screen_day`. This is the number that tells Sanan whether his
network worked today, and it does not exist anywhere in the product.

**2 · Fleet health strip — uptime by screen by day.**
Job: compare magnitude across a grid. Form: **heatmap**, screens as rows, last 30 days as columns.
Colour: **sequential**, one hue, more-uptime-darker. 300 screens × 30 days is one screen of pixels
and reveals in a glance what 300 sparklines never will: the screen that quietly stopped, the day the
whole network dropped, the venue chain that fails every Sunday. Highest information density per pixel
in the whole proposal.

**3 · Dayparting — presence by hour of day.**
Job: magnitude across an ordered scale. Form: **column chart, 24 bars**, or a 7×24 heatmap for
day-of-week × hour. Colour: sequential. This is the chart that **sells inventory** — "your café peaks
at 8am and 6pm, and this is what a slot at 8am is worth." It is the single most commercially valuable
visual in the list and it is pure `screen_day` data with an hour dimension added.

**4 · Capacity ladder — sold vs available across screens.**
Job: part-to-whole, many items. Form: **horizontal stacked bar per screen**, sorted by fill. Colour:
sequential two-step (sold darker, free lighter) with a 2px surface gap between segments. Replaces
reading 300 `Progress` bars one card at a time; shows the operator where their unsold inventory is.

**5 · Presence distribution, not just the mean.**
Job: distribution. Form: **histogram**, persons-per-play. Colour: sequential.
A mean of 4.2 people can be a steady 4, or an empty room punctuated by a crowd — and those are
different products to sell. Our whole thesis is that we measure presence honestly; showing only the
mean quietly discards the honesty. Pairs with an explicit `not measured` bucket rendered in grey,
outside the axis, so unmeasured is visibly *absent* rather than folded in as zero.

**6 · Creative A/B comparison.**
Job: before/after per item, two series. Form: **dumbbell** (one hue, two shades), or paired bars with
an explicit confidence caveat. Directly serves the rotation work in doc 16 — and must carry a warning
that hourly rotation is not a weighted experiment (doc 16, Part 2).

**7 · Screen map.**
Job: identity + geography. Form: a **map with status-coloured pins**, clustered. Only once there are
enough screens to make geography a question. Genuinely useful for a field technician's route and for
a pitch; not useful at twelve screens.

### A.3 Build it by hand, do not add a chart library

`package.json` has no charting dependency, and `components/ui/spark.tsx` is a hand-rolled 30-line SVG
that already does the hard part correctly — *it breaks the line on null rather than drawing zero*,
because a screen that played nothing is not a screen that measured nobody. That single line of
judgement is worth more than a library, and no off-the-shelf default preserves it.

Recharts or similar would add ~120 KB to a player-adjacent bundle, impose its own palette, and — the
real cost — make it easy to draw the categorical rainbow that §A.0 forbids. Five primitives, each in
the style of `Spark`, cover all seven charts:

| Primitive | Serves |
|---|---|
| `<Line>` — series + optional baseline, null-breaking | 1, 6 |
| `<Bars>` — vertical/horizontal, stackable, 4px rounded data-ends | 3, 4, 5 |
| `<Heat>` — grid of cells, sequential ramp, null cells struck not zeroed | 2 |
| `<Meter>` — exists as `Progress`; add a target tick | capacity, budget |
| `<Hover>` — crosshair + tooltip, shared by all of the above | all |

Every one is interactive by default: a chart in a browser that cannot be hovered is a picture of a
chart. Every one has a table view behind it — which also satisfies the contrast relief the palette
check flagged, and gives the CSV export doc 17 §1.7 needs.

---

## Part B — The (i) layer

### B.1 For this product it is not a help tooltip, it is the thesis

Gridcast's standing rules are *"the metric is presence, never impressions"*, *"unmeasured is null,
never zero"*, and *"every number carries its provenance."* Today those rules live in the code and in
these documents. **Nowhere in the UI does a number tell you what it is.**

`components/ui/stat.tsx` has a `hint` prop, and it is being used for exactly this and failing at it:

```tsx
<Stat label="Accrued on your screens" value={…} hint="reported lifetime accrual" />
<Stat label="Avg people / play"        value={…} hint="reported presence" />
<Stat label="Play reports"             value={…} hint="across network" />
```

"Reported presence" is not a definition. It does not say measured over what period, from which
screens, excluding what, or whether the underlying read was complete. An operator disputing a number
cannot resolve it from the UI, so they email. **The (i) is the cheapest possible reduction in support
load, and the most direct expression of what the company claims to sell.**

### B.2 Five fields, every time

An explain popover answers the same five questions in the same order, always:

1. **What it counts** — in one plain sentence. *"The average number of people in front of the screen
   while an ad was playing."*
2. **What it excludes** — the honest part. *"Plays where the camera was unavailable are excluded, not
   counted as zero. Diagnostic plays are excluded."*
3. **Where it comes from** — *"Sampled on the device about every 2 seconds during playback, averaged
   per play. The video never leaves the screen."*
4. **Over what period** — *"1–24 September 2026"* — bound to the actual range control, never static
   text.
5. **How complete it is** — *"From 12,402 measured plays of 13,908 total (89% measured)."* Or, when
   the read was truncated: **"Based on a partial read — 1,500 of an unknown total."**

Field 5 is the one that matters most and the one nobody builds. It is also the UI expression of
`history.truncated`, which the API already returns (`lib/firestore-store.ts:281`) and which only
`HistoryNotice` currently surfaces, as one banner for the whole page. Per-number is where it belongs.

### B.3 Make it unskippable: `definition` is a required prop

A convention decays. A type does not.

```tsx
type Definition = {
  counts: string;            // required
  excludes?: string;
  source: string;            // required
  period?: Range;            // from the page range control
  completeness?: { measured: number; total: number; truncated?: boolean };
  seeAlso?: string;          // deep link to the doc
};

<Stat label="Avg people / play" value={…} definition={PRESENCE_DEF} />
```

Make `definition` **required on `Stat`, on chart titles and on numeric `DataTable` columns.** Then a
number without a definition does not compile, the rule is enforced by the build rather than by
review, and every new metric anyone adds inherits the discipline for free. This is a two-hour change
that permanently closes an entire class of drift.

Definitions live in one file — `lib/metrics.ts` — keyed by metric id, so the same wording appears on
the operator dashboard, the advertiser view, the PDF report and the CSV header. One number, one
definition, everywhere. Divergent wording between an operator's screen and an advertiser's report is
precisely how a trust product loses an argument.

### B.4 Mechanics

- An `(i)` glyph, muted, **after** the label, never after the value — it must not interrupt reading
  the number.
- **Click, not hover.** Hover tooltips are unreachable on touch, and a shop-floor operator is often on
  a tablet. `components/ui/popover.tsx` already exists; reuse it.
- Dismiss on outside click and on Escape; focusable, `aria-describedby` wired to the popover.
- Same component on chart titles and on table column headers.
- Bottom line: *"Learn how this is measured →"* deep-linking to the public methodology page. That page
  is a sales asset as much as a help page.

### B.5 Where it goes first

In descending order of how much argument it prevents:

1. **Avg people / play** — the core claim of the company.
2. **Billable vs rendered** — two numbers that differ, where nothing explains why. The definition must
   name the three predicates (`rendered`, `billable`, `measured`) and say that a rendered-but-not-
   billable play is a clock, camera-policy or assignment failure, not a missing play.
3. **Accrued spend** — must state the rate version and fee basis the accrual used, which doc 16 makes
   available for the first time.
4. **Screen status** (live / stalled / offline) — say the actual thresholds in minutes, or every
   status question becomes a message.
5. **Slot fill / advertisers today** — distinct advertisers, not appearances. This is the exact noun
   confusion that took four review rounds to untangle in doc 16; users will hit it too.
6. **Monthly inventory value** — "at full sell-through" is doing enormous work in three words.

---

## Part C — Campaign dashboards

The campaign page and the advertiser page are where this matters most, because they are the only
screens a **paying customer** reads. Everything above applies; these are the additions.

### C.1 The campaign page cannot answer the only question it exists to answer

`components/views/campaign-detail.tsx` is four stacked tables — per-screen, per-creative, settlement,
play log — plus a KPI row and a budget `Progress`. It shows *what has happened*. It cannot show
**whether the campaign is on track**, which is the single question the page exists for.

The budget bar has no time axis. A campaign three days into a thirty-day flight at 80% of budget and
a campaign on its last day at 80% render **identically**. One is a crisis and one is a success.

**Fix — the pacing chart, and it is the headline of the page.** Cumulative delivered against
cumulative expected: a line for actual, a straight recessive baseline from flight start to flight end,
today marked. Form: line + baseline, one hue, emphasis. It answers on-track / ahead / behind in one
glance, gives the operator a reason to call the advertiser before the flight ends rather than after,
and needs nothing that `screen_day` will not already hold.

Beside it, one derived figure with its own (i): **projected final delivery** at the current rate,
against what was committed.

### C.2 The per-creative table invites an A/B conclusion it cannot support

Two creatives, plays each, average people each — laid out side by side, which is an invitation to
read the higher number as the winner. Doc 16 Part 2 establishes that hourly rotation is **not** a
weighted experiment: the salt distributes across the fleet but guarantees no exact split, and
exposure between two creatives is not equalised by construction.

This is an (i) problem before it is a chart problem. The table needs, in the header:

> *Creatives are rotated once per assignment period and distributed across screens by a fixed salt.
> This spreads exposure; it does not equalise it. Treat differences smaller than the exposure gap as
> noise, not as a result.*

Then show the **exposure gap itself** as a column — plays A vs plays B — so the reader can see how
unequal the comparison is. If a real A/B is wanted later, it is a different mechanism (doc 16 §5,
Phase 2), not a nicer chart on this one.

Chart form when it earns one: **dumbbell**, one hue two shades, never two categorical colours.

### C.3 Per-screen delivery should be a sorted bar, not a table of percentages

`Share` already renders a `Progress` per row, which is the right instinct. Sort by share descending
and it becomes a horizontal bar chart for free — and the long tail of screens delivering almost
nothing becomes visible instead of being buried on page three of a table. Keep the table behind a
toggle; it is also the export.

### C.4 The advertiser page holds the worst instance of doc 17's defect

`app/advertiser/page.tsx`:

```tsx
const myPlays = d.plays.filter(p => mine.some(c => c.id === p.campaign_id));
<Stat label="Plays delivered" value={myPlays.length.toLocaleString('en-IN')} … />
```

**This is the number the client is invoiced against, computed from a truncated recency window.** At
scale an advertiser opens their dashboard and sees a delivery count that is a fraction of what they
are billed for — and they are the one party with both a reason to check and no way to see why. Every
other instance of the doc 17 bug produces a confused operator. This one produces a refund demand.

Same for `measured / myPlays.length`, which is *the* trust ratio of the entire company, and for
`myPlays.slice(-15)` on the same page.

Fix is doc 17's: campaign totals come from `settlement_bucket` and `screen_day`, never from `d.plays`.
On the advertiser page this is not a polish item.

### C.5 The advertiser page also has the best writing in the product

The "How we count" card already says it exactly right:

> *A camera on each screen samples the scene while your ad plays and averages how many people were in
> front of it. This is average people present — not impressions, and not unique reach.*
>
> *N plays ran on screens without a working camera and are shown as not measured. They are never
> counted as zero, and never estimated.*

That is the definition from Part B, written, in the right voice, with the completeness field already
in it — **and it exists on exactly one page.** The operator dashboard shows the same metric with the
hint "reported presence". The campaign page says "while the ad was on screen". Three wordings, one
number, and only one of them is honest.

This card is the seed for `lib/metrics.ts` (§B.3). Lift it verbatim, key it as the presence
definition, and render it from the `(i)` on every surface that shows presence — operator, campaign,
advertiser, report, CSV header. **One number, one definition, everywhere.**

### C.6 What an advertiser actually wants to see, and cannot

Three things, none of which exist:

- **When my ad reached people** — dayparting for *their* campaign. The most persuasive chart we could
  possibly show a paying advertiser, and it is the same `<Bars>` primitive as §A.2 chart 3 filtered
  to one campaign.
- **Where it ran** — the "Where it ran" tab is a table of screen names. It should be the map (§A.2
  chart 7). This is the renewal conversation.
- **Whether delivery is on track** — the pacing chart from §C.1, which the advertiser needs at least
  as much as the operator.

Give an advertiser those three plus an honest measured-ratio and the report tab stops being a
`SoonPage` — it becomes a PDF of exactly this page, which is what §B.3's single definition source
makes safe to generate.

### C.7 Campaign-page order

1. Pacing chart (§C.1) — the page's missing headline.
2. Advertiser totals off the rollups (§C.4) — correctness before decoration.
3. The rotation caveat and exposure-gap column (§C.2) — copy, not code.
4. `lib/metrics.ts` seeded from the "How we count" card (§C.5).
5. Sorted per-screen bar (§C.3).
6. Advertiser dayparting, then the map (§C.6).

---

## Order

1. **Palette fix** (§A.0) — `warn`/`onair` separation and the chart-colour rule. Hours, and it blocks
   every chart's correctness.
2. **`definition` as a required prop** + `lib/metrics.ts` + the popover (§B.3–B.4). Independent of the
   rollup, deliverable immediately, and its highest-value entry is a *truncation* warning that makes
   doc 17's defects visible in the product instead of invisible.
3. **`screen_day` rollup** (doc 17 §2.2) — the precondition for every chart.
4. **`<Line>` + `<Hover>`**, then delivery-rate over time (chart 1).
5. **`<Heat>`**, then the fleet health strip (chart 2).
6. **`<Bars>`**, then dayparting (chart 3) and capacity (chart 4) — dayparting first; it is the one
   that sells inventory.
7. Distribution (5), A/B (6), map (7) as demand appears.

Campaign-specific sequencing is in §C.7. The pacing chart (§C.1) and the advertiser-total correction
(§C.4) both outrank charts 5–7 above: one is a missing answer, the other is an invoice defect.

## Do not

- Do not add a categorical palette, and do not add a charting library.
- Do not chart money; settlement stays a table.
- Do not draw a chart on a number that came from the receipt window (doc 17).
- Do not chart a mean without the denominator, or an average without its period.
- Do not render an unmeasured play as zero, on any axis, in any aggregate.
- Do not use hover-only tooltips for the explain layer.
- Do not let the same metric carry different wording in two places.
- Do not present rotated creatives as an A/B result without showing the exposure gap.
- Do not compute an advertiser-facing delivery count from anything but the rollups.
