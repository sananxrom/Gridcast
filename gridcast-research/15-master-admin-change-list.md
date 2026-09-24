# Master admin — full change list

**Written:** 25 Sep 2026 · **Against:** deployed commit `aeb61ca`, verified in the working tree
**Relates to:** `14-platform-admin-workflow-proposal.md` (Codex's analysis). This is the implementable list: every
item below was checked against the code, not inferred.

---

## What is actually true today

| Claim | Verified | Evidence |
|---|---|---|
| Platform admin holds every capability | Yes | `lib/roles.ts` — `screens, sales, money, team, org, platform` |
| The server already allows cross-org reads and writes for that role | Yes | `lib/access.ts:13-27` — `own()` skips the org check for admins |
| Admin nav has no Advertisers and no Creatives library | Yes | `lib/nav.ts:52-80` — Platform + Demand groups only |
| The advertiser API is create-only | Yes | one route, `POST /advertiser` (`lib/access.ts:42`, `lib/api.ts:368`). No read, edit, archive |
| Campaign builder can create an advertiser inline | Yes | `components/views/campaign-builder.tsx:41,69` |
| …but attaches it to the signed-in org, not the selected one | **Yes — this is a bug** | `campaign-builder.tsx:41,69` use `user.org_id` while `:33,48,74` use `selectedOrg` |
| `/operator` rejects a platform login | Yes | `app/operator/page.tsx:43` — `tabFor(u.role) !== 'operator'` → redirect |
| `has_camera` is settable only at screen creation | Yes | `screen-onboarding.tsx:25,44,65`; absent from `screen-detail.tsx` |
| Creative upload exists but only inside `/operator` | Yes | `CreativeUpload` imported at `app/operator/page.tsx:26`, used at `:457` |
| **The eligibility reasons already exist server-side** | Yes | `lib/api.ts:36-53` builds `decisions` with `reason` and `rejected_at_step`; `GET /screen/:id` returns them (`:321`). Nothing renders them |

The last row is the important one. The answer to *"why is my screen showing Waiting for an eligible campaign"*
is already computed and already on the wire. It is a rendering gap, not an engineering problem — and it is the
cheapest item on this list.

---

## A. Unblock the commercial path for the master admin

**A1. Advertiser lifecycle API.** Today: create only.
Add `GET /advertiser/:id`, `POST /advertiser/:id` (edit), `POST /advertiser/:id/archive`.
- `lib/access.ts`: three `ROUTES` rows with `caps: ['sales']`; an `ADVERTISER_EDIT` allowlist
  (`name, contact, email, phone, category, notes`); `own(db.advertisers, id, actor)` on each — note the
  ownership chain in `authorize()` currently has **no generic advertiser branch**, so this must be added
  explicitly rather than assumed.
- Archive sets `status: 'archived'`; it never deletes. Archived advertisers disappear from pickers and stay in
  history. **Corrected after review:** `paused` campaigns also reserve inventory and can resume, so the refusal
  must cover `active`, `pending` *and* `paused`, a campaign must not be activatable while its advertiser is
  archived, and there must be an explicit restore. Hiding an advertiser from a picker is not archiving.
- Acceptance: an operator cannot touch another org's advertiser (404); an archived advertiser cannot be
  selected for a new campaign; past plays and settlement lines still resolve its name.

**A2. Admin Advertisers screen.** `lib/nav.ts` — add `advertisers` under Demand. `app/admin/page.tsx` — list
(name, org, campaigns, spend, status), detail, create, edit, archive. Advertiser search results must route to
the advertiser, not to Campaigns.

**A3. Admin Creatives library.** Add `creatives` under Demand: every creative with org, advertiser, duration,
aspect, approval state, and the upload control. Reuse `CreativeUpload` (`components/views/creative-upload.tsx`)
rather than writing a second uploader. Approval stays where it is; this is the library, not the queue.

**A4. Shared components, not a second operator UI.** Extract the advertiser/creative/campaign views used by
`/operator` into components that take an explicit `orgId` prop. `/admin` renders the same components with the
selected org. Do **not** relax the `/operator` guard at `app/operator/page.tsx:43`, and do not give the admin an
operator session — one identity, explicit context.

---

## B. Organisation context correctness

**B1. Fix the cross-org attachment bug — but not by swapping one variable.**
`campaign-builder.tsx:41,69` post `user.org_id` where the rest of the form uses `selectedOrg`, so an admin
working inside operator B files new advertisers under Gridcast. **Corrected after review:** posting
`selectedOrg` instead is *not* a fix, because `selectedOrg` is itself derived from the chosen advertiser and
falls back to `user.org_id` (`campaign-builder.tsx:33`) — which is exactly the case that matters, creating an
advertiser when none is selected. The form needs an explicit selected-organisation context of its own
(B2) before any of these creation paths can be trusted; do B2 first and B1 falls out of it.

**Also corrected:** the server-side relationship checks are **already enforced**, for creatives
(`lib/access.ts:164-165` — advertiser org must equal creative org) and for campaigns
(`campaignRelations` at `:156`). They do not need extending; they need a regression test so this fix does not
quietly weaken them. The remaining hole is client-side attribution, not server-side validation.

**B2. One context, everywhere.** The org selector must feed every creation form, every list and every deep
link. Switching org clears selected advertiser / creative / screen / group state so a stale id can never be
submitted across the boundary.

**B3. Ownership visible on every row and detail page.** With "All organisations" selected, the owning org is a
column, not a guess.

**B4. Team and advertiser logins.** `components/views/account.tsx:349` defaults new people to the signed-in org
and offers no advertiser-viewer option, though the backend supports scoped advertiser invitations
(`lib/access.ts:273`). Add the org selector and the advertiser binding to `AddPerson`, and remove the
"not built yet" panel in the admin Team view.

---

## C. Screens: camera, and honest readiness

**C1. `has_camera` in Edit Screen.** `components/views/screen-detail.tsx` — render and persist it. It is already
in `SCREEN_EDIT` (`lib/access.ts:58`), so this is UI only.

**C2. The player must notice.** `app/player/page.tsx` initialises the camera exactly once, at boot
(`void pull().then(...)`), so flipping the flag does nothing until someone reloads the browser — and if the
first playlist pull fails, the camera is never started at all for the life of the page. Re-evaluate camera
state whenever a playlist arrives with a changed `has_camera` or `config_version`, and retry initialisation on
a later pull if the first attempt never ran. Codex has local camera fixes already written and tested — fold
them into this change rather than doing it twice.

**C3. Surface the readiness reasons that already exist.** On the screen detail page, render
`eligibility[]` from `GET /screen/:id`: per campaign/creative, eligible or not, `rejected_at_step`, `reason`.

Three corrections after review, all verified:
- **Budget exhaustion is not a rejection.** `lib/inventory.ts:224` pushes `budget_exhausted_manual_action` as a
  *warning*; stopping delivery is always an explicit status action. Showing it as a blocking reason would be
  wrong. Same for aspect: a mismatch letterboxes, it does not block.
- **The empty cases produce no decision at all.** `decisions` iterates the creatives of campaigns that already
  target the screen (`lib/api.ts:36-53`), so "no campaign targets this screen" and "the campaign has no
  creative" render as an empty list, not as an explanation. Those two states need to be stated explicitly by
  the UI rather than inferred from silence.
- **The player does not receive decisions.** They are on the human `GET /screen/:id` only; the device playlist
  response omits them (`lib/devices.ts`). The player's "Waiting for an eligible campaign" needs its own small
  readiness summary in the playlist payload — and that payload goes to an unattended box in a shop, so it
  carries a reason, never commercial detail.

Do **not** infer a browser permission state from heartbeat data that does not carry one; report the camera as
*not reported* when that is what is true.

**C4. Camera readiness on the screen row.** Paired, camera enabled, last sample seen, model loaded — sourced
from what the device actually reports (`agent_ver` currently carries `camera-unavailable`), never assumed.

---

## D. Diagnostic playback — "Run screen test"

The point is to check hardware without inventing a customer. The constraints matter more than the feature:

**D1. Server-classified, never client-asserted.** A test play is one the server issued a test assignment for.
Do not accept a `test: true` flag on `/play` — the device does not get to classify its own reports.

**D2. A separate assignment kind.** `POST /screen/:id/test` (caps `screens`, org-checked) issues a
short-lived, single-use assignment with `kind: 'diagnostic'`, a platform-owned test clip, `rate_value: 0` and no
campaign. Plays reported against it are written with `billable: false`, `diagnostic: true`, and are excluded
from accrual, budgets, campaign reporting, advertiser views and settlement.

**Corrected after review:** excluding them in the campaign `agg()` alone is not enough — screen statistics,
`/bootstrap`, and the admin and operator views all consume `plays` and `presence` directly. Either write
diagnostic results to their own collection, or enforce the exclusion on every commercial ingestion, read and
aggregation path, with a test that asserts commercial totals are byte-identical before and after a diagnostic
run. The assignment itself must be device-bound, single-use and atomic, idempotent on retry, expiring and
revocable — the same properties the commercial path took four review rounds to get right.

**D3. It must not disturb live delivery.** A test is requested explicitly, runs at the next slot boundary, and
never pre-empts a playing advertisement.

**D4. Measurement policy is unchanged.** `measure_during_play_only` stays locked and true: detection runs
during the test clip, not continuously while idle. Any count shown is labelled a diagnostic sample and is never
presented as campaign presence. Frames stay on the device.

**D5. Auditable.** Who ran it, on which screen, when, and what came back.

---

## E. Guardrails this adds pressure to

**E1. Audit trail.** There is none today. Admin mutations that cross an org boundary need actor, target org,
entity, action, timestamp and a safe diff. This is now the difference between "the platform can fix an
operator's data" and "nobody can say who changed it".

**E2. Scoping and pagination.** `GET /bootstrap` for an admin reads globally against a 2,000-row domain cap.
**Corrected after review:** this does not silently truncate — `lib/firestore-store.ts:64-69` fetches `limit + 1`
and throws a 503 ("requires pagination before it can be changed safely") above the cap, and play history is
bounded with truncation metadata. So the failure mode is loud unavailability, not quiet wrong numbers, which is
the better of the two. Org-scoped server queries and pagination are still needed — the admin console stops
working entirely at that boundary — but this is an availability cliff, not a correctness leak.

**E3. Consistency with the open items from the trust review.** Media grants still survive device revocation;
assignment rows still have no cleanup; `model_ver` is still a constant rather than read from the loaded graph.
None block this work; all three get worse to fix once real operators and real advertisers exist.

---

## Do not

- Do not give the admin an operator session, rewrite their role, or impersonate. One identity, explicit context.
- Do not create a fake advertiser or a "Gridcast internal" customer to make test playback work.
- Do not let a client flag decide whether a play is diagnostic.
- Do not cascade on archive, and do not delete records to make a list look clean.
- Do not present a diagnostic count anywhere a campaign number is expected.

---

## Order

| # | Work | Why here |
|---|---|---|
| 1 | C1 + C2 + C3 (camera field, player re-init, honest readiness) | Hours, not days; unblocks your dead-end screen. C1 without C2 changes nothing until a manual reload |
| 2 | B2 + E1 + E2 (explicit org context, audit, scoped reads) | **Reordered after review:** context and audit must exist *before* the first multi-org write, not after the UI that performs them. B1 falls out of B2 |
| 3 | A1–A4 + B3–B4 (advertiser, creative, campaign, team lifecycle) | The "master admin can run the business" slice, now safe to point at another org |
| 4 | D (diagnostic playback) | **Reordered:** independent of A — it needs no advertiser by design, so it does not wait on the CRUD slice |
| 5 | End-to-end regressions | The admin journey, cross-tenant denials, and a test proving diagnostics move no commercial number |

**Acceptance for the whole slice:** from an empty organisation, using only the master-admin login — create an
advertiser, upload and approve a creative, create an active campaign, target a screen, see it play, and see the
presence evidence — with no database edit, no second account, and no fake customer anywhere in the path.
