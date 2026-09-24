# Gridcast — Authorization implementation and rollout prerequisites

24 September 2026 · source base `13083f5` · WP1 and local WP0 safeguards.
This document records the implementation. `10-next-steps.md` remains the plan.

## What changes

`lib/access.ts` defines an exact method/path capability policy. Unlisted business
routes are denied. Entity and relationship checks run before mutation; a foreign
entity returns 404. Platform admins have deliberate cross-organisation access.
Caller identity comes from the current database user and signed session, never
query parameters or body role claims. Mutation bodies have field allowlists.

| Action | Required access |
|---|---|
| Bootstrap/profile/password/logout | Valid active account; temporary credentials must first change password |
| Campaign read | Staff with sales/money in receiving org, matching advertiser, or platform admin |
| Campaign/creative/advertiser creation and campaign changes | Sales; linked entities must belong to the appropriate org/advertiser |
| Invoice changes | Money, in addition to campaign access |
| Screen detail | Screens or sales, same org; sales sees no device/config secrets |
| Screen edits, preview read, configs | Screens, same org; pricing reconciliation also requires sales |
| Owner shares | Money, in addition to screen edit access |
| Team management | Team; managers cannot manage owners/platform admins or grant owner role |
| Creative approval; platform settings; org creation | Platform admin |
| Platform-layer and locked config keys | Platform admin; locked keys never accepted below platform |
| Reset | Platform admin + explicit local opt-in; never production |

Advertiser bootstrap contains only their campaigns and related plays/presence,
creatives and screens. No response includes password hashes/salts or session
revision numbers. Tax and payout fields are hidden without money access.
Network campaigns still expose their transaction terms and referenced creative;
a counterparty advertiser's private contact fields are not exposed. Installers
retain operational playback diagnostics but no commercial values or campaign
management. Their screen detail may include creative titles for troubleshooting.

Password changes, resets, role/access changes and logout increment the user's
session revision. Old tokens fail, including after re-enabling a disabled user.
Logout revokes all that user's sessions. The password-change screen saves its
replacement token. A local restart also invalidates sessions when no explicit
local signing secret is configured. Legacy tokens without a revision require
signing in again.

UI controls and payloads follow the server policy: narrow screen patches, no
operator approval actions, no manager invoice/share writes, read-only platform
configs for operators, no owner management by managers. Configuration inputs
reject unknown/prototype keys, and the resolver tolerates legacy unknown keys.

## WP0 safeguards in source

- The public fixed signing fallback is removed. Production API requests fail
  closed with 503 when authentication configuration is missing or too short.
  Build-time static page generation does not need runtime secrets.
- Production file/memory storage is refused. Missing production data is not seeded.
- New local demo data requires an explicit password; the shipped seed contains
  no shared default password. **Existing persisted demo credentials are unchanged.**
- The old unauthenticated player transport is disabled by default, can be enabled
  only for local development, and is always forbidden in production. This is a
  temporary guard, not implementation of device identity or honest proof-of-play.
- `apphosting.yaml` nesting is repaired; no cloud secret values are written there.

## Current Firebase evidence

The refreshed Firebase login can access project `gridcast-508011`. Existing backend
`gridcast-backend` is in `asia-southeast1`. The public health endpoint returned
HTTP 200 with `store: file` on 24 September. That confirms the deployed runtime
is not using the shared Redis adapter. It does not verify integrity of its plays.

The initial database listing returned 403 because the Firestore API was disabled.
After enabling it through the authenticated Firebase account, the listing returned
no databases. At Sanan's request for India, an empty named database `gridcast` was
created in Mumbai (`asia-south1`), Enterprise edition with Firestore native data
access, deletion protection enabled, MongoDB access disabled and realtime updates
disabled. Readback verified these settings. The initial deny-all client rules
compiled and passed 19 synthetic denial cases; see document 12 for release status.

The application is NOT connected to this database. Its current adapter still uses
file/Redis storage. App Hosting has no India region in the currently published
locations. The existing backend remains in Singapore. India-only runtime hosting
would require a separate Cloud Run migration, not a location edit on this backend.

## Before a production rollout

1. Integrate the chosen Mumbai Firestore database. The current adapter cannot use it. Migrate to collections and transactional writes;
   do not store the entire JSON blob in one document.
2. Keep the named database and edition explicit in the server client and migration
   scripts. Confirm runtime IAM access before cutover; browser access stays denied.
3. Provision the actual platform-admin account, migrate/disable legacy demo
   accounts and rotate live signing credentials through the hosting secret store.
4. Complete authenticated pairing and device routes before deploying player use.
5. Validate on an isolated deployment, then choose the canonical live origin and
   retire the other deployment only as an explicit cutover action.

The updated API will return 503 on today's file-backed Firebase configuration.
Do not treat a successful build as permission to roll this into that environment.

## Remaining limits

Requests are serialized inside one process and re-read storage before authorization.
The JSON blob still has no cross-instance transactions: concurrent writers can
lose updates, including session revocations. WP4 must resolve this before a pilot.
Login throttling is also per-process. Browser sessions still use localStorage.

Measurement provenance, detector choice, frame retention, authenticated device
identity, offline delivery, immutable financial records, and real onboarding
remain separate work. Frame access is now protected; frame deletion/privacy
semantics have not been fixed. Budget stops remain manual.

## Verification

`npm test` executes real TypeScript API/auth/config modules against a disposable,
cloned in-memory store. It checks all account roles, cross-org attempts, advertiser
scope, platform privilege, account/session revocation, bulk pre-validation,
normal edits, network references, malformed config keys and production guards.

Typecheck and production build are required, followed by local HTTP smoke checks
against the Next.js route with disposable data. The AI log records exact outcomes
and failures. No mutation tests run against either live deployment.
