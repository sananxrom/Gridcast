# Platform administrator: complete operating workflow

Status: proposal for Sanan; not implemented or deployed. Based on reviewed application commit `aeb61ca` and the current working tree (whose existing camera fixes remain separate).

## Finding

The master administrator already has screens, sales, money, team, organisation and platform capabilities (`lib/roles.ts:34`). Server ownership checks allow that authenticated role to manage supported resources across organisations (`lib/access.ts:13–27`). The interface exposes only part of this authority. Creating a second operator login should not be necessary to operate Gridcast-owned inventory.

Confirmed gaps:

- `lib/nav.ts:52–80` and `app/admin/page.tsx` expose Campaigns and Approvals, but no Advertisers management or full Creatives library. Advertiser search results incorrectly lead to Campaigns rather than an advertiser detail page.
- `components/views/campaign-builder.tsx:93–105` DOES offer an inline “New advertiser” and “Create advertiser” action. Campaign creation is not universally impossible, but this is poorly discoverable and does not provide client management.
- New inline advertisers use `user.org_id` (`campaign-builder.tsx:41,69`). The admin organisation selector filters lists; it is not passed into creation forms. Selecting an operator can therefore leave creation attached to Gridcast instead of that operator.
- The advertiser API supports creation but no dedicated edit/archive routes (`lib/access.ts:42`, `lib/api.ts:368`). Adding a navigation item alone would not deliver “manage advertisers.”
- `/operator` explicitly rejects platform accounts (`app/operator/page.tsx:43`). Operator-only advertiser/creative components cannot currently be reached with the master-admin session.
- Team creation defaults to the signed-in organisation, with no advertiser-login selection in the current AddPerson form (`components/views/account.tsx:349`). The backend already supports scoped advertiser invitations. The admin Team view also renders a contradictory “not built yet” panel.
- Camera availability is selectable only at screen creation (`components/views/screen-onboarding.tsx:65`); Edit Screen neither renders nor saves `has_camera` (`components/views/screen-detail.tsx:60–70,95–128`). This corrects the earlier advice to simply enable it on an existing screen.

## Recommended access model

One master-admin login, operating at platform, organisation, screen and advertiser levels. Keep the signed-in administrator's real identity throughout; do not rewrite their role/org to impersonate an operator.

Use the existing organisation selector consistently:

- **All organisations:** global lists and oversight, with visible ownership on each row. Creation requires an explicit owning organisation; when only Gridcast exists, show that selection clearly.
- **One organisation:** a complete workspace containing Advertisers, Creatives, Campaigns, Screens, Groups, Team and that organisation's settings/reporting. Default all new records to this context. Detail pages show their actual owning organisation.
- Switching context must reset incompatible advertiser, creative, screen and group selections; navigation/search/deep links must preserve the intended context.
- Reuse shared management components between operator and admin interfaces. Pass an explicit target organisation rather than modifying the authenticated user.

Master admin may perform all supported operational actions across organisations. Operators remain restricted to their organisation; advertiser logins remain restricted to their advertiser. Campaign, creative and screen relationships, booking capacity, immutable delivery evidence, and platform measurement/privacy rules still apply. Cross-organisation network selling needs its explicit inventory/revenue-sharing workflow, not arbitrary mixing of IDs.

Record administrator mutations with actor, target organisation/entity, action, timestamp and safe change details. Do not record passwords, tokens or camera images. Access to finance pages does not imply that the separately unfinished WP6 settlement system is complete.

## First implementation slice: remove today's blockers

1. Add admin Advertisers list/detail/create/edit/archive and shared Creatives management/upload. Define server-side edit allowlists and organisation checks. Archive is reversible, blocks new use, preserves history and either refuses while campaigns are live or requires an explicit separate campaign decision; no silent cascades or record deletion.
2. Add explicit organisation context to new advertiser, creative, campaign and team flows; show a clear owner selection and return to the selected advertiser after inline creation. Include optional advertiser-viewer access using the existing invitation mechanism.
3. Expose camera availability in Edit Screen and persist it. Include the already tested local camera initialization/recovery fixes in the reviewed release scope.
4. Add a screen readiness view: paired, camera enabled, camera/model state where reported, campaign present/active, creative approved/playable, dates/hours valid and booking eligible. Explain actual rejection reasons instead of only “Waiting for an eligible campaign.” Do not claim a browser permission diagnosis from heartbeat data that does not contain it.
5. Validate the real commercial path from an empty organisation using only the master-admin session: advertiser → uploaded video → approval → active campaign → eligible screen → actual playback → measured/unmeasured evidence. No database edits or second operator login should be required.

## Separate screen testing from commercial setup

Add a distinct **Run screen test** workflow so checking hardware does not require a customer, price or campaign.

A paired player runs a short explicit test clip and reports playback, camera permission/capture, detector load and sample results as **diagnostics**. Test data must be server-classified, stored separately from commercial delivery, and excluded from budgets, accrual, customer analytics and settlement. Do not implement this by creating a fake paid advertiser or by trusting an arbitrary client `test:true` flag on `/play`.

Diagnostic control should be scoped to an authorised screen, time-limited and auditable; test playback must be explicitly requested and must not silently interrupt a live advertisement. Local camera images remain on the device. No tracking or identity inference. Any displayed test counts are clearly diagnostic samples, not reported campaign presence. This is proposed new behaviour that must be reconciled explicitly with the locked “measure during play only” policy; run detection against the test clip and do not silently introduce continuous idle measurement.

## Order and acceptance

Implement the complete master-admin advertiser/creative/campaign path and screen camera editing first. Add honest readiness reasons next, then the independent diagnostic playback workflow. Keep broader settlement/reporting development separate.

Required verification:

- A master admin can create/manage resources in Gridcast and another selected organisation without switching accounts.
- Selecting organisation B never creates data in A; switching context cannot submit stale cross-org IDs.
- Operators cannot cross org boundaries and advertiser viewers cannot see another advertiser.
- Advertiser archiving preserves past delivery and prevents new campaign selection without silently changing active bookings.
- Changing camera availability reaches the player and yields a clear status; failures stay unmeasured/null.
- Approved eligible campaign playback works, and blocked playback shows its actual reason.
- Diagnostic playback needs no advertiser and cannot change any commercial ledger or count.

Current scaling limit: admin bootstrap reads globally with a 2,000-row domain cap. Organisation-scoped server queries and pagination should accompany fleet growth; a client-side filter must not be described as complete organisation-scoped retrieval.
