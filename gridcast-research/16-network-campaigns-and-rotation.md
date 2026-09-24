> Scheduling update —25September2026: the fixed-loop timing and slot-unit capacity sections below are superseded by [continuous playback and offline media](19-continuous-playback-and-offline-media.md). Distinct advertiser ceilings, tenancy and frozen economic terms remain in force.

# Network campaigns, creative rotation, and the demo network

**Written:** 25 Sep 2026 · **Base:** `93eb350` · live `build-2026-09-24-007` (`5b18cae`)
**Status:** build plan, approved by Sanan (route B). For Codex to implement.
**Why:** Sanan's demo network — Gridcast-onboarded advertisers running across every operator's screens — is
the Phase 2 network product (spec `06` §4D). It is modelled in the code and cannot be created through any API.
Seeding it as operator-locked data would teach us nothing about whether the model works.

---

## Part 1 — Network campaigns

### 1.1 What exists already

`origin_org_id`, `campaign_type`, `platform_fee_pct`, `fee_basis`, `network_available`, `network_slots` are all
present, and `campaignRelations` (`lib/access.ts:124`) already resolves an advertiser/creative from
`origin_org_id` when `campaign_type === 'network'`. Two things block creation:

- `lib/access.ts:127-128` — every screen must satisfy `s.org_id === c.org_id`.
- `lib/access.ts:172` and `lib/api.ts:378` — creation hardcodes `campaign_type: 'operator'`.

So this is an unblocking-plus-enforcement slice at the access layer — **but not only there.** Corrected after
review: the storage layer blocks it too, and that is the part that needs design rather than permission.
See §1.10.

### 1.2 Ownership shape

For a network campaign: `org_id === origin_org_id === <gridcast org>`. The advertiser and every creative belong
to that org (the existing `sourceOrg` branch already expects this). Screens may belong to **any** org.

- Creation and editing of `campaign_type: 'network'` requires `platform_admin`. An operator can never create
  one, and can never change a campaign's type.
- `campaign_type` is immutable after creation. An operator campaign cannot become a network campaign or back.

### 1.3 Screen eligibility for network booking

A screen may carry a network booking only if **all** hold:

1. `screen.network_available === true`
2. `screen.network_slots > 0`
3. the screen's org is active
4. the screen's own exclusions permit the creative (unchanged — screen-level blocks always win)

### 1.4 Capacity — two independent limits, resolved after second review

**The unit, stated once.** `advertiser_slots` and `network_slots` are both counts of **distinct advertisers**.
`physicalCapacity` (loop ÷ slot) and a booking's `slots_per_loop` are counts of **appearances**. They are not
interchangeable, and `network_slots` is not being migrated to appearances.

Two limits, both enforced on every booking:

```
ENTITLEMENT   distinct advertisers with live bookings on the screen   ≤ advertiser_slots
              of those, distinct network-origin advertisers           ≤ network_slots   (at booking time)
AIRTIME       Σ (appearances × longest creative duration)             ≤ physicalCapacity × slot_duration_s
```

**Operator availability is computed from outstanding commitments, never from the release number:**

```
operator entitlement available = advertiser_slots − distinct advertisers already committed (network included)
```

The first draft said `advertiser_slots − network_slots`, which double-sells the screen. Worked example, the one
from the review: `advertiser_slots: 10`, six network advertisers committed, release cut from 6 to 2.

| | First draft | Correct |
|---|---|---|
| New network bookings | refused (6 ≥ 2) | refused (6 ≥ 2) |
| Operator availability | 10 − 2 = **8** → 14 total, oversold | 10 − 6 = **4** |

Both recover as commitments expire. A grandfathered booking continues to occupy **both** its entitlement and
its airtime until it does.

**Two different switches, deliberately separate:**

- `network_available: false` or a reduced `network_slots` → blocks **new** network bookings. Retained
  commitments keep delivering. This is the operator's normal control.
- Stopping delivery of an already-sold commitment is a different act — it breaks a booking an advertiser paid
  for. It needs its own explicit, audited action and is visible to the platform, never a side effect of moving
  a number down.

### 1.5 Fees: per booking, not per campaign

A network campaign spans orgs with different negotiated fees, so a single `campaign.platform_fee_pct` cannot be
right. Snapshot on each booking at creation:

```
booking.platform_fee_pct   from the SCREEN's org  platform_fee_pct  at booking time
booking.fee_basis          'gross' | 'net_of_owner_share'
booking.owner_share_pct    from the screen at booking time
booking.fee_version        id for this snapshot, carried onto assignments and plays
```

The org field is `platform_fee_pct` (`lib/seed.ts:39`), not `default_platform_fee_pct` — that name is the
spec's, not the code's. Define the two bases explicitly and once:

```
fee_basis = 'gross'                → platform_fee = gross × pct
fee_basis = 'net_of_owner_share'   → platform_fee = (gross − owner_share) × pct
rounding: to paise, half-up, applied once at each line, never re-rounded downstream
flat-rate campaigns: gross is the pro-rata daily share of rate_value, not per play
```

`booking.rate_version`, `booking.fee_version` and `owner_share_pct` must all be carried onto the assignment and
stamped onto the play. **None of them are today** — `rate_version` exists on the booking (`lib/api.ts:37`) and
the screen only, and `lib/devices.ts` writes neither it nor any fee field onto assignments or plays. This whole
provenance chain is new work, not an extension of an existing one (see §1.6). Without it, an offline box
flushing yesterday's backlog after a rebooking settles at today's economics.

Renegotiating an operator's fee must never rewrite what was owed on bookings already made. `campaign.platform_fee_pct` stays for operator campaigns (always 0) and for display.

### 1.6 Settlement — order, rounding and flat rates, resolved after second review

The first draft was circular: the net-of-owner-share fee depended on the owner share, and the owner share
depended on the fee. Order is now explicit. **Money is integer paise throughout.** Round half-up once per line;
the residual always lands in `operator_net`, so the identity holds exactly.

```
fee_basis = 'gross'
  platform_fee   = round(gross × platform_fee_pct)
  operator_gross = gross − platform_fee
  owner_share    = round(operator_gross × owner_share_pct)
  operator_net   = operator_gross − owner_share            // residual absorbed here

fee_basis = 'net_of_owner_share'
  owner_share    = round(gross × owner_share_pct)          // owner first, from gross
  platform_fee   = round((gross − owner_share) × platform_fee_pct)
  operator_net   = gross − owner_share − platform_fee      // residual absorbed here

invariant, both bases:  gross = platform_fee + owner_share + operator_net
```

Worked, gross ₹1,000.00 = 100 000 p, fee 10%, owner 25%:

| | gross basis | net-of-owner basis |
|---|---|---|
| platform fee | 10 000 | 7 500 |
| owner share | 22 500 | 25 000 |
| operator net | 67 500 | 67 500 |
| sum | 100 000 ✓ | 100 000 ✓ |

**`per_play`** accrues only on billable plays — unchanged.

**`flat`** is a time buy and needs its own rules, which the first draft did not give:

- Billing period is the calendar month, clipped to the flight.
- Period gross = `rate_value × (flight days inside the period ÷ total flight days)`.
- Allocated across screens pro-rata by `booked appearances × days booked` — by commitment, not by delivery.
- **Zero delivery — OPEN, Sanan's decision, do not implement either way yet.** A time buy conventionally stays
  owed when nothing plays, but that is a commercial policy, not something derivable from a `rate_type` label,
  and this document cannot settle it by asserting it. Whichever way it goes, the line carries
  `delivery_shortfall` with measured and unmeasured counts beside it, and zero delivery is never presented as
  delivery.
- **If the policy is "still owed", the accrual path must change.** A `settlement_bucket` updated only when a
  play receipt arrives cannot account for an obligation with no plays. Flat then needs a deterministic
  period/booking accrual — written from the booking on a period boundary, independent of receipts — with the
  same idempotency guarantees. This is additional work and does not block rotation or the per-play slice.
- `rate_value` for `flat` means the **total flight amount**, not per month and not per day. Paise remainder
  from the pro-rata split is allocated by a stable deterministic rule (largest-remainder over periods, then
  over screens, ordered by screen id) so repeated computation gives the same answer.
- Tests: zero delivery, partial-period flights, and an offline backlog reconciling into a period that has
  already been accrued.

**Provenance is not already done.** The first draft said fee versions should be carried "the same way
`rate_version` already is". Corrected: `rate_version` exists on the booking (`lib/api.ts:37`) and the screen,
and is **not** carried into assignments or plays. Carrying `rate_version`, `fee_version` and `owner_share_pct`
through assignment → play is new work in this slice, and it is what makes an offline backlog settle at the
economics in force when it played.

### 1.7 Visibility — the rule that makes operators willing to release inventory

*Transparent vertically, isolated horizontally*, applied to a campaign that spans orgs:

| Viewer | Sees |
|---|---|
| Platform admin | Everything: all screens, all orgs, network totals |
| Operator (screen's org) | The network campaign as it runs **on their own screens only** — their plays, their gross, the fee taken, their share, their net, fully decomposed. **Not** other operators' screens, and **not** the campaign's network-wide totals |
| Advertiser viewer | Their own delivery and spend across screens; no operator economics, no owner shares |

Concretely: a campaign read by an operator must be filtered to `bookings`/`screen_ids`/plays for their org
before it leaves the server. This is a scoping change in the campaign read path, not a UI filter.

### 1.8 Eligibility additions

- Screen exclusions (category, advertiser) already apply and still win over targeting. Unchanged.
- Competitive separation already applies per loop (`lib/inventory.ts:241`). Unchanged.
- **Corrected after review: advertiser-side venue exclusions already exist.** `lib/inventory.ts:240` rejects at
  step 7 with `advertiser_venue_block`, covering `venue_types`, `screens` and `tag_rules`. The actual gap is the
  editing surface — `ADVERTISER_EDIT` has no `exclusions` field, so nothing can set them. Add validated editing
  and UI, not a new rule.
- Emit `advertiser_archived` from `eligibility()` — the reason code exists in `lib/readiness.ts:16` and nothing
  produces it (found in the 25 Sep review). Archive enforcement should be defence in depth, not one branch.

**Preserve `slotUnits` as it is.** It rounds each creative's duration **up** to a slot quantum, which is the
conservative airtime check. None of the above changes allocation semantics, and nothing here licenses relaxing
it.

### 1.9 Tests that must exist

1. An operator cannot create, edit or convert a network campaign (403), by any route.
2. A network campaign cannot book a screen with `network_available: false` or `network_slots: 0`.
3. Network bookings exhaust the `network_slots` entitlement ceiling and then refuse, while distinct-advertiser
   headroom still remains within `advertiser_slots` for operator bookings — and the mirror case. `network_slots`
   is a **ceiling inside the shared distinct-advertiser total**, not a reserved pool beside it.
4. Reducing `network_slots` below committed leaves live bookings intact and blocks the next booking.
5. Fee and owner share are snapshotted per booking: changing the org's fee afterwards does not move settled
   numbers.
6. Operator A reading the campaign sees only A's screens, plays and money; never B's, never the network total.
7. Advertiser viewer sees delivery, never operator economics.
8. A screen-level advertiser or category block still wins over a network campaign that targeted it.
9. Settlement decomposition sums exactly: gross − fee − owner share = net. For `per_play`, the base is billable
   plays only, diagnostics excluded. For `flat`, the base is the period's pro-rata commitment, which does not
   depend on play counts at all — do not apply the billable-play filter to a flat line.

---

## Part 2 — Creative rotation (the A/B defect)

### 2.1 The bug

`lib/api.ts:55-57`:

```js
for (let n = 0; n < (booking?.slots_per_loop ?? default); n++)
  eligible[n % eligible.length]
```

Rotation happens only **across the slots within one loop**. With one slot per loop and two creatives, `n` is
only ever `0`: creative B never airs. An A/B test silently runs 100/0. Two slots and two creatives works.

### 2.2 The fix

Rotate by **playlist period**, offset per screen:

```js
// rotation_index is CHOSEN AND PERSISTED WITH the assignment set, at mint
const pick = eligible[(set.rotation_index + salt + n) % eligible.length];
const salt = hashToInt(screen.id);   // so screens don't move in lockstep
```

A retry reuses the set's stored index; polling never advances it. The test promise is therefore **one set per
renewal lifecycle** (plus genuine content or config changes) — not a literal maximum of one mint per rolling
hour, which the final-minute renewal makes untrue.

**Corrected after review.** The first draft keyed rotation to `Math.floor(now / ASSIGNMENT_TTL)` — a calendar
hour. Assignment sets are not calendar-anchored: they expire at issued-at + 1 h and are renewed in their final
minute (`valid_until > now + 60e3`). A calendar flip mid-life would change the signature while the set is still
valid and mint an extra set. Tying the index to the set's own lifecycle makes rotation advance exactly once per
mint, by construction.

Why per period and not per loop: assignments are reused for an hour and their signature covers the creative.
Rotating per loop would change the signature every loop and mint a new assignment every loop — undoing the
bound that took four review rounds to establish. Per period costs one mint per lifecycle, which is already the rate.

Why the screen salt: without it every screen in the network shows creative A in the same hour, so an A/B result
is confounded with time of day. With it, A and B are spread across the fleet at any given hour.

### 2.3 Tests

- One slot, two creatives, twelve consecutive periods → both creatives appear, roughly evenly.
- Rotation at an assignment boundary, at early renewal in the final minute, and across a retry → exactly one
  mint per **renewal lifecycle**, no extra set. (Not one per rolling hour: final-minute renewal makes that
  false by construction.)
- Two slots, two creatives → both appear in the same loop (unchanged behaviour).
- The assignment ledger still mints at most one set per renewal lifecycle per screen under rotation — rotation
  adds no mints of its own.
- The served item still matches its stored assignment evidence exactly (the 18:26 invariant).
- Two screens in the same hour are not guaranteed to show the same creative. (The salt distributes; it does
  not guarantee an exact simultaneous split, and should not be described as one.)

### 2.4 Known limit to write down

This is round-robin, not weighted variations. `campaign_variation` with weights and per-variation caps stays
Phase 2 (spec §5). Do not describe hourly rotation as a weighted A/B system.

---

## Part 3 — The demo network

Seed **through the API as the platform admin**, not by writing documents. If the seed can't be created through
the product, the product can't create it.

### 3.1 Organisations

| Org | Type | Fee | Screens |
|---|---|---|---|
| Gridcast Network | `gridcast` | — | 4 |
| Sector 17 Media | `operator` | 10% | 3 |
| Tricity Screens | `operator` | 12% | 3 |
| Mohali Retail Media | `operator` | 10% | 2 |

### 3.2 Screens — 12, identical config

600 s loop · 10 s slot · `advertiser_slots: 10` · `network_available: true` · `has_camera: true` ·
operating hours 09:00–21:00. Venue types and sizes varied (cafe, gym, kirana, salon; 32–55") so pricing factors
differ while the loop maths stays uniform.

**Corrected after review — three different quantities were conflated in the first draft:**

```
physical capacity      = loop_length_s / slot_duration_s        = 60 appearances per loop
advertiser_slots = 10  = how many DISTINCT ADVERTISERS may share the screen
defaultSlotsPerLoop    = physical capacity / advertiser_slots   = 6 appearances per campaign
```

(`lib/inventory.ts:66-68`.) So nine campaigns do not consume "nine of ten slots": they come from **six**
advertisers, which is six of ten distinct-advertiser entitlements, and at the default each would take six
appearances per loop — 54 of 60 — not one. The seed must therefore set **explicit `slots_per_loop: 1` bookings**
rather than relying on the default. The unit question is already settled in §1.4 — `network_slots` counts
distinct advertisers, `slots_per_loop` counts appearances — and the seed must be written against that, not
re-decide it.

### 3.3 Advertisers — 6, all owned by Gridcast

Distinct categories, deliberately, so competitive separation doesn't knock them out of the same loop:

| Advertiser | Category |
|---|---|
| Coca-Cola India | `beverage` |
| Mercedes-Benz India | `automotive` |
| Oreo India | `snack` |
| Nike India | `apparel` |
| Amul | `dairy` |
| Swiggy | `delivery` |

### 3.4 Campaigns — 9, all `network`, all 12 screens

Seven carry one creative; **two carry two** (Coca-Cola and Nike) to exercise rotation. Rates and budgets vary so
settlement produces different numbers per operator. Flight dates all currently active.

### 3.5 Creatives

Real brand ads, 10–20 s. Two constraints:

- **Duration must be verified before seeding.** The billing check requires observed playback ≈ declared
  duration; a wrong `duration_s` marks every play non-billable and a burn-in will look broken when it isn't.
- **For endurance testing, prefer uploaded MP4s over YouTube IDs.** The upload path measures duration with
  ffprobe, so the declared value is derived rather than typed, and playback doesn't depend on YouTube's player,
  autoplay policy or network. Use YouTube IDs for demo realism; use uploaded files for the 72-hour burn-in.

### 3.6 Idempotency

The seed runs against a live environment that already holds the real admin, the Test screen and its paired
device. It must be idempotent and additive: re-running changes nothing that exists, creates nothing twice, and
never touches records it did not create. Give every seeded record a stable external key.

### 3.7 Seed acceptance

Running the seed produces: 4 orgs, 12 screens, 6 advertisers, 9 network campaigns, 11 creatives, every campaign
eligible on every screen, and a playlist on any screen showing nine items. Coca-Cola and Nike alternate
creatives hour to hour, and not in lockstep across screens.

---

## 1.10 The storage layer — corrected after review, and the real work

The access layer is not the only thing that stops a Gridcast campaign running on an operator's screen.
`lib/firestore-store.ts` enforces tenancy below it, and it is right to:

- **Device snapshot scoping** (`:181`) loads campaigns for a device by `screen_ids array-contains`, within the
  requesting org. A Gridcast-owned campaign is not visible to a device paired to operator B's screen.
- **Offline reload** re-checks the assignment's org (`:213`), so a backlog flushed later fails the same way.
- **Play reports** are org-filtered on read.
- **The write guard** (`:277`) rejects any write whose row org differs from the request's allowed org. A device
  on B's screen accruing spend onto a Gridcast campaign document is exactly that write — 403.

**Do not punch a hole in the write guard.** It is the single control preventing cross-tenant corruption, and an
exception for "network campaigns" would be the widest hole in the system.

**Proposed instead — settlement buckets in the screen's own org.** Resolved after second review: one row per
(campaign, org) carrying a single gross is not enough — it loses the split across screens, fee versions and
accounting periods, so full decomposition cannot be recovered from it. The authoritative unit is:

```
settlement_bucket/{campaign}__{screen}__{period}__{econ_version}
  org_id: <SCREEN's org>                     ← existing write guard passes untouched
  campaign_id, screen_id, period            (YYYY-MM, by DELIVERY time)
  rate_version, fee_version, fee_basis, platform_fee_pct, owner_share_pct
  billable_plays
  gross_paise, platform_fee_paise, owner_share_paise, operator_net_paise
  first_at, last_at, updated_at
```

- Updated **atomically with the play receipt**, in the same transaction, and idempotent on the play's own id —
  a replayed report must not double-count.
- A late offline report belongs to the period it **played** in, not the period it arrived in.
- `campaign_org_accrual/{campaign}__{org}` survives only as a cheap derived rollup for budget alerts. It is
  never the authoritative number and nothing settles from it.
- Every view projects these by role and tenant — directory, bootstrap, campaign detail, analytics and export —
  not campaign detail alone.

The row's `org_id` is still the screen's org, so the guard needs no exception, and totals stay bounded by
(orgs × screens × periods) rather than play volume — independent of the 1,500-row history window.

Device snapshot scoping still needs a narrow, explicit widening: a device may load a campaign whose
`screen_ids` contains its own screen **and** whose `campaign_type` is `network`, regardless of org — with its
own Firestore index, and with the play/assignment org checks re-expressed against the *screen's* org rather
than the campaign's.

**Settlement cannot be computed from `/bootstrap`.** Human history reads cap at 1,500 rows with truncation
metadata; any figure derived from a partial read must either say so or come from the accrual documents.

---

## Order

1. **Assignment-aligned rotation** (Part 2) — small, independent, and the A/B demo is wrong without it.
2. **The network slice as one piece**: storage scoping + per-org accrual (1.10), creation and authorization
   (1.2–1.3), the two independent capacity limits (1.4), immutable per-booking economics (1.5–1.6) and cross-org visibility
   (1.7). Corrected after review: these are not separable. Shipping capacity without isolation, or economics
   without immutability, produces a system that is briefly wrong in ways that are expensive to unpick.
3. **Advertiser exclusion editing** (1.8) and archived-advertiser eligibility defence in depth.
4. **The demo network** (Part 3), seeded through the API, idempotent against live data.
5. **Then** the endurance work — burn-in, chaos pass, alerting, CI, rollback drill.

## Do not

- Do not let an operator create, edit or convert a network campaign.
- Do not treat `network_slots` as a pool reserved beside `advertiser_slots`; it is a ceiling inside the same
  distinct-advertiser total (§1.4). Subtracting one from the other double-sells.
- Do not show one operator another operator's screens, plays or money — at any aggregation level.
- Do not write the seed directly to Firestore; it must go through the API as the platform admin.
- Do not call hourly rotation a weighted A/B system.
- Do not relax the Firestore cross-organisation write guard.
- Do not compute settlement from a truncated `/bootstrap` read.
