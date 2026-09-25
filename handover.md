# Gridcast — Codex chat handover

Prepared 25 September 2026 by GPT-6 (Codex desktop). This is a working handover, not a verbatim transcript. It preserves decisions, evidence, unresolved disagreements, operating instructions and the paths needed to recover detail. Secrets and expired sign-in codes are deliberately excluded.

The user requested the handover skill. No installed chat-handover skill was found in the Codex, Agents, Claude or project skill locations searched. This document was written directly; it must not be represented as generated using that skill.

## 1. Read this first

**Release B is already deployed and verified. Do not rebuild or redeploy B merely to resume this conversation.** The last user task is to create this handover for a new Codex chat. There is no deployment waiting to finish.

- Real repository: **`/Users/sanan/Downloads/gc`**.
- Codex desktop project wrapper: `/Users/sanan/Documents/Claude/Projects/Gridcast`. An `implementation/` directory also exists there; it is not the checkout used for the verified release. Do not switch to it or assume it is synchronized.
- Git remote: `https://github.com/sananxrom/Gridcast.git`.
- Working branch: **`codex/gridcast-trust-layer-wp5`**. The name is historical; substantial later work lives here.
- Repository HEAD before this handover: **`049b9d8a6e315dc5a40c9f0d2ad91d50ffd32d10`** (deployment documentation).
- **Deployed application:** `34bf8782cf45b7d6af4af27a6f96ed637aa39031`, player `gridcast-web/0.6.0`.
- Firebase rollout/build: **`build-2026-09-25-005`**, SUCCEEDED / READY / 100% traffic, verified **2026-09-25 22:23 IST**.
- Production: <https://gridcast-backend--gridcast-508011.asia-southeast1.hosted.app>.
- Player: `/player`; authorized recovery tools: `/player/maintenance`.
- Latest Claude review: **AI-LOG.md, 2026-09-25 22:28 IST**, “Post-deploy review of Release B (34bf878): no blocker, one minor finding.” It is included in the shared log and summarized below.

Start by reading `AGENTS.md`, the AI-LOG rules/Standing Context and latest entries, then this file and `gridcast-research/23-player-surface-cleanup.md`. Recheck `git status`, branch and new log entries before editing. The shared log can change while you work.

**Important stale-memory warning:** parts of AI-LOG's Standing Context still say WP0–WP5 are undeployed and Vercel remains live. Those are historical and superseded by later deployment entries. Read dates, actual source and cloud state. Do not mistake an old warning for the current production state.

## 2. User, product and working preferences

The user is Sanan. Real platform-admin/Firebase email: `sanan@consultsgx.com`. He wants agents to do the technical work, not repeatedly ask him to choose implementation details he cannot assess. Ask only when information, a material product decision or required authorization is genuinely missing. Do already-authorized work autonomously and report verified outcomes.

Gridcast is a multi-tenant digital-out-of-home advertising network, initially Chandigarh/Tricity: screens in venues, operators/resellers, network advertisers, campaigns/creatives and a browser-based player on computers or Android boxes. On-device camera inference estimates average people present while a creative plays. It is not an Android-only detector and must work in web browsers.

User expectations accumulated in this conversation:

- Platform admin must manage advertisers, organizations, screens, campaigns and creatives across authorized levels; operators must remain isolated horizontally.
- Admin needs practical onboarding and testing workflows, not dead-end pages requiring entities that cannot be created.
- Creatives must be editable. Branding uses the supplied Gridcast SVG, solid ochre/gold, readable wordmark proportions and compact Gridcast/Platform spacing.
- Slot duration belongs to the creative. Images have a manually adjustable duration, default 20 seconds. Screens can constrain acceptable duration.
- No deliberate blank gap between ads or after a rotation. Repeat eligible campaigns continuously while their authorization/budget permits. Prepare/cache uploaded media ahead of playback. Eventually use fillers when paid campaigns are exhausted; do not fabricate paid delivery.
- Uploaded media and YouTube are different: do not promise offline YouTube playback.
- The venue display should be clean: no always-visible camera, measurement panels, public export/clear buttons or casual access to maintenance.
- Sound should default on as a setting, with honest browser-policy fallback. This remains upcoming work, not shipped in B.
- YouTube controls/title/share/play chrome appears when the mouse moves and when videos change. User dislikes this. Cause and feasible remedy require actual reproduction; restrictions are detailed below.
- Firebase is the production destination. User explicitly selected **Firestore in India** and asked to review hosting location. Hosting remains Singapore; database/media are Mumbai. Do not drift back to testing old Vercel as production.
- User repeatedly asks “check log”; that means reread the latest shared entries, verify Claude's claims against source, and respond with the current conclusion.
- User requested multi-agent analysis/review earlier. B used bounded backend, dashboard and independent-review agents. Respect the new chat's actual delegation rules and available tools; old agent IDs are not resumable workers.

Style: concise, ordinary language to Sanan. The Caveman skill was requested earlier, but Sanan explicitly rejected extreme compression for build plans and discussion with Claude. Use **proper, detailed analytical prose** for architecture, disagreement, evidence and review handoffs. Do not bury risks or pending work behind terse “done” claims.

## 3. Hard product rules

Read the exact Standing Context in `AI-LOG.md`. At minimum preserve:

1. **Presence, never impressions.** The per-play number is the average sampled people count. Do not relabel it reach, unique audience, de-duplicated viewers or impressions.
2. **Unmeasured is null, never zero.** Failed camera/inference means unmeasured. Keep measured and unmeasured totals separate.
3. **Provenance on numbers.** Distinguish measured, self-reported and derived values; retain model/config/time/economic provenance for each play.
4. **Transparent vertically, isolated horizontally.** Authorized parties in a transaction can see decomposed economics; unrelated organizations cannot see each other's data.
5. **Locked measurement/privacy/transport keys are platform-only**, enforced server-side, not merely hidden in UI.
6. Camera frames are processed locally, never uploaded. No recognition, tracking, demographics or re-identification.
7. No bank-account numbers stored; only the agreed payout labels/UPI representation.
8. Browser records retain original device/org/screen identity. No re-labeling old receipts under a replacement device. No destructive cleanup disguised as recovery.
9. Never represent unrecorded paid playback as verified/delivered/billable. “Keep screen alive” is not permission to invent financial evidence.
10. Continuous rotation has no fixed expected-play contract. Do not invent a delivery percentage or pacing denominator from an old loop/slot model.

## 4. Collaboration with Claude

### Roles and communication channel

The **2026-09-25 19:56 IST** log entry records Sanan's role reset: **Codex builds; Claude reviews and argues.** Claude should not concurrently rewrite the specification/source unless Sanan asks. Earlier “Claude builds, Codex reviews” arrangements are superseded.

Claude has appeared both as Claude Code desktop on this Mac and Claude Cowork in a VM. They are different environments, may see different snapshots and cannot be assumed to share tool registrations. Local Claude's latest entries are labeled `claude-opus-5.5 (Claude Code desktop, Mac)`; Cowork entries use different labels. Treat model labels as their recorded self-identification.

Use **`AI-LOG.md` plus the relevant numbered research document** for shared handoff. Sanan commonly relays “check log” between chats. Do not assume a live direct messaging connection to Claude. No unsolicited Slack/email or extra Codex chat is needed. This handover request does not require starting or archiving another chat automatically.

### How to argue constructively

For each proposed change or finding, write:

- The concrete current behavior and consequence.
- The source file/symbol and commit you inspected; distinguish source inference from reproduced behavior.
- Whether you accept, partly accept or reject the proposal, and why.
- Alternatives and tradeoffs, especially data loss, tenant isolation, billing truth and device lifecycle races.
- The implementation boundary and invariants it must preserve.
- Acceptance tests, actual results and remaining validation limits.
- An explicit next owner/action. Stop circular debate once a decision is settled or the user directs a scope.

Do not accept Claude's log as proof: verify the current tree. Do not reject a finding merely because tests passed. Record corrections without editing prior entries. Recheck the log before finalizing a commit/deployment, because Claude may append during your work.

### Shared file discipline

- `AI-LOG.md` is append-only (Standing Context is the documented exception). Preserve all prior bytes; append one entry per changing user prompt, actual IST timestamp, honest model/surface, paths, SHAs, results and failures. No secrets.
- Keep Claude's concurrent additions intact. The 22:28 review was uncommitted when this handover started; it must not be lost.
- Do not overwrite another agent's working changes. Agree file ownership before parallel editing. Prefer bounded independent review to two agents modifying the same player component.
- List `gridcast-research/` before choosing a number. Doc 19 was once allocated twice.
- Spec correction and implementation must agree. Rewrite the current spec where appropriate; log the change and keep historical log entries.
- Explicitly distinguish local-built, committed, pushed, deployed and production-verified. Include the exact app SHA and rollout ID; a later log-only commit is not the running app.
- Review does not create a new approval gate by itself. Follow Sanan's already-given authorization; do not ask him again for routine steps he has approved.

## 5. Architecture and source map

Stack: Next.js 15.5.26 App Router, React 18.3.1, TypeScript, Tailwind, Radix/shadcn-style components, lucide-react. Node/npm dependencies already installed in the real repo. `package.json` says app package 0.2.0; player release version is separately `gridcast-web/0.6.0`.

| Area | Start here |
|---|---|
| API routing / dispatch | `lib/api.ts`, `app/api/` |
| Tenant filtering, authorization, response redaction | `lib/access.ts`, `lib/roles.ts`, `lib/auth.ts` |
| Persistent storage / bounded queries / transactions | `lib/firestore-store.ts`, `lib/store.ts`, `firestore.indexes.json` |
| Inventory, availability, bookings | `lib/inventory.ts` |
| Device identity / pairing / receipt authentication | `lib/devices.ts` |
| Budget authorization and settlement | `lib/budgets.ts`, `lib/settlement.ts` |
| Continuous scheduling | `lib/rotation.ts` |
| Hierarchical configuration | `lib/config.ts` |
| Reporting read model / metric definitions | `lib/reporting.ts`, `lib/metrics.ts`, `components/views/delivery-report.tsx` |
| Player orchestration | `app/player/page.tsx` |
| Camera / web inference | `lib/player-vision.ts` |
| Commercial durable queue | `lib/player-queue.ts` |
| Media caching and offline authorization | `lib/player-media-cache.ts`, `public/player-sw.js` |
| Screen diagnostics / retained local evidence | `lib/diagnostics.ts`, `lib/player-diagnostics.ts`, `lib/readiness.ts` |
| B server maintenance capability | `lib/maintenance.ts`, API/access/store integration |
| B browser maintenance and cross-tab pause | `lib/player-maintenance.ts`, `lib/player-evidence-lock.ts` |
| Maintenance UI | `app/player/maintenance/page.tsx`, `components/views/screen-maintenance.tsx`, `components/views/screen-detail.tsx` |
| Portals and navigation | `app/admin/page.tsx`, `app/operator/page.tsx`, `app/advertiser/page.tsx`, `lib/nav.ts`, `components/ui/app-shell.tsx` |
| Brand mark | `components/ui/brand-mark.tsx`, `public/brand/`, `app/favicon.ico` |
| Demo-network source | `lib/demo-network.ts`, `lib/demo-videos.json` |

Detector is pinned TF.js **4.22.0** + COCO-SSD **2.2.3**, `lite_mobilenet_v2`, self-hosted model assets. Old yolox-tiny declarations were a provenance defect addressed earlier; do not restore that mismatch. Desktop camera/inference had user-reported failures; real model loading/inference now has synthetic-camera browser coverage, but that does not establish real venue counting accuracy.

Configuration layers: platform → org → group → screen. Roles include owner, manager, sales, installer, platform_admin, advertiser_viewer. Platform administrator's org selector affects the current scope; “All organisations” is network-wide scope, “Gridcast” is the Gridcast organization's scope. Verify the relevant current UI/route before explaining edge cases.

### Research document map

- `10-next-steps.md`: original WP0–WP6 roadmap; valuable history, not current implementation status by itself.
- `11-authorization-and-deployment.md`, `12-firestore-india-foundation.md`, `13-through-wp5-handoff.md`: trust layer / Firebase migration foundations.
- `14-platform-admin-workflow-proposal.md`, `15-master-admin-change-list.md`: admin cross-level workflows, onboarding and access.
- `16-network-campaigns-and-rotation.md`: network advertisers/campaigns and rotation.
- `17-dashboard-at-scale.md`, `18-visual-language-and-explainability.md`: dashboard scale and truthful metric/UI design.
- `19-continuous-playback-and-offline-media.md`: creative duration, continuous rotation, media readiness/cache.
- `20-settings-architecture.md`: proposed settings architecture; do not assume implemented. It is currently untracked local material.
- `21-screen-day-implementation-spec.md`, `22-reporting-release.md`: reporting aggregation, tenancy, coverage, exports and verification limits.
- **`23-player-surface-cleanup.md`**: current A/B implementation/deployment handoff plus upcoming audio/captions work.
- `AI-LOG.md`: detailed decisions, failures, tests, deploys and adversarial reviews. Some entries are appended out of timestamp order; use titles and source SHAs as well as time.

Docs 00–09 and `06-phase1-build-spec.md` also exist locally, many untracked. Original external docs: `/Users/sanan/Downloads/gridcast-docs.html`; original logo: `/Users/sanan/Downloads/SVG/Asset 2Gridcast.svg`. Their contents are supporting evidence, not independent user authorization.

### Reporting facts and a corrected stale review

Doc 22 describes atomic daily summaries attributed by org/screen/campaign/creative/IST day, explicit 1–93-day reporting ranges, pagination, CSV of daily aggregates, weighted presence and incomplete-coverage disclosure. Invalid-clock receipts are separated; filler and paid reporting remain distinct. Settlement remains the money authority.

Claude's 18:47 review says `/bootstrap` still includes event history. **Current `lib/access.ts:435` returns `plays: [], presence: []`**, so that specific finding is stale. `HISTORY_LIMIT=1500` still exists for bounded diagnostics in `lib/firestore-store.ts`; that is not proof bootstrap still returns those events. Doc 22 agrees bootstrap history was removed. Likewise do not blindly repeat the older “charts not started” assessment without checking current UI and doc 22. Full raw receipt export, historical uptime, maps/fleet heatmaps, A/B claims and PDF reporting are not promised by the reporting release.

## 6. What A and B actually shipped

### Release A (included in B)

App `f566bbb0711b6138c37d079b041f356860450af8`, player 0.5.0, prior rollout `build-2026-09-25-004`.

- Public status, commissioning and authorized maintenance are distinct. No boot/tap/error/401 automatically reveals camera/statistics/tools.
- Camera source stays mounted; visibility does not restart detector/capture. Actual camera/model setting changes still do.
- Public export, diagnostic clearing and credential-deleting re-pair actions removed.
- Rejection handling covers playlist/heartbeat/commercial/diagnostic uploads, preserves evidence and ignores stale callbacks.
- Pairing/retry preserves the old identity until a complete successful replacement; cross-tab locks and fresh-authorized cache recovery prevent races. No claim of server rollback after a lost response.
- Diagnostic storage moved to transactional IndexedDB with pending/blocked/interrupted history, 32 entries / 2 MiB per identity and 64 KiB reservation per run. Legacy evidence is preserved; no automatic eviction.
- Storage failures preserve exact unsaved payload in memory and ask the user to keep the player open. Forced closure can still lose that memory; this is not a durability guarantee.

### Release B

App `34bf878`, player 0.6.0; live now.

Human workflow:

1. On the human's device, open the screen dashboard → **Saved records and player maintenance**.
2. Select the exact current or historical device identity and issue a one-time maintenance code.
3. In the browser that actually holds the saved records, open **`/player/maintenance` in a new tab**. Keep player tabs open, reload older versions if prompted, do not clear storage.
4. Redeem the code. Export only that identity's commercial/diagnostic evidence. Download requested does not prove the file was saved durably.
5. For planned replacement of the current identity: prepare replacement, pause cooperating tabs, attempt bounded original-token retries, review/export/acknowledge retained evidence, then enter a separate destination pairing code.

Server guarantees:

- 16 random code characters (80 bits) displayed in groups, stored only as hashes; session token hashes too.
- Exactly one org/screen/device, at most ten minutes from issuance, one-time transactional redemption across instances.
- Rechecks issuer active status, role, org, capability and auth_version on redemption and sensitive operations.
- Historical/revoked device recovery allowed under human authorization without pretending the old playback token is valid.
- Maintenance tokens do not authenticate dashboard, paid reporting or playback routes.
- `/screens/:screenId/maintenance` GET/POST, `/screens/:screenId/maintenance/:grantId/revoke` POST.
- `/maintenance/redeem`, `/maintenance/check`, `/maintenance/export`, `/maintenance/replace`, `/maintenance/close` POST; sensitive operations have explicit org/screen/device scope.
- Sensitive endpoints authorize local operations; saved records are read from kiosk IndexedDB, not leaked by the server response.
- Audits omit codes/tokens/payloads and do not claim an anonymous code holder is the identified issuing human.
- Current limiter: 120 attempts globally/minute; ten per hashed client bucket/minute; 4,096 fixed buckets plus global. Denied calls persist only expected limiter changes, not other staged domain writes.

Client/cross-tab guarantees:

- Capability stays in memory. Expiry uses server remaining time plus monotonic deadline. Reload, hiding the tab, offline/auth failure closes tools and invalidates late responses.
- Player shared evidence locks, maintenance exclusive lock; finalize playback and pending writes before pause. Planned replacement holds pause through review/export/acknowledgement.
- Service worker probes every open player tab for the new coordination protocol. Old tabs must reload; missing protocol is not evidence of safe quiescence.
- Requires Web Locks, BroadcastChannel and service workers; fails closed if unavailable.
- Export/replacement preserves original records, identities and payloads; changed evidence requires fresh review. No public all-identity export, record deletion, relabeling or billing/import reconciliation.
- Replaced old tab stays stopped after lease release; it cannot resume the old offline schedule.
- **Export does not free queue/archive capacity.** Commercial capacity defect is not solved by B.

### Verification already completed

For unchanged B source:

- **93 browser cases passed**: 46 existing player/diagnostic/cache; two new full-player pause/resume and stale-identity-stop; 27 maintenance/client/UI/dashboard/readiness; 18 existing admin/demo/device-queue/reporting against a production-build server.
- Unit/API: **234 passed, five emulator-dependent skipped, zero failed** (239 total).
- Emulator-enabled database regressions: **24 passed, zero skipped/failed**. Includes cross-process one-time redemption, durable failed-guess counters, rollback of unrelated staged writes, 2,001 expired grants not blocking current listing.
- TypeScript, production build and owned-file whitespace checks passed.
- Actual pinned model ran with a synthetic camera. No physical venue, Android/WebView, Safari/Brave-specific accuracy or OS-download-durability claim.
- Live B: health 200, correct Firestore database; player 200 with 0.6.0 bundle; maintenance 200 with code gate and no pre-auth export; no page errors/HTTP 5xx in isolated Chrome checks.
- Live checks did **not** issue production grants, export real evidence, replace a real paired device or change user tabs.

Key B tests: `tests/maintenance.test.cjs`, `tests/maintenance-emulator.test.cjs`, `tests/player-maintenance.browser.cjs`, `tests/player-maintenance-ui.browser.cjs`, `tests/screen-maintenance.browser.cjs`, plus existing player/readiness suites. Exact prior failure/fix history is in the 22:11 log entry.

## 7. Remaining work, with decisions and disagreements preserved

### Priority 1 — commercial blocked-evidence capacity

This is a source-confirmed defect, still live. `queueCapacity` **and** `enqueuePlay` count all rows for the device. `flushPlays` skips blocked rows, preserves expired/rejected evidence, and deletes only acknowledged successful rows. Retained blocked records therefore eventually consume the capacity needed for new playback. The player's capacity check currently runs before choosing a new item. Reconnecting or exporting does not free those records.

Claude proposed separating retryable backlog and blocked archive, sending scoped pending/blocked counts in heartbeat, and preserving old rows. Codex agrees. **The unresolved tradeoff:** Claude initially preferred continuing paid playback with visible record loss when storage is truly exhausted. Codex rejected silently adopting that: an alert cannot recover missing billing evidence; storage estimates are not transactional reservations. Claude's 21:51 handoff then adopted reservation-before-paid-playback and no falsely recorded delivery.

Recommended next implementation/review boundary:

- Reproduce blocked-row saturation without pretending Claude's exact long-offline narrative was proven. Offline authorization/budget allowances also bound play count.
- Separate retryable capacity and retained evidence consistently in both admission and enqueue paths.
- Reserve capacity transactionally **before** a paid play starts; handle crash/abandonment, completion, multiple tabs and migrations without erasing rows.
- Preserve old device IDs, immutable payloads and every retained row on failure; bound archive growth explicitly.
- Add per-device scoped pending/blocked/storage-status telemetry and dashboard visibility without exposing other tenants.
- Define the real-full-storage behavior explicitly. Filler or explicitly non-billable fallback may be appropriate, but do not introduce an unapproved billing/receipt policy or silently count unrecorded paid play.
- B export is available, but a download event does not justify automatically deleting evidence. Any archive clearance/import/reconciliation workflow is additional design work.
- Test retries, expiry, rejection, reservation races, capacity recovery, multi-tab maintenance pauses and failure durability together.

### Priority 2 — audio (doc 23 §4)

Not implemented in B. Add `audio_enabled`, default true, normal configuration inheritance and server scope enforcement. Keep requested audio, browser-blocked audio and active surface separate. Audio-on does not prove actual audible sound.

Mute immediately when a newly received setting says off, including mid-creative; do not wait for frozen slot config/boundary. Keep standby and camera muted. Mute old active media before enabling next surface. Handle native play rejection and YouTube `onAutoplayBlocked` separately; retry same creative muted without a new play UID or duplicate receipt. Avoid repeated sound retries each creative. Actual sound recovery must occur in the relevant gesture path. Preserve truthful failures if muted playback also fails.

Config delivery currently depends on polling (30–300 seconds, default five minutes, plus faster special paths). Do not promise instant remote changes before the device receives config. Heartbeat-returned config-version-triggered pulls are a later follow-up; compare against newest received config, not frozen per-play provenance.

Prefer managed kiosk autoplay allowlisting; developer autoplay switches are optional dedicated-device fallback, not a setting to recommend for a person's normal browser. Check current official browser docs when implementing. Physical Android/WebView is separate from desktop Chrome.

### Priority 3 — captions, YouTube chrome and interaction (doc 23 §5)

User clarified chrome appears on mouse movement **and creative changes**. Claude's hypotheses: pass-through `pointer-events-none` overlay lets hover through; no hidden cursor; one reused YouTube player passes through buffering/ended states. Native video has prepared dual surfaces; YouTube has no equivalent standby currently. These are source-based hypotheses, not a reproduced diagnosis.

- Reproduce on the actual media/browser before changing timing or masking surfaces.
- Hiding cursor or an interaction shield may reduce hover, but preserve intentional sound-recovery gestures.
- Two YouTube players/standby would need memory, timing, API/policy and real-device validation. Do not present it as the settled solution.
- Do not crop/enlarge the advertiser's video to hide branding. Check current official YouTube policy before obscuring player UI/branding; Claude explicitly left this question unverified.
- Native exposed text tracks can be disabled; burned-in text cannot.
- `cc_load_policy=0` is not a documented universal captions-off guarantee; `iv_load_policy=3` is annotation-related. Do not revive `unloadModule('captions')` / `unloadModule('cc')` as a documented API or promise.
- Strict chrome/caption-controlled output requires controlled uploaded assets. Do not promise arbitrary YouTube embeds can be made permanently clean.
- Preserve PLAYING-only delivery timing, measurement and receipt identity if changing surfaces/transitions.

### Smaller follow-up — Claude's 22:28 limiter finding

Claude found no B blocker after reading the server path. He correctly notes global 120-attempt/minute redemption throttling lets one attacker delay maintenance across all tenants with junk requests. It affects maintenance availability, not playback. He proposes dropping or substantially raising the global budget and retaining the per-client one.

This is **unresolved, not already fixed**. Evaluate the availability/resource-cost tradeoff, distributed abuse and proxy/client-bucket identity before changing it. Preserve bounded storage and durable denial counters; removing the global bound without considering request/transaction cost is not a complete analysis. Avoid weakening scope or creating unbounded limiter documents. Add appropriate regression tests for the chosen behavior.

### Broader follow-ups, not all immediate scope

- Real paired-device maintenance trial, real camera ground truth and physical Android/WebView validation; desktop synthetic tests are not enough.
- Venue LOIs/ground-truth clicker work is a human/business task; do not claim delivered.
- Reporting detail export, further scale/explanation UI and optional charts per current source and doc 22; no invented delivery percentage.
- Doc 20 advertiser settings and network-advertiser user/org ownership model need fresh source review before declaring status.
- Historical plans list WP6 money, but budget/settlement modules and tests have since changed. Audit current implementation before claiming WP6 wholly absent or complete.
- Vercel Git connection may still create preview builds; see hosting notes below. Do not resume it.

## 8. Firebase/Git release operations

### Existing resources

| Item | Value / status |
|---|---|
| Firebase project | `gridcast-508011` |
| Project number | `995906107784` |
| App Hosting backend | `gridcast-backend` |
| Hosting location | `asia-southeast1` (Singapore) |
| Firestore named DB | `gridcast`, **not** `(default)` |
| Database location | `asia-south1` (Mumbai) |
| Database edition | ENTERPRISE, FIRESTORE_NATIVE, Mongo compatibility disabled; delete protection enabled |
| Media storage | Private Mumbai bucket; resolve current name from project config, do not invent/recreate it |
| Runtime sign-in secret | Secret Manager reference `gcAuthSecret`; values must never be printed |
| B index | `maintenance_grants`: `screen_id ASC`, `expires_at ASC`, COLLECTION / DENSE |
| B index resource | `projects/gridcast-508011/databases/gridcast/collectionGroups/maintenance_grants/indexes/CICAgPi9lIEK` |
| B index status | READY before B rollout; same-filter read-only production query succeeded |

Existing Firebase CLI access worked at last deployment. It has expired before. If reauthentication is needed, initiate a fresh flow and let Sanan sign in; never reuse expired authorization codes from the old chat, copy tokens into logs, or request his password.

Sanan has repeatedly authorized building/pushing and explicitly authorized B index creation/deployment. That authorization was completed. It is not carte blanche for unrelated resource deletion, main merges, data migrations or arbitrary new production features. Follow the new user's request and actual scope. The old “send me a patch, never commit/push” workflow was superseded for authorized review-branch work. No main merge occurred for B.

### Established deployment command

Use only when a new reviewed release is actually authorized:

```sh
cd /Users/sanan/Downloads/gc
firebase apphosting:rollouts:create gridcast-backend \
  --project gridcast-508011 \
  --git-commit <EXACT_REVIEWED_PUSHED_APPLICATION_SHA> \
  --force --non-interactive
```

Firebase CLI installed at `/opt/homebrew/bin/firebase` (15.26.0 at last check). Installed CLI does **not** provide `apphosting:rollouts:list`, despite one skill reference saying so. Verify completion with the Firebase App Hosting API, not just command acceptance. Expected: exact commit, build READY, rollout SUCCEEDED and traffic 100%. Builds took several minutes; keep user informed without excessive polling.

Reusable temporary helper `/tmp/gridcast-release-a-status.cjs` works for latest rollout including B despite its name. If absent, it used the installed firebase-tools modules, existing private auth and `gcp/apphosting` methods `listRollouts`, `getTraffic`, `getBuild`. This is an internal CLI API, so verify signatures if the installed CLI changes. Do not dump the account/auth objects.

Read-only live helpers/artifacts (temporary, may disappear):

- `/tmp/gridcast-release-b-live-smoke.cjs`
- `/tmp/gridcast-release-b-index-query.cjs`
- `/tmp/gridcast-release-b-live-player.png`
- `/tmp/gridcast-release-b-live-maintenance.png`
- `/tmp/gridcast-release-b-maintenance-built.png`
- `/tmp/gridcast-release-b-deploy-graph.log`, `/tmp/gridcast-release-b-deploy-symdex.log`

Index tool quirks: `firestore_list_indexes` rejected pageSize 100, supported omission/0, and returned all collection groups despite scoped parent; filter by resource name before claiming absence. `firestore_query_collection` added Explain options rejected by Enterprise RunQuery. A plain authenticated REST RunQuery without Explain succeeded. These tool failures did not indicate an app failure. Do not create the B index again.

Rollback candidate is previous app `f566bbb` / `build-2026-09-25-004`, but rollback is a deliberate operation, not routine verification. Consider active maintenance sessions/new-client behavior before acting.

### Vercel history

Old `gridcast-silk.vercel.app` was an in-memory demo, not the Firebase production database. Claude could not pause it via connector (403). **Sanan paused the `gridcast` project manually, verified by Claude at 18:50 IST**: domain/health returned 503 DEPLOYMENT_PAUSED and project live=false. It was not deleted. Git remains connected and may generate protected previews. `gridcast-invite` was left untouched; purpose unverified. Do not present an ambient old Vercel browser tab as the current production target. No Vercel state was rechecked during this handover.

## 9. Local tests and safe tooling

Work from `/Users/sanan/Downloads/gc`. In the prior desktop sandbox this path was outside writable roots, so writes/Git/network required scoped elevated execution. Do not evade the new session's actual filesystem policy or assume the wrapper directory is the real repo.

Basic validation for application edits:

```sh
npx tsc --noEmit
npm test
npm run build
# Then exercise the actual changed browser/API flow with relevant tests.
```

`npm test` runs `node --test tests/*.test.cjs`; browser files are separate `*.browser.cjs` suites. Do not claim browser coverage from npm test alone. Some browser suites start their own fixture server; others expect a local production server via `GC_UI_TEST_URL` (often port 4012). Read the relevant harness first. Never point mutation/seed browser fixtures at production. `package.json` still has `next lint`; do not assume it works with this Next version or claim lint passed without running it.

Firestore emulator tests require **`FIRESTORE_EMULATOR_HOST=127.0.0.1:8185`**, fake project **`demo-gridcast-storage`**, and isolated test database IDs. They intentionally fail closed for unexpected emulator configuration; do not bypass that guard or use production to get a test green. Read `tests/firestore-emulator.test.cjs` and `tests/maintenance-emulator.test.cjs` for startup requirements.

Bundled Playwright Chromium/headless shell was unavailable in an ad-hoc launch. Installed Chrome worked:
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. Test harnesses also accept `GC_TEST_BROWSER_PATH`; some use `GC_TEST_FFMPEG_PATH`. Do not install browsers unnecessarily. Use fresh isolated browser contexts for smoke checks, preserving the user's real paired Brave/Chrome tabs, IndexedDB and service workers.

Meaningful tests should target failures/invariants, not merely mirror implementation. Freeze source while running final checks. Stop temporary test servers/emulators you started. Do not terminate unknown processes. Do not claim camera ground truth, actual speakers or durable OS download completion from synthetic automation.

## 10. Shared code indexes

Sanan requested both **codebase-memory-mcp** and **SymDex**, and sharing the graph with Claude.

- Repository/index ID for both: **`gridcast`**.
- Mac executables: `/Users/sanan/.local/bin/codebase-memory-mcp`, `/Users/sanan/.local/bin/symdex`.
- SymDex skill: `/Users/sanan/.agents/skills/symdex-code-search/SKILL.md`.
- Prefer SymDex scoped symbol/text search and small context packs before broad source reads. Check freshness and verify source for decisions.
- Shared graph snapshot: `.codebase-memory/graph.db.zst`, intentionally Git-ignored; shared through the connected folder, not a clone alone.
- Each host owns its writable SQLite cache. Never share a writable SQLite cache.

**Refresh only through the helper for codebase-memory:**

```sh
cd /Users/sanan/Downloads/gc
CBM_BIN=/Users/sanan/.local/bin/codebase-memory-mcp bash tools/publish-code-index.sh
/Users/sanan/.local/bin/symdex index /Users/sanan/Downloads/gc --repo gridcast --no-embed
```

The helper serializes shared artifact publication with a lock. Inspect a stale lock's owner/process and coordinate before removing it. Do not call raw `index_repository` or run background watchers on the shared repo: codebase-memory 0.11.0 can rewrite an existing snapshot even with `persistence=false`. Read-only graph queries are safe. Do not follow generic tool hints to commit the graph.

Known partial parser coverage: `components/ui/app-shell.tsx:99`. A missing graph result is not absence of code. SymDex is structural/text only here; semantic embeddings were not configured. New log edits can make freshness false even when app source is unchanged; do not blindly trust stale offsets. Refresh both after final source/log edits.

Example lookups:

```sh
/Users/sanan/.local/bin/symdex find queueCapacity --repo gridcast
/Users/sanan/.local/bin/symdex pack 'player maintenance' --repo gridcast --budget 3000
/Users/sanan/.local/bin/codebase-memory-mcp cli --quiet search_graph '{"project":"gridcast","query":"accrueSettlement"}'
```

Claude Cowork VM cannot use a Mac executable/registration. `CLAUDE.md` describes installing a checksum-verified Linux executable outside the shared folder and importing/reconciling through the same helper. Respect that environment's permissions; prior Cowork SymDex indexing was blocked, and graph sharing is not permission to bypass it.

## 11. Working tree and preservation requirements

At handover start, source was unchanged from B, HEAD was `049b9d8`, and Claude's 22:28 AI-LOG append was uncommitted. Existing unrelated local material:

- Modified `CLAUDE.md` (shared-index/Cowork instructions); leave it alone unless asked.
- Untracked `.agents/`, `.claude/`, `06-phase1-build-spec.md`, `Claude outputs/`, `skills-lock.json`.
- Untracked research docs `00` through `09`, plus `20-settings-architecture.md`.

Do not `git add .`, discard these files or clean the tree indiscriminately. Stage owned paths only. Shared AI-LOG commits may include preserved concurrent review entries; say so. No co-author/generated-by commit trailers.

The handover/log should be committed locally per repo rules. This documentation-only request does not itself call for another app rollout. Recheck local and remote heads before any subsequent push; do not assume this handover commit was deployed or pushed.

## 12. Historical user-supplied assets and credentials

Sanan supplied brand demo YouTube links (also check current `lib/demo-videos.json` for actual integration): Coke `gQ1b0uaFRjM`, `69ddBOrCwok`; Oreo `-ImKuGmNG2I`; Mercedes `JbPBHtLstGw`; McDonald's `79phlhutGLg`; Lay's `ouLVXfte2f4`, `fix3tKIIBjk`; Cadbury `mRdEnhWrptQ`; Aashirvaad `G2sjEAL3EwA`. These are source choices, not evidence all campaigns are currently active or authorized on every screen.

Old demo operator/advertiser logins and a shared password were supplied at the beginning of the project. They are not the current production credential source and are deliberately not copied here. No current operator password is known from this handover. Do not invent one, reuse the old shared seed password, or print stored secrets. Use authorized account/reset workflows if requested. OAuth authorization codes in the historical chat are expired sensitive material and must not be carried forward.

## 13. Suggested first response and next action in the new chat

A useful opening is: “I’ve read the handover and latest log. Release B is already live. The next source-confirmed issue is blocked delivery records consuming playback capacity; Claude also flagged the maintenance global limiter. I’ll inspect any newer review before proposing the next bounded change.”

Then:

1. Read new log entries and inspect working tree; do not rely on this snapshot alone.
2. If asked to continue remaining implementation, start with the commercial capacity design above, preserving receipt/tenant/durability guarantees. Give Claude a detailed bounded proposal for review in the log.
3. Keep audio and YouTube/caption work separate. Do not bundle unrelated player changes into a queue fix.
4. Build, test, document exact evidence and limits, then push/deploy only within the user's current authorization.
5. Keep this handover as orientation; `AI-LOG.md`, current source and verified cloud state are the evidence.
