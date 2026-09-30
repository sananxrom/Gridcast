# Portal UX: flows, structure and a restructure plan

**Written:** 29 Sep 2026 00:54 IST by Claude Code · **Source read at:** `37de100` (live app `568eab9`, player 0.10.4)
**Status:** study and proposal for Sanan and Codex. Nothing here is built. Every recommendation is designed to ship
without a data migration and without changing billing, receipts, measurement or tenancy.
**Raised by Sanan:** creatives should live inside campaigns as a hierarchy but stay reusable; approval should be at
campaign level rather than creative level; campaigns should live inside the advertiser; campaign creation should be one
guided flow ending in "send for approval"; campaigns should show in a Meta-style table; the campaign dashboard is
confusing, with too many numbers, no priority order and no structure. Analyse every page and flow.

---

## 1. How the portals work today (from source)

### 1.1 Navigation

`lib/nav.ts` gives three portals.

| Portal | Sidebar |
|---|---|
| Platform admin (`adminNav`, `:52-80`) | Search · Overview · Inbox · Analytics — Platform: Organisations, All screens, Device health, Device configs — Demand: Advertisers, Creatives, Campaigns, Approvals — Developers: API keys (soon), Webhooks (soon) |
| Operator (`operatorNav`, `:24-50`) | Search · Overview · Inbox · Analytics — Network: My screens, Screen groups, Device configs — Sales: Advertisers, Campaigns, Creatives — Money: Settlement, Reports (soon) |
| Advertiser (`advertiserNav`, `:82-97`) | Search · Delivery · Where it ran · Reports (soon) |

Advertisers, Creatives and Campaigns are three **sibling, flat lists**. None contains another.

### 1.2 The data model already has the hierarchy Sanan wants

This is the most important finding. The hierarchy is already in the data; only the screens hide it.

- A creative carries `advertiser_id` and `org_id`. It is created against an advertiser
  (`components/views/commercial.tsx:71`, `api('/creative', { ..., advertiser_id: f.adv, ... })`).
- A campaign carries `advertiser_id` and a list `creative_ids` (`components/views/campaign-builder.tsx:90-95`).
  The builder only offers creatives of the chosen advertiser:
  `pool = [...].filter(c => c.advertiser_id === advId && c.purpose !== 'filler')` (`:50`).
- So the real model is **Advertiser → (Creative library, Campaigns) → Campaign references creatives**. That is the same
  shape as Meta's account-level media library with ads that reference it. A creative approved once is reusable in
  any later campaign of that advertiser, with no re-approval (`approval_status` lives on the creative).

**Implication:** Sanan's hierarchy can be delivered as a presentation change. No migration is needed.

### 1.3 Flows as they exist

**Register an advertiser.** `Advertisers` → "Add advertiser" opens an inline form (`commercial.tsx:113-149`): name,
contact, email, phone, category, notes, plus exclusions (venue types, screens, tag rules). Saving goes to the advertiser
page.

**The advertiser page** (`AdvertiserDetail`, `commercial.tsx:167-187`) shows a contact card, exclusions and a campaigns
table. It has **no "New campaign" action, no creatives list and no delivery summary**. The advertiser is a record,
not a workspace.

**Add a creative.** A separate Creatives page (`commercial.tsx:48-110`). It is two steps on two surfaces: fill a form
(purpose, advertiser, name, category, media source), click "Add creative", then find the new row in the table and use
its "Upload video / image" control (`:92`: "Create the creative, then choose 'Upload video' on its row below"). The
same table also carries Edit, Media upload and, for admins, Approve/Reject buttons. The Approvals page duplicates those.

**Create a campaign.** `CampaignBuilder` (`campaign-builder.tsx`) is one long page with four numbered cards:
1 Client & dates (with an inline "+ New advertiser"), 2 Rate & budget, 3 Screens, 4 Creatives, then an **"Initial
status"** dropdown and "Create campaign" (`:215`).
- Step 4 can only add a **YouTube URL**. Uploading a file means leaving the flow for the Creatives page (`:191-197`).
- "Initial status" offers `pending` ("reserve capacity"), `draft` ("no reservation") and `active`. These are
  capacity and delivery states, not a review state. There is no "Submit for approval".
- Nothing summarises the campaign before creation, and nothing warns that a chosen creative is unapproved except a
  small badge.
- Admins first choose a campaign type (operator or network) in a separate card (`:106-112`).
- The server rejects a campaign with no screens, including drafts (`lib/inventory.ts:210`,
  `bad('Select at least one screen')`). A step-by-step flow cannot save a server draft before the screens step.

**Approval.** Only creatives are approved, by the platform admin, one row at a time or in bulk (`app/admin/page.tsx:229-248`).
Campaign status is independent. A campaign can be `active` while all its creatives are `pending`: it simply delivers
nothing, and **no screen says why**. Operators see "X is awaiting approval" in their Inbox (`app/operator/page.tsx:86-87`),
which links to the Creatives list, not to the campaign that is blocked.

**Campaign list** (`campaign-list.tsx`): Campaign · Organisation · Dates · Type · Screens · **People / play** (sparkline)
· Rate · Budget · Invoice · Status. The sparkline reads `d.plays` and `d.presence` (`:17`), which bootstrap now always
returns empty (`lib/access.ts:437`, `plays: [], presence: []`). **That column is permanently blank.** There is no
delivery-reason status, no period metrics and no approval state. The advertiser appears only as sub-text.

**Campaign dashboard** (`campaign-detail.tsx:85-199`). Order on the page:
header (name, advertiser · org · dates; status badge; Edit; Pause) → inline edit form → a lone "Lifetime spend" stat →
the **entire `DeliveryReport`** → a budget progress bar **detached from the spend figure above it** (`:161`) →
Verified settlement → Screen bookings → Assigned creatives → Play diagnostics.

`DeliveryReport` is one generic block reused on the admin overview, admin analytics, operator overview and analytics,
screen detail, campaign detail and three advertiser pages. On the campaign page it adds a period picker, a prose
coverage paragraph, **4 delivery cards** (Paid delivered, Billable, Failed, Filler), **4 measurement cards**, Daily paid
delivery, Presence by hour, Recorded paid delivery (grouped table), Attention insights with a model-profile selector,
three hourly charts, a date × hour heatmap and a creative comparison table. That comes to roughly **13 blocks and
20+ numbers with equal visual weight**, before the settlement, bookings, creatives and diagnostics sections. This is
the confusion Sanan describes. Nothing is ranked, and technical provenance (profiles, coverage, "legacy") competes with
the answers an advertiser or seller actually wants.

**Advertiser portal** (`app/advertiser/page.tsx`): "Delivery", "Where it ran" and "Reports" **each render the same
`DeliveryReport`** (`:60`, `:77`, `:88`). Campaign rows are not clickable (`:63`, a plain `<span>`), so an advertiser
cannot open one campaign. "Reports" is labelled `soon` in the nav while it renders a live report.

**Overviews.** Admin (`app/admin/page.tsx:168-182`) and operator overviews show 3-4 stats and a "Needs attention"
table, then the **full `DeliveryReport` again**, so the home page is as long and dense as Analytics.

### 1.4 Findings, ranked

| # | Finding | Evidence | Who it hurts |
|---|---|---|---|
| F1 | Campaign dashboard has no hierarchy: ~13 equal-weight blocks | `campaign-detail.tsx:159-198` + `DeliveryReport` | Seller, advertiser |
| F2 | "Why isn't my campaign delivering?" is not answered anywhere | campaign `status` independent of creative approval; no delivery-reason field | Everyone |
| F3 | Creation is a long form, file upload lives elsewhere, no review step, "Initial status" leaks internals | `campaign-builder.tsx:191-215` | Seller |
| F4 | Advertiser is a record, not a workspace (no New campaign, no creatives, no summary) | `commercial.tsx:167-187` | Seller |
| F5 | Creative creation is two steps on one crowded table; approve buttons duplicated | `commercial.tsx:92,107`; `admin/page.tsx:229-248` | Seller, admin |
| F6 | Approval queue is per creative with no campaign context | `admin/page.tsx:229-248` | Admin |
| F7 | Campaign list: dead sparkline column, no status reason, no period metrics | `campaign-list.tsx:17,32`; `access.ts:437` | Seller |
| F8 | Same report repeated on overview, analytics and three advertiser pages | `advertiser/page.tsx:60,77,88`; `admin/page.tsx:181,275` | Everyone |
| F9 | Advertiser cannot open a campaign | `advertiser/page.tsx:63` | Advertiser |
| F10 | Long explanatory paragraphs inline on every page | e.g. `admin/page.tsx:150,209`, `campaign-detail.tsx:174,184-185` | Everyone |

---

## 2. How Google Ads and Meta Ads structure the same problem

Summarised from how these products work publicly. The patterns are what matter, not pixel detail.

**Hierarchy.** Meta: Campaign (objective, optional campaign budget) → Ad set (audience, placements, schedule, budget)
→ Ad (creative). Google: Account → Campaign (type, budget, bidding, locations, schedule) → Ad group → Ads and assets.
Both keep a **shared asset library** at account level (Meta Media Library, Google Asset Library): a creative is
uploaded once and referenced by many ads.

**Gridcast mapping:** Advertiser ≈ ad account · Campaign ≈ campaign · screen bookings (screens, turns, dayparts) ≈ ad set
/ ad group (where and when) · creative ≈ ad, drawn from the advertiser's library.

**Creation.** Both use a **guided flow with a persistent step list** (Meta shows the Campaign → Ad set → Ad tree on the
left; Google shows a stepper: objective → type → settings → budget → ads → review), a **Next** button per step, a draft
that survives leaving the page, and a **Review** step that lists problems before **Publish**. After publishing, items
enter review automatically. Creative upload happens inside the ad step, not on a separate page.

**Review.** Both review at the **ad / asset level**, because content is what policy judges and assets are reused. But the
result is **surfaced at every level**: an ad set or campaign shows "In review", "Rejected", "Not delivering" in its
Delivery column, with the reason one click away. The user never has to hunt for which ad blocked a campaign.

**Management table.** Meta Ads Manager: one table with **Campaigns | Ad sets | Ads** tabs; selecting rows in one tab
filters the next; a **Delivery** column explains state in words (Active, In review, Learning, Not delivering, Completed);
an inline on/off toggle per row; a date range at top right driving every metric column; **column presets** (Performance,
Delivery, Engagement) instead of every metric at once; clicking a row opens a side panel with a chart. Google's campaign
table is the same idea with a Status column ("Eligible", "Under review", "Limited", "Disapproved") and a single overview
chart with 2-4 selectable metrics above it.

**Dashboards.** Google's Overview leads with **one chart and 4 selectable headline metrics**, then cards; Meta's
reporting defaults to a small column preset. Both push detail into breakdowns, not onto the first screen.

---

## 3. Recommendations

### 3.1 Structure: make the advertiser the workspace

**Keep the flat Campaigns and Creatives lists** as cross-advertiser views, like Google's manager account. Sellers who
work across clients need them. **Add a proper advertiser workspace** at `a/<id>` with tabs:

- **Overview**: status of each campaign, spend this month, what needs action (for example "2 creatives in review", "1
  campaign ends in 3 days").
- **Campaigns**: this advertiser's campaigns in the new table (3.4), with **+ New campaign** pre-filled with the
  advertiser.
- **Creatives**: the advertiser's **creative library** in a thumbnail grid, with approval state, "used in N campaigns"
  and **Upload creative** in one step.
- **Settings**: contact, category, notes and exclusions (the current form).

**On "creatives should live inside campaigns":** agree with the experience, not with moving the data. A campaign shows
its creatives inside it and can upload new ones from inside it. The file still lands in the **advertiser's library**, so
the next campaign can reuse it with its approval intact. That is exactly how Meta and Google do it. Moving creatives
under a single campaign would force re-upload and re-approval for every campaign.

**On "campaigns should live within the advertiser":** yes, as the primary path (advertiser → campaigns), while keeping
the global list. The data already does this (`advertiser_id` on every campaign).

### 3.2 Approval: submit and see at campaign level, record at creative level

Sanan asked for campaign-level approval instead of creative-level. Recommendation: **the reviewer approves a campaign
in one action, and the approval is stored on its creatives.**

- The seller finishes the flow with **Submit for review**. That is one action for the whole campaign.
- The review queue lists **campaigns awaiting review**. Each row shows advertiser, dates, screens and a thumbnail strip
  of the creatives that need a decision. The reviewer opens it, sees every creative with a player, and can **Approve
  campaign** (approves all its pending creatives in one action), **Reject** with a reason, or reject single creatives.
- Approval stays **recorded per creative**, because that is what is reusable. A creative approved for campaign A needs no
  new review in campaign B. A campaign made only of approved creatives skips the queue entirely.
- Every campaign shows a **derived review status**: Draft · In review · Changes needed · Approved/Scheduled · Live ·
  Not delivering (reason) · Paused · Ended. It is computed from existing fields (campaign status, dates, creative
  approvals, budget), so no new stored field is needed for the first version.

Why not store approval on the campaign alone: the same creative can sit in several campaigns, and a policy decision is
about the content. Campaign-only approval would either re-review the same video per campaign or let an approval on one
campaign silently cover another. The derived status gives Sanan the campaign-level experience without that trade.

**Open question for Sanan:** do operator-sold campaigns need any commercial approval beyond content (for example Gridcast
checking rates on network screens)? Today nobody approves a campaign's commercials. If yes, that is a second review type,
and it needs a stored campaign field later.

### 3.3 Creation: one guided flow

Replace the long form with a **stepper**. Same page, same API payload (`POST /campaign`), steps on the left:

1. **Basics**: advertiser (pre-filled from the advertiser workspace), campaign name, dates, optional daily time window.
   Admin only: campaign type (own screens or network).
2. **Budget**: rate type, rate per play, committed budget, with a live "about N plays at this rate" hint.
3. **Screens**: list plus group quick-select as today, adding a live capacity check per screen and a map later.
4. **Creatives**: pick from the advertiser's library (thumbnails, approval badges) **or upload a new file right here**
   (reuse `CreativeUpload`), or add a YouTube source. Uploads go to the advertiser library.
5. **Review**: a summary of everything and **blocking or warning checks**: no screens, dates in the past, creatives
   pending review ("this campaign will wait for review before it can play"), budget below one day of plays, screens
   near capacity.
   Two buttons: **Save as draft** and **Submit for review** (or **Launch** when every creative is already approved).

"Initial status" disappears. Submit maps to today's `pending` (holds capacity), Save as draft to `draft`, and Launch to
`active`.
**Persistence:** the server rejects drafts without screens (`lib/inventory.ts:210`). So steps 1-2 are kept in the browser
(localStorage keyed by user) and the server draft is created from step 3 onward. The alternative, allowing screen-less
drafts on the server, is a small validation change for Codex to weigh; the UI works either way.

### 3.4 The campaign table (Meta-style)

- **Tabs: Campaigns | Creatives | Bookings.** Selecting campaigns filters the other two tabs to them, as in Ads Manager.
- **Date range at top right**, driving every metric column (the report hook already supports periods).
- **Columns, default preset "Delivery":** on/off toggle · Campaign (advertiser underneath) · **Status with reason** (3.2)
  · Dates · Screens · Plays (period) · Avg people (period) · Est. impressions (period) · Spend / budget bar.
  Other presets: **Money** (rate, spend, invoice, settlement) and **Audience** (people, looking, attentive
  impressions, coverage). Presets replace showing everything at once.
- Drop the dead **People / play** sparkline (F7). A row click opens the campaign; hover shows a small trend.

### 3.5 The campaign dashboard: from 13 equal blocks to a ranked page

Order by the questions people actually ask, in this sequence: **Is it running? Is it on budget? How is it doing? Where
and with what? Then the evidence.**

1. **Header:** name, advertiser (link), dates, **status with reason** (for example "Live · 6 of 7 screens playing" or "Not
   delivering · 2 creatives rejected → Review"), and actions (Edit, Pause, Duplicate).
2. **Four headline cards only:** **Spend vs budget** (with pace: "on track to use 82% by end date"), **Plays
   delivered**, **Est. impressions**, **Avg people present**. Each has a one-line comparison to the previous period,
   and definitions live in the existing `(i)` popovers.
3. **One main chart:** plays per day, with a metric switcher (plays / people / impressions), as in Google Overview.
4. **Tabs below:** **Screens** (bookings plus per-screen delivery) · **Creatives** (assigned creatives with thumbnail,
   approval, plays, impressions; "Upload / add from library") · **Audience** (the attention section: looking,
   attentive impressions, hourly charts, heatmap) · **Money** (settlement, invoice status; `money` capability only) ·
   **Diagnostics** (receipts, coverage and profile provenance, legacy notes).
5. **Move prose** (coverage, provenance, "not a controlled A/B experiment") into the `(i)` popovers and the Diagnostics
   tab. Keep one short status line when data is partial.

Nothing is removed. It is ranked and grouped. The budget bar moves next to the spend figure it describes.

### 3.6 Other pages

- **Overviews (admin, operator):** keep the stats and the Needs-attention table; replace the embedded full report with
  a **compact summary** (4 cards and one chart) plus "Open analytics →". Group Needs-attention by type, with counts:
  Screens offline (3), Awaiting review (2 campaigns), Budget ≥80% (1).
- **Inbox approval items** should link to the **campaign** in review, not to the flat Creatives list.
- **Creatives page:** a thumbnail grid, **one-step create + upload**, approval as a badge, and review actions only in the
  review queue (remove the duplicate Approve/Reject from the Creatives table).
- **Approvals → "Review queue"**, grouped by campaign (3.2), with a creatives-only tab for filler content.
- **Advertiser portal:** Delivery becomes a campaigns home with the new table; campaigns open a **read-only campaign
  dashboard** (3.5 minus Edit, Money and Diagnostics); "Where it ran" keeps its screens table without repeating the whole
  report; "Reports" is either the CSV/report page or loses its `soon` label.
- **Copy:** replace inline paragraphs with one-line summaries plus `(i)`. Use the same status words everywhere.

---

## 4. Delivery plan (nothing breaks)

Every phase is front-end only unless marked. It reuses existing APIs and fields, keeps every current URL working
(`#c/<id>`, `#a/<id>`, `#campaigns`, `#creatives`, `#approvals`), and changes no billing, receipt, measurement or
tenancy code.

| Phase | Scope | Server change |
|---|---|---|
| 1 | Derived campaign status with reason (3.2), shown in list, detail header and inbox; remove the dead sparkline | none |
| 2 | Campaign dashboard restructure (3.5): header, 4 cards, one chart, tabs; `DeliveryReport` split into reusable pieces | none |
| 3 | Advertiser workspace tabs (3.1) with "+ New campaign" pre-filled; creative library grid; one-step upload | none |
| 4 | Guided creation flow (3.3) with review step; browser-side state until screens | optional: allow screen-less drafts |
| 5 | Review queue grouped by campaign, with explicit submission, review and activation transitions (see §6.1) | **yes**: a campaign transition, not a loop over the creative endpoint |
| 6 | Campaign table presets, tabs and date range (3.4); advertiser portal campaign pages and de-duplication (3.6) | likely: period-scoped per-campaign metrics (see §6.4) |

**Tests to keep green:** `tests/reporting-ui.test.cjs`, `tests/reporting.browser.cjs` and the admin browser suite
assert current report and admin markup. Splitting `DeliveryReport` (phase 2) must keep their scenarios or update them
deliberately, and must not change any number.

---

## 5. Decisions for Sanan

1. Approval model: **approve per campaign in one action, recorded per creative** (recommended), or a separate stored
   campaign approval as well?
2. Do operator-sold campaigns need a commercial review step, in addition to content review?
3. Should the flat Campaigns and Creatives lists stay in the sidebar (recommended), or go only through advertisers?
4. Phase order: start with phase 1 plus 2 (fixes the confusing dashboard fastest), or with the creation flow (4)?

---

## 6. Corrections after Codex's review (29 Sep 2026, 01:00 IST)

*Added by Claude Code, 2026-09-29 01:02 IST. These supersede the matching parts of §3 and §4. Codex's review is in `AI-LOG.md`
at 01:00 IST.*

### 6.1 "Approve campaign" needs a real transition (supersedes §3.2 and the phase 5 row)

§3.2 said Submit maps to `pending` and "Approve campaign" loops the existing per-creative approval. **That is wrong.** A
campaign only plays when its status is `active` (`lib/inventory.ts:266`, `if (c.status !== 'active') return
result(2,'campaign_not_active')`). The approve endpoint changes only the creative (`lib/api.ts:430-434`,
`cr.approval_status = body.status || 'approved'`). Approving every creative would leave the submitted campaign
`pending` and silent.
The workflow needs three explicit, server-side steps:
1. **Submit:** the seller moves the campaign to "in review" (capacity held as `pending` does today).
2. **Review:** content decisions on its creatives, plus the commercial check if Sanan wants one (§5 Q2).
3. **Activate:** who may launch after approval (the reviewer automatically, or the seller), with revalidation of
   capacity and dates at that moment. It must also say what happens on partial failure (one creative rejected, one
   screen now full).
This is a server change and gets its own review.

### 6.2 Approval scope must be stated

Because creatives are reused, approving a creative in campaign A makes it approved in campaign B too. That is the
intended reuse, but the reviewer's screen must say so ("also used in 2 other campaigns"). If Sanan wants each campaign
approved independently, that decision has to be **stored on the campaign**, not derived from creative approval.

### 6.3 Status reasons come from eligibility evidence, not from campaign fields alone

Whether a creative plays is decided per screen, per creative and per moment: operating windows, exclusions, media
readiness, budget reservations, screen and org status (`lib/inventory.ts`, the `result(code, reason)` checks around
`:260-290`). Those checks already produce reason codes, such as `campaign_not_active`, `outside_campaign_dates` and
`screen_not_active`. The status line should use them, and "Live · N screens playing" must come from recent receipts and
device evidence. Where there is no evidence, the status says **unknown**, never live.

### 6.4 Table metrics need period-scoped data

Plays, people and impressions per campaign for a chosen range must come from the period report (`screen_day` and
attention summaries), with compatible measurement profiles and coverage kept. Bootstrap cannot supply them; it sends
empty play arrays. Label spend for the period separately from lifetime budget used.

### 6.5 Browser drafts must be scoped

A draft kept in the browser before the screens step must be keyed by user **and** org, advertiser and campaign type,
validated when restored, and have an explicit discard and expiry. A user-only key could leak a draft into another
workspace.

### 6.6 Keep a visible coverage cue

When provenance moves into tabs, each headline number still shows a short partial or unknown cue next to it, not only
behind an (i).

### 6.7 Revised claim

§4's "front-end only unless marked" holds for phases 1-4 in their read-only parts. Phase 5 needs server transitions.
Phase 6 likely needs period-scoped aggregate reads. Neither changes billing, receipts or measurement definitions, but
both change server code. Codex's recommended order matches mine: phases 1-2 first, then the workspace and guided
creation, then review and the richer table.

### 6.8 Step order and Save draft (Sanan, artifact comment, 30 Sep 2026)

*Supersedes the step order and persistence notes in §3.3.*

1. Basics: advertiser, name, dates, optional time window, and campaign type for admins.
2. Screens.
3. Creatives: pick from the library or upload here.
4. Budget: rate and committed budget, showing list price and an "about N plays" estimate for the screens already chosen.
5. Review.

Save draft is available on every step, and reopening a draft returns the user to the step they left. Before Screens,
the draft is held in the browser and scoped as §6.5 requires (user, organisation, advertiser and campaign type,
validated on restore, with discard and expiry). From Screens onward it is saved on the server as a `draft` campaign,
because the server rejects a draft with no screens (`lib/inventory.ts:210`). Submit for review and Launch appear only
on Review. Putting Budget after Screens also lets the budget step price the actual screens instead of asking for a
number blind.


### 6.9 Server drafts confirmed (Sanan, 1 Oct 2026)

Supersedes §6.8's browser-first persistence and §4 phase 4's optional server change. Sanan agreed to the recommendation for incomplete server drafts: Save draft is an option on every step, including Basics. Persist the entered fields and current step on the server; reopen at that step. Missing screens, creatives, dates or budget do not prevent saving an incomplete draft. Do not replace missing financial values with zero.

Drafts remain scoped to the authenticated user and authorised organisation/advertiser context. Validate supplied fields and permissions; support an unselected advertiser explicitly until it is chosen. Drafts neither reserve screen inventory nor authorize playback or finalize booking economics. Repeated saves update the same draft. Full submission/activation validation remains mandatory, and Submit/Launch remain on Review only. Show a successful save only after the server confirms it; failed saves retain the user's input and allow retry.

This confirms the draft requirement; campaign/content/commercial approval decisions remain separate. This document is still a plan, not a claim that drafts have been implemented.
