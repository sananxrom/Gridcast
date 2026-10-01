# Portal restructure — build plan

**Date:** 2026-10-01 · **Base commit:** `9d7b984` (branch `codex/gridcast-trust-layer-wp5`)
**Status:** plan for Codex. Supersedes doc 30 §4 as the delivery plan. Doc 30 §1-3 stay as the study; §6.1-6.9 stay
binding and are folded in below. Nothing here is built.
**Working model:** Codex (coordinator, builder, QC, tester) implements and deploys each phase to the controlled test
environment (Sanan's own screens). Claude reviews each phase against this plan before the next one starts.

**Hard rules (AI-LOG Standing Context), apply to every phase:** unmeasured is null, never zero. Provenance is kept.
Tenant isolation holds on every new read and write. No change to billing, receipt, settlement or measurement
definitions. Attention and impression figures are analytics only and never feed billing or pricing.

---

## 1. Decisions (Sanan, recorded; do not re-ask)

1. The reviewer approves a **campaign** in one action. Approval is **stored per creative**. A reused creative stays
   approved, and the reviewer sees "also used in N other campaigns". The campaign then starts through an explicit
   **activate** transition. There is no separate stored campaign-level approval.
2. Content review only. No commercial (rate, dates, budget) review step for now.
3. The global Campaigns and Creatives lists stay in the sidebar next to the new advertiser workspace.
4. Build order: Phase 1 truthful status, Phase 2 ranked campaign dashboard, Phase 3 advertiser workspace, Phase 4 guided
   creation (Basics → Screens → Creatives → Budget → Review, Save draft on every step, server drafts per doc 30 §6.9),
   Phase 5 review workflow, Phase 6 Meta-style table and advertiser-portal pages.
5. Attention and impression metrics are analytics only.
6. Deploy-and-test on the controlled environment is acceptable.

## 2. Source facts this plan relies on (checked at `9d7b984`)

- Eligibility reason codes come from `eligibility()` in `lib/inventory.ts:255-303`. Codes, in check order:
  `screen_not_targeted`, `network_booking_missing` (:260-261); `screen_org_not_active`, `screen_not_active`,
  `campaign_not_active` (:264-266); `campaign_dates_invalid`, `outside_campaign_dates` (:269-270); `budget_exhausted`
  (:272); `outside_operating_hours`, `operating_hours_invalid` (:278); `outside_campaign_daypart`,
  `campaign_daypart_invalid` (:281-282); `creative_not_approved` (:284); `platform_category_block` (:285);
  `screen_category_block` (:286); `screen_advertiser_block` (:287); `advertiser_archived` (:288);
  `advertiser_venue_block` (:290); `competitive_separation` (:291); `screen_aspect_invalid` (:293);
  `no_playable_asset` (:298); `creative_duration_outside_limits` (:300). Warnings: `budget_80_percent`,
  `operating_window_unconfigured`.
- `lib/readiness.ts:2-29` already maps every one of those codes to plain English (`reasonLabel`). Doc 30 did not use it.
  The wording is screen-oriented; Phase 1 reuses the map and adds campaign wording where needed.
- Eligibility decisions reach the client only through `GET /screen/:id` (`lib/api.ts:407`, `eligibility:
  playlist.decisions`). `GET /campaign/:id` does not return them.
- `GET /campaign/:id` returns recent receipts for the campaign (`lib/api.ts:362-377`, `plays`, newest 300; Firestore
  loads up to `HISTORY_LIMIT` 1500, `lib/firestore-store.ts:22,373-381`). Bootstrap returns `plays: [], presence: []`
  (`lib/access.ts:437`).
- Bootstrap screens carry `_status` from device heartbeat: live under 90 s, stalled under 900 s, else offline
  (`lib/api.ts:109-115`).
- `isLive()` (`lib/utils.ts:23-24`) is status plus dates only. It is what the list, advertiser page and admin overview
  call "live" today. That is the untruthful label Phase 1 replaces.
- `GET /metrics` already returns period-scoped `byCampaign`, `byScreen`, `byCreative` counters and per-profile
  `attentionProfiles[*].byCampaign` (`lib/reporting.ts:99-129`). The advertiser overview already renders
  `report.data.byCampaign[c.id].plays_rendered` (`app/advertiser/page.tsx:66`).
- There is no period spend in reporting. `screen_day` rows hold no money, and settlement buckets are monthly
  (`lib/settlement.ts:31-35`, `settlementPeriod` returns `YYYY-MM`).
- Any sales user can set `status` through the generic edit (`CAMPAIGN_EDIT` includes `status`, `lib/access.ts:68`),
  and the list and detail pages do (`campaign-list.tsx:19-21`, `campaign-detail.tsx:74-76`). `POST /campaign` defaults
  to `status: 'active'` (`lib/api.ts:427`). The builder defaults to `pending` (`campaign-builder.tsx:43`).
- Creative approval is platform-only (`lib/access.ts:48`) and changes only the creative (`lib/api.ts:430-435`).
  Uploading a new media variant resets that creative to `pending` (`lib/api.ts:446`), which silently stops it in every
  campaign that reuses it.
- Every campaign save goes through `freezeBookings` (`lib/api.ts:37-52`): name, rate type, numeric rate and budget are
  required (:44-45), `validateBooking` requires valid dates and at least one screen (`lib/inventory.ts:209-210`), and
  booking economics are frozen even for `draft` (:46-50). `validateInventory` (`lib/api.ts:57-63`) re-validates every
  stored campaign that has screens whenever a creative asset is uploaded (:447).

---

## 3. Phases

### Phase 1 · Truthful campaign status with a reason

**Goal:** every campaign shows one honest state and the reason for it, from evidence, never from dates alone.
**User-visible result:** list rows, the campaign header and inbox items say "Live · 3 of 4 screens", "Not delivering ·
2 creatives awaiting approval", "Scheduled", or "Unknown · no recent delivery evidence". The blank "People / play"
column is gone.

**Vocabulary (exact strings):** `Draft` · `In review` · `Changes needed` · `Scheduled` · `Live · N of M screens` ·
`Not delivering · <reason>` · `Paused` · `Ended` · `Unknown`. `In review` and `Changes needed` stay unused until
Phase 5 creates a review state; the function must accept that input already.

**Derivation, first match wins** (dates compared as IST days, same as `isLive`):

| # | Condition | State |
|---|---|---|
| 1 | `status === 'draft'` | Draft |
| 2 | Phase 5 `review.state === 'in_review'` / `'changes_needed'` | In review / Changes needed |
| 3 | `status` is `complete` or `cancelled`, or `ends_at` before today | Ended |
| 4 | `status === 'paused'` | Paused |
| 5 | `status === 'pending'` | Not delivering · Not started (holding screens, not active) |
| 6 | active, `starts_at` after today, no blocker from row 7 | Scheduled |
| 7 | active, a campaign-wide blocker (list below) | Not delivering · reason |
| 8 | active, in dates, N ≥ 1 targeted screens with a rendered paid receipt in the last 30 min | Live · N of M screens |
| 9 | anything else | Unknown · reason ("no delivery in the last 30 min" or "delivery evidence not loaded") |

Row 6 before 7 is deliberate for date-only cases; a future campaign with no approved creative shows
"Scheduled" plus a warning chip "creatives awaiting approval". The 30-minute window is a named constant
(`LIVE_EVIDENCE_WINDOW_MS`); Codex may tune it and must state the value in the log.

**Campaign-wide blockers from fields the client already has** (bootstrap or `GET /campaign/:id`):
no creatives (`creative_ids` empty, readiness `no_creative`); no approved creative (`creative_not_approved`); budget
reached (`rate_type === 'per_play'` and `accrued_spend >= committed_budget`, same test as `lib/inventory.ts:272`);
invalid dates (`campaign_dates_invalid`); advertiser archived; every targeted screen `status !== 'active'`
(`screen_not_active`); every targeted screen `_status.state === 'offline'` ("all screens offline", device evidence).
Where `committed_budget` is redacted (operator view of a network campaign, `lib/access.ts:401`) the budget check is
skipped, not guessed.

**Per-screen reasons (detail page only)** come from server eligibility decisions. If every targeted screen is
ineligible, the header reason is the most common code across screens, with "and N other reasons" linking to the
Diagnostics section. If some screens are eligible, the state follows rows 8-9 and the ineligible screens are listed.

**Reason text:** reuse `reasonLabel` from `lib/readiness.ts`. Add campaign wording in the new file for the codes whose
screen wording reads wrong on a campaign: `campaign_not_active` → "Campaign is not active", `creative_not_approved` →
"N creatives awaiting approval" (or "rejected" when that is the state), `budget_exhausted` → "Budget reached",
`outside_operating_hours` / `outside_campaign_daypart` → "Outside delivery hours (normal)". Unknown codes fall back to
`reasonLabel`'s `unavailable`.

**Is "Live · N of M" available client-side today?** On the detail page, yes: `GET /campaign/:id` `plays` carries
`screen_id`, `ended_at`, `billable` and `source`, enough to count screens with a recent receipt (verify that the
`rendered` flag is on play rows; if not, use `billable !== false` and say so in the tooltip). On the list, no: bootstrap
has no receipts. The list needs one server read (task 6).

**Tasks**
1. Create `lib/campaign-status.ts`: pure `campaignStatus({campaign, creatives, screens, advertiser, receipts?,
   decisions?, now}) → {state, label, reason_code, reason, evidence: {screens_recent, screens_targeted, last_receipt_at,
   source}}`. No React, no fetches. `evidence.source` is `'receipts' | 'report_summary' | 'none'`.
2. Create `components/views/campaign-status-badge.tsx`: renders label, tone and a popover with reason and evidence time.
3. `components/views/campaign-list.tsx`: replace the Status cell (:40-43) with the badge; keep the `InlineSelect` for
   Pause/Resume/Complete. Delete the "People / play" column (:32) and `trendCampaign` (:17); drop unused `Spark` and
   `daySeries` imports. Status facet (:46) filters on the derived state.
4. `components/views/campaign-detail.tsx`: replace the raw status badge (:92) with the badge fed by `d.plays` and the
   new `d.eligibility`. Keep Edit and Pause/Resume.
5. `app/operator/page.tsx:86-87` and `app/admin/page.tsx:92-104`: for each pending creative, emit one inbox item per
   visible campaign that uses it ("Campaign X is waiting on N creatives", `go: 'c/' + id`). Creatives in no campaign
   keep the current item (`creatives` / `approvals`). Add "Not delivering" items for active campaigns with a
   campaign-wide blocker. Keep the admin `approvals` badge count unchanged.
6. **Server read for the list:** add an additive field to `summarizeReport` in `lib/reporting.ts`:
   `campaignScreens: {[campaign_id]: {[screen_id]: last_at}}`, built from the same rows (`row.last_at` is a play time,
   :88-89). No counter changes. Then a small hook in `components/views/campaign-status-badge.tsx`
   (`useCampaignEvidence(org)`) reads `/metrics` for yesterday-to-today IST and feeds the list. Until the hook
   resolves, active in-date rows show `Unknown · delivery evidence not loaded`.
7. **Server read for the detail page:** add `eligibility` to the `GET /campaign/:id` response in `lib/api.ts:362-377`:
   for each targeted screen, the decisions from `playlistFor(screen)` filtered to this campaign
   (`{screen_id, creative_id, eligible, reason, warnings}`). Filter screens through `screenView` visibility first so an
   operator on a network campaign sees only its own screens.
8. `lib/firestore-store.ts`: make sure the `GET campaign/:id` snapshot loads what `playlistFor` needs for those
   screens (other campaigns on the screen, orgs, configs, groups, advertisers). Mirror the `GET screen/:id` loading.
   **Verify** before relying on it; a missing collection gives wrong reasons silently.

**Server changes:** two read-only additions (task 6 field, task 7 field). No new stored data, no write paths, no
change to any counter or billing field.
**Data sources:** list: bootstrap `campaigns`, `creatives`, `screens[]._status`, `advertisers` plus `/metrics`
`campaignScreens`. Detail: `GET /campaign/:id` `campaign`, `byCreative`, `byScreen`, `plays`, `eligibility`.

**Acceptance checks**
- An active in-date campaign whose only creative is `pending` shows "Not delivering · 1 creative awaiting approval" on
  list and header, never "live".
- An active in-date campaign with no receipt in 30 min shows `Unknown`, not Live, even when all screens heartbeat.
- A campaign with receipts on 2 of 3 targeted screens in the window shows "Live · 2 of 3 screens".
- Operator view of a network campaign counts only the operator's screens in M, and does not leak other orgs' screens.
- The Campaigns table has no "People / play" column. Pause/Resume from the list still works.
- An inbox approval item opens the campaign page.
- `/metrics` totals, byCampaign and attention numbers are unchanged for the same fixture (diff before and after).

**Tests:** new `tests/campaign-status.test.cjs` (loads `lib/campaign-status.ts` via `tests/load-lib.cjs`; one case per
table row and per blocker; redacted budget; seed-source receipts). Extend `tests/reporting.test.cjs` for
`campaignScreens` and for unchanged counters (check for `deepEqual` on the whole summary; update deliberately).
Extend `tests/authorization.test.cjs` / `tests/network-authorization.test.cjs` so `eligibility` on `GET /campaign/:id`
never includes another org's screen. Update `tests/admin.browser.cjs:64-69` (sales campaign list columns) and add a
list-status case.
**Risks:** `playlistFor` per screen on each campaign read costs time on large campaigns; cap to targeted screens and
measure. Reusing "live" words anywhere else (`isLive` in `app/admin/page.tsx`, `app/advertiser/page.tsx:69`) keeps the
old lie alive; Phase 1 swaps the list, detail and advertiser status cells, and leaves the admin overview count to
Phase 6 with a note.
**Claude review focus:** no path returns Live without receipt evidence; Unknown is used, not a guess; reason codes map
to the source list above; no tenant leak in `eligibility`; report numbers byte-identical; the dead column is gone.

### Phase 2 · Ranked campaign dashboard

**Goal:** the campaign page answers "is it running, is it on budget, how is it doing, where and with what" in that
order, with the same numbers as today.
**User-visible result:** header with status; four headline cards; one chart with a metric switcher; tabs Screens ·
Creatives · Audience · Money · Diagnostics. Nothing removed, only ranked and grouped.

**Layout (top to bottom)**
1. Header: name, advertiser, dates, Phase 1 status badge, Edit, Pause/Resume. Period picker and Export CSV on the right.
2. Four cards, each with a visible coverage cue (doc 30 §6.6) next to the value, not only behind `(i)`:
   - **Spend vs budget:** `campaign.accrued_spend` of `committed_budget`, labelled "Lifetime", with the progress bar
     inside the card (moves `campaign-detail.tsx:161` next to its figure). Cue: "your screens only" when budget is
     redacted. No period spend (none exists; see §2).
   - **Plays:** `report.data.totals.plays_rendered` for the period. Cue: "partial" when `coverage.complete` is false,
     "—" when `coverage.started_at` is null, "N receipts had invalid times" when `plays_time_invalid > 0`.
   - **Est. impressions:** `selectedAttention.totals.estimated_impressions` when `body_observed_ms > 0`, else
     "Unavailable". Cue: observed minutes, and "profile: X · N profiles" when more than one profile exists. Never sum
     across profiles.
   - **Avg people present:** exactly the current expression in `delivery-report.tsx` (the `presence_avg` card: profile
     rate when a profile is selected, legacy `formatAverage` otherwise). Cue as the current hint.
3. One chart: daily series with switcher Plays (`data.daily[].plays_rendered`) · Avg people (profile `daily` or legacy
   daily presence) · Est. impressions (profile `daily`). Options without data are disabled with "Unavailable".
   Missing days render as gaps (null), matching the current `dateRows` logic.
4. Tabs (local state; the URL stays `#c/<id>`):
   - **Screens:** Screen bookings table (current `:164-171`) plus period plays and people per screen from
     `report.data.byScreen` (campaign-filtered report) and the Phase 1 per-screen eligibility reason.
   - **Creatives:** Assigned creatives (current `:173-180`) plus period plays from `byCreative`, approval badge, and
     the creative comparison table from the Attention section.
   - **Audience:** measurement profile selector, profile hour table, hourly charts, date × hour heatmap, attention
     insights, all moved as-is.
   - **Money** (`money` capability only): Verified settlement (current `:162`).
   - **Diagnostics:** coverage prose, invalid-time note, provenance, "not a controlled A/B experiment" note, and the
     Play diagnostics `<details>` (current `:182-198`).

**Splitting `components/views/delivery-report.tsx` without changing numbers**
1. Create `components/views/report-parts.tsx`. Move, do not rewrite, each block of `DeliveryReport` (:214-283) into an
   exported component: `ReportPeriodBar`, `ReportCoverageNote`, `DeliveryCards`, `MeasurementCards`,
   `DailyDeliveryChart`, `HourlyPresence`, `DeliveryBreakdown`, `AttentionInsights`. Move the shared local state
   (`preset`, `draft`, `dimension`, `attentionSeries`, derived `selectedAttention`, `dateRows`, `hourRows`) into one
   hook `useReportView(report, metadata)`.
2. Create pure selectors (same file or `components/views/report-metrics.ts`) for the four headline values, extracted
   from the existing card expressions. `DeliveryCards` and `MeasurementCards` call the same selectors, so the old and
   new pages cannot drift.
3. `DeliveryReport` keeps its signature and becomes a composition of the parts in the current order with the same
   headings, `aria-label="Delivery report"`, `aria-busy`, and text. Its DOM should be unchanged.
4. Create `components/views/campaign-dashboard.tsx` composing header, cards, chart and tabs from the parts.
5. `components/views/campaign-detail.tsx` keeps loading, edit form and actions, and renders `CampaignDashboard`
   instead of the lone Stat, `DeliveryReport`, progress bar and trailing sections (:159-198).

**Every page that renders `DeliveryReport` and what it keeps in Phase 2**

| Page | Where | Keeps |
|---|---|---|
| Admin overview | `app/admin/page.tsx:181` | full `DeliveryReport`, unchanged (compact summary is Phase 6) |
| Admin analytics | `app/admin/page.tsx:275` | full `DeliveryReport`, unchanged |
| Operator overview | `app/operator/page.tsx:171` | full `DeliveryReport`, unchanged |
| Operator analytics and reports | `app/operator/page.tsx:279` | full `DeliveryReport`, unchanged |
| Screen detail | `components/views/screen-detail.tsx:213` | full `DeliveryReport`, unchanged |
| Advertiser Delivery, Where it ran, Reports | `app/advertiser/page.tsx:60,77,88` | full `DeliveryReport`, unchanged (Phase 6) |
| Campaign detail | `components/views/campaign-detail.tsx:160` | replaced by `CampaignDashboard` |

**Server changes:** none. **Data sources:** `useDeliveryReport({campaign: id})` (`delivery-report.tsx:81`, pages
`/metrics?campaign=`), `GET /campaign/:id`, Phase 1 status.
**Acceptance checks:** for a fixture campaign, each headline value equals the value the old cards showed for the same
period and profile; period change updates cards, chart and tabs together; Money tab absent without `money`; each
card shows a cue when coverage is partial or a value is Unavailable; the eight other pages look and test the same.
**Tests:** `tests/reporting-ui.test.cjs` stays green unchanged (it asserts current report markup); add selector cases
there (same inputs, same strings as the old cards, including "Unavailable" and "—"). `tests/reporting.browser.cjs`
stays green unchanged. `tests/admin.browser.cjs:112-128` (network campaign, scoped money, verified settlement) and
`:129-` (network edit) must pass; update selectors only where the section moved into a tab, and say so. Add a
campaign-dashboard browser case (cards, tab switch, no Money tab without the capability).
**Risks:** a hand re-typed metric expression drifts from the original; forbid it by sharing selectors. Moving state
into a hook can reset the period picker on tab change; keep `report` owned by `CampaignDetail`. Hidden tabs must not
mount heavy charts until opened.
**Claude review focus:** diff of `DeliveryReport` output on the other pages is empty; no number is recomputed
differently; profiles are never summed; coverage cues visible; budget bar sits with spend.

### Phase 3 · Advertiser workspace

**Goal:** the advertiser page becomes the place to run that client's campaigns and creatives.
**User-visible result:** `#a/<id>` with tabs Overview · Campaigns · Creatives · Settings; "+ New campaign" pre-fills the
advertiser; a creative library grid with one-step create and upload. Global lists remain.
**Tasks:** (1) `components/views/commercial.tsx` `AdvertiserDetail` (:167-187) becomes a tab shell; move its form to
Settings. (2) Create `components/views/advertiser-workspace.tsx` for Overview (Phase 1 status counts, lifetime spend,
action items) and Campaigns (current table plus status badge). (3) Creative library grid in the same file: thumbnail,
approval badge, "used in N of your visible campaigns" counted from bootstrap `creative_ids`. (4) One-step create:
`POST /creative` then `CreativeUpload` (`components/views/creative-upload.tsx:7`) with the returned id in the same
dialog; a failed upload keeps the created creative and says so. (5) Pre-fill: pass the advertiser into the `new` view
(for example `new:a:<id>`) and update the view parsers in `app/admin/page.tsx:69,77,133` and the operator equivalent;
plain `new` keeps working. (6) Remove duplicate Approve/Reject from the Creatives table only after Phase 5 ships the
queue; not in this phase.
**Server changes:** none. **Data sources:** bootstrap `advertisers`, `campaigns`, `creatives`; Phase 1 status;
optional `/metrics` for "this month" plays.
**Acceptance:** from an advertiser, New campaign opens with that advertiser selected; a new creative with a file
appears in the grid with `pending`; tenant scope unchanged for operator and admin with org filter; old `#a/<id>`,
`#creatives`, `#campaigns` links work.
**Tests:** extend `tests/admin.browser.cjs` (archived advertiser case at :11 must still block creatives; new
workspace tab case); `tests/media-upload.test.cjs` unchanged.
**Risks:** "used in N campaigns" undercounts for an operator who cannot see network campaigns; label it "visible".
**Claude review focus:** no new data path; counts labelled honestly; upload failure path.

### Phase 4 · Guided creation with server drafts

**Goal:** one stepper, Basics → Screens → Creatives → Budget → Review, with Save draft on every step and resume at
the saved step (doc 30 §6.8-6.9).
**Server work (required).** Recommended design: a separate `campaign_drafts` collection, not `status: 'draft'` rows in
`campaigns`. Reason: an incomplete row in `campaigns` would hit `validateInventory` (`lib/api.ts:57-63`) on every
creative upload and throw on missing dates, would be read by `playlistFor`, settlement and budget code, and would be
fetched by the Firestore `screen_ids array-contains` queries. A separate collection keeps every existing validation
untouched.
- Endpoints (new `ROUTES` entries in `lib/access.ts`, caps `sales`): `POST /campaign-draft` (create),
  `POST /campaign-draft/:id` (save fields and `step`, with a `revision` number for lost-update protection),
  `GET /campaign-draft/:id`, `GET /campaign-drafts` (mine), `POST /campaign-draft/:id/discard`,
  `POST /campaign-draft/:id/submit`.
- Stored: `id, org_id, created_by, advertiser_id|null, campaign_type, step, fields{...}, revision, updated_at,
  expires_at, submitted_campaign_id|null`. Missing values are absent or null. Never write 0 for an unknown rate or
  budget.
- Validation kept for drafts: authentication; `org()` for the org; `own()` for each supplied screen; advertiser, if
  supplied, belongs to the org and is not archived (subset of `campaignRelations`, `lib/access.ts:122-134`); network
  type admin-only (:124); creative ids belong to the chosen advertiser; `rejectUnknown`; supplied values type-checked
  (text length, `YYYY-MM-DD` dates, finite non-negative numbers). Drafts are visible only to `created_by` in the same
  org (verify with Sanan in review whether org colleagues should see them; default is no).
- Relaxed for drafts: required name, rate, budget (`lib/api.ts:44-45`); dates and at least one screen
  (`lib/inventory.ts:209-210`); capacity checks; `freezeEconomics`; budget ledger; `participant_org_ids`.
- Submit (`/submit`) builds the full campaign body and runs the **existing** `POST /campaign` path unchanged
  (`campaignRelations` + `freezeBookings`), so completeness, capacity and economics are enforced exactly as today.
  Deterministic campaign id from the draft id makes retries idempotent. On success the draft stores
  `submitted_campaign_id` and becomes read-only. On failure nothing is created and the draft is unchanged. In Phase 4
  Submit creates `status: 'pending'` (today's hold); Launch creates `active` only if every creative is already approved.
  Phase 5 replaces this with the review transition.
- `lib/firestore-store.ts`: add `campaign_drafts` to `COLLECTIONS` (:20) and load drafts for the new paths; the submit
  path must load what `POST /campaign` loads today (campaigns on the screens, budgets, creatives). Verify.
**UI tasks:** rewrite `components/views/campaign-builder.tsx` as the stepper (or create `campaign-flow.tsx` and route
`new` to it; keep `CampaignBuilder` exports until tests move). Step 3 reuses the Phase 3 library grid and one-step
upload. Step 4 shows list price from `slot_price_month` for the chosen screens. There is no existing "about N plays"
function (`reverseCalculate` in `lib/inventory.ts:133` prices screens, it does not estimate plays); any estimate is new,
must be labelled an estimate, and needs Claude review, or is left out. Save shows success only after the server
confirms; a failed save keeps input and offers retry. "Initial status" disappears.
**Acceptance:** save at Basics with only a name, reload, resume at Basics; save at Screens without budget; no
inventory is held by any draft (a draft on a full screen does not block another booking); Submit with a missing field
fails with the field named and no campaign created; double-click Submit creates one campaign; a draft is invisible to
another user and another org.
**Tests:** new `tests/campaign-drafts.test.cjs` (validation kept and relaxed, no zero defaults, idempotent submit,
tenant isolation); `tests/inventory.test.cjs` and `tests/integration-inventory.test.cjs` unchanged and green;
`tests/firestore-store.test.cjs` / `tests/firestore-emulator.test.cjs` for the new collection; update
`tests/admin.browser.cjs:36-44` and `:89-97` (they drive the old builder fields and "Create campaign" button).
**Risks:** a second write path for campaigns; avoid by making submit call the existing create code, not a copy.
Expiry: pick a value (proposal 30 days) and state it.
**Claude review focus:** drafts cannot reach playback, inventory or economics; no invented zeros; submit uses the
unchanged create path; authorization on every draft route.

### Phase 5 · Review workflow (submit, review, activate)

**Goal:** a campaign goes to review once, the reviewer decides once, and activation is an explicit server transition
with revalidation (doc 30 §6.1-6.2).
**Server work (required).**
- Campaign field `review: {state: 'in_review'|'changes_needed'|'approved_not_started', submitted_at, submitted_by,
  decided_at, decided_by, note, activation_error}`. This records workflow state only. Approval stays on creatives.
- `POST /campaign/:id/submit` (sales, own org): allowed from `pending` or `draft`; runs full validation through
  `freezeBookings` with `status: 'pending'` (capacity held as today); sets `review.state = 'in_review'`. If every
  creative is already approved, the UI offers Launch instead, which calls activate directly.
- `POST /campaign/:id/review` (caps `platform`): body `{creatives: {id: 'approved'|'rejected'}, note}`. Writes each
  creative's `approval_status` and `approved_at` exactly as `lib/api.ts:430-435` does, plus audit. Then:
  all decided and at least one approved → attempt activation in the same request; any rejected and none approved →
  `changes_needed`.
- `POST /campaign/:id/activate` (sales own org, or platform): requires no `pending` creative and at least one approved;
  re-runs `freezeBookings` with `status: 'active'`, which rechecks dates, capacity, budget and org status. On success
  status becomes `active` and `review` is cleared.
- Partial failure: if activation fails after approval (dates passed, screen now full, org inactive), creative decisions
  stand, the campaign stays `pending`, `review.state = 'approved_not_started'` with `activation_error`. Phase 1 status
  shows "Not delivering · Approved, cannot start: <reason>". The seller edits and calls activate again. Rejected
  creatives on an otherwise approved campaign are listed on the campaign as "Changes needed" items but do not block
  activation. Whether a `changes_needed` campaign keeps its capacity hold: proposal keep it (as `pending` does today);
  confirm in Phase 5 review.
- Close the bypass: generic `POST /campaign/:id` may no longer move `draft` or `pending` to `active`
  (`lib/access.ts:173-181`); `active ↔ paused`, `→ complete`, `→ cancelled` stay. `POST /campaign` may no longer
  default to `active` (`lib/api.ts:427`); callers pass a status or use the draft submit path. Check seeds and tests that
  rely on the default.
- `GET /review-queue` (platform): campaigns with `review.state === 'in_review'`, each with its pending creatives and,
  per creative, "also used in N other campaigns (M active)". Needs all campaigns, so platform only.
- `lib/firestore-store.ts`: new `campaign/:id/*` subpaths already match `path[0] === 'campaign'` for budget loading
  (:314); verify they also load creatives and the other campaigns on the targeted screens.
**UI tasks:** `app/admin/page.tsx:229-248` approvals view becomes "Review queue" grouped by campaign, with a
creatives-only tab for filler. Campaign header gains Submit for review / Launch / Activate as the state allows.
Remove Approve/Reject from the Creatives table (`components/views/commercial.tsx`). Phase 1 status now uses rows 2 and
the `approved_not_started` reason.
**Acceptance:** a seller cannot make a campaign active while any assigned creative is pending (UI and direct API);
approving a campaign with valid bookings makes it active in one reviewer action; the same approval with an expired
end date leaves creatives approved and the campaign "Approved, cannot start"; a reused creative shows its other
campaigns before approval; re-uploading media to an approved creative moves its live campaigns to "Not delivering ·
creative awaiting approval" and adds them to the queue (behaviour of `lib/api.ts:446` unchanged, now visible).
**Tests:** new `tests/campaign-review.test.cjs` (transitions, permissions, revalidation, partial failure, bypass
closed, idempotent repeat); `tests/authorization.test.cjs`, `tests/network-authorization.test.cjs`,
`tests/budgets.test.cjs`, `tests/settlement.test.cjs`, `tests/regressions.test.cjs` green; browser case for the queue.
**Risks:** closing the status bypass breaks existing flows that resume a `pending` campaign from the list
(`campaign-list.tsx:21` bulk Resume); route those through activate. Network campaigns are admin-managed; keep that.
**Claude review focus:** no activation without revalidation; approval stored only on creatives; audit entries for
every transition; no billing or receipt code touched.

### Phase 6 · Campaign table and advertiser-portal pages

**Goal:** a Meta-style campaign table with a date range and presets, and advertiser pages that do not repeat one
report three times (doc 30 §3.4, §3.6).
**Data (doc 30 §6.4, corrected):** period plays and people per campaign already come from `/metrics` `byCampaign`
(`lib/reporting.ts:108`); impressions per campaign from `attentionProfiles[key].byCampaign` for the selected profile
(show the profile, never sum profiles). So no new endpoint is needed for those columns. Period spend does not exist
(§2): show "Lifetime spend / budget" and label it so. A period spend column is out of scope unless Sanan asks; it would
need a whole-month view of settlement buckets for `money` users only. If org-wide `/metrics` paging over 30+ days is
slow, add an aggregate-only mode (`/metrics?shape=byCampaign`) later, after measuring.
**Tasks:** (1) `components/views/campaign-list.tsx`: date range (reuse `ReportPeriodBar`), tabs Campaigns | Creatives
| Bookings (selection filters the next tab), presets Delivery (default: status, dates, screens, plays, avg people,
est. impressions, lifetime spend/budget), Money (rate, invoice, settlement; `money` only), Audience (people, looking,
attentive impressions, coverage). Each metric cell shows "—" when unmeasured, never 0. (2) `app/advertiser/page.tsx`:
campaign names clickable (:63) to a read-only `CampaignDashboard` (no Edit, Money, Diagnostics); Delivery becomes a
campaigns home with a compact summary; Where it ran keeps its screens table with the period bar only; Reports keeps the
full `DeliveryReport`; drop `soon` from `lib/nav.ts:89`. (3) `app/admin/page.tsx:181` and `app/operator/page.tsx:171`
overviews: replace the full report with a compact summary (four cards, one chart) and "Open analytics"; replace
`isLive` counts with Phase 1 status.
**Server changes:** none expected; optional aggregate mode after measurement. Advertiser access to `GET /campaign/:id`
already exists (`campaignView` for `ADVERTISER`, Firestore filter `lib/firestore-store.ts:379`); verify eligibility
from Phase 1 is hidden or reduced for advertisers.
**Acceptance:** table metrics for a range equal `/metrics?campaign=<id>` for the same range; changing the range updates
every metric column; advertiser can open a campaign and cannot see money or diagnostics; no page shows the full report
twice.
**Tests:** `tests/reporting-ui.test.cjs`, `tests/reporting.browser.cjs` green; update `tests/admin.browser.cjs:64-69`;
new advertiser-portal browser case; `tests/authorization.test.cjs` for advertiser campaign reads.
**Claude review focus:** unmeasured shown as "—"; profile separation kept; lifetime versus period labels; advertiser
redaction.

---

## 4. Out of scope

- Commercial review of rates, dates or budget.
- Stored campaign-level approval separate from creative approval.
- Any change to billing, receipts, settlement, budget accrual, measurement or attention definitions.
- Using impressions or attention in pricing or billing.
- Moving creatives under campaigns in the data model, or any migration of existing records.
- Period spend reporting, invoices, payments (WP6).
- Maps in the Screens step, API keys, webhooks, settings architecture (doc 20).

## 5. Definition of done per phase

| Phase | Done when |
|---|---|
| 1 Status | `lib/campaign-status.ts` and badge live on list, detail and inbox; no Live without receipts; Unknown shown when no evidence; dead column removed; `/metrics` numbers unchanged; new and existing tests green; Codex log entry names the evidence window; Claude review passed |
| 2 Dashboard | Campaign page uses header, four cards with cues, one chart, five tabs; headline values equal old card values in tests; the eight other `DeliveryReport` pages unchanged; reporting suites green; Claude review passed |
| 3 Workspace | Advertiser tabs, pre-filled New campaign, library grid with one-step upload; old URLs work; tests green; Claude review passed |
| 4 Drafts and flow | Server drafts per §6.9 with kept and relaxed validation as listed; no holds or frozen economics for drafts; submit uses the unchanged create path and is idempotent; stepper with Save draft on every step; tests green; deployed and tried on Sanan's screens; Claude review passed |
| 5 Review | Submit, review and activate transitions with revalidation and the stated partial-failure behaviour; status bypass closed; review queue by campaign with reuse counts; audit entries; tests green; Claude review passed |
| 6 Table and portal | Table with range and presets from `/metrics`; advertiser campaign pages read-only; no duplicated report; lifetime and period labelled; tests green; Claude review passed |
