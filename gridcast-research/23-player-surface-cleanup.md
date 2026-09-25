# Player surface, recovery and audio — agreed implementation plan

**Updated:** 25 Sep 2026 · **Review base:** `80fef42`

**Last verified deployment:** `f566bbb` / `build-2026-09-25-004`; Firebase rollout succeeded, build READY, 100% traffic. Verified 2026-09-25 21:45 IST.

**Status:** Release A deployed and smoke-tested on Firebase. Release B is implemented and tested locally, not deployed. Audio and caption/control changes remain planned.

**Decision record:** [AI-LOG.md](../AI-LOG.md), Codex/Claude reviews from 19:06 through 20:49 IST on 25 Sep.

Sanan requested a clean player screen, hidden camera/statistics during ads, control over captions and
play/pause UI, and sound enabled by default through device configuration. This plan separates confirmed
source defects from unverified browser reports and defines what each release can promise.

The previous version's single overlay predicate, automatic boot/tap reveal, public recovery exports,
and claimed documented YouTube caption-off calls are superseded by this document.

## 1. Findings and boundaries

| Finding in the reviewed source | Consequence |
|---|---|
| `diagnostics_overlay` and `timing_debug` default to false in `lib/config.ts`, but the player does not read them. | Commissioning settings do not currently control the visible overlays. |
| `app/player/page.tsx` always renders the camera, counts and status panels. | Venue footage and measurement details are visible on the public display. Local display does not contradict “never uploaded”; the defect is unwanted local exposure. |
| Public buttons clear `gc_device`, export records and clear the saved diagnostic report. | A passer-by can disrupt playback, access retained records or discard diagnostic evidence. |
| `exportQueue()` calls `queuedPlays()` without an ID. | Export includes commercial records still retained from all device identities in this browser origin, potentially across organizations. Acknowledged records have already left the queue. |
| Native creative videos and YouTube are initialized muted; there is no `audio_enabled` key. | Requested sound configuration requires implementation. The reported audible laptop remains unexplained. |
| Native creative videos have no `controls` attribute; YouTube uses `controls: 0`. | The reported play/pause button needs reproduction before assigning its cause. |

A generic 401 means that a credential is not currently accepted. It does not distinguish revocation,
expiry, an invalid token or a disabled screen/organization. It never authorizes the person at the screen.
The player's `fatal` flag also covers queue failures and cannot stand in for authentication state.

Earlier empty `screen_day` results describe server aggregates at those scan times. They do not establish
that no browser holds queued records, or that no player is paired. Production exposure remains unknown;
prioritize the correction before further venue/ground-truth trials.

Source anchors: [player](../app/player/page.tsx), [configuration](../lib/config.ts),
[device authentication and pairing](../lib/devices.ts), [local queue](../lib/player-queue.ts).

## 2. Release A — clean display and pairing recovery

Release A adds no maintenance endpoint or stored maintenance secret. It removes the public data/destructive
actions and preserves records during pairing recovery. Authorized exports follow in Release B.

### Three distinct surfaces

| Surface | When allowed | Permitted contents |
|---|---|---|
| Public status | Minimal status when needed for waiting/error/recovery; an intentional brief status reveal may be used. | Plain operational status and recovery prompts. No footage, measurement statistics, record contents or maintenance actions. Keep ordinary paid/filler playback free of persistent clutter. |
| Commissioning | Explicit `diagnostics_overlay` configuration or a valid active diagnostic run, while the current device remains authorized. | Local camera preview, detection/statistics and camera retry needed for setup. No export, record deletion or credential removal. |
| Maintenance | Unavailable in A; requires the scoped grant introduced in B. | Only the specific authorized maintenance actions and records. |

Boot, restart, an ordinary tap, idle, a generic error or a 401 must not independently reveal commissioning
or maintenance. There is no 60-second boot exception. Close commissioning when its enabling condition ends
or device authorization is rejected. An available diagnostic offer is not the same as a valid active run.
`timing_debug`, if rendered, controls timing information within commissioning only; it grants no maintenance
access. Apply received presentation settings without changing frozen per-play measurement configuration.

Remove the public “Enter a new pairing code” action that deletes `gc_device`, “Export saved delivery
records,” and “Clear saved diagnostic report” from every public and commissioning state, including 401.
Remove any remaining public export invocation path, not just its visible button.

### Preserve camera operation while changing visibility

Keep the camera source video mounted with stable refs and the stream attached. Visibility must not become
a dependency that restarts the player effect, camera or detector. An opacity-based presentation change is
the initial implementation choice; the earlier claim that `display:none` necessarily stops decoding was
not established. Do not present that hypothesis as a browser guarantee.

Hide the preview, drawing canvas, labels and statistics together. Hidden interactive controls must be
unmounted separately or made inert with appropriate accessibility handling; opacity and pointer-events
alone do not remove keyboard focus. The hidden camera source remains mounted. Camera audio remains muted.

Verify real frame decoding and detection before and after hiding. CSS assertions alone are insufficient.
Camera failure still produces unmeasured/null presence, never a fabricated measured zero. Test paid,
filler and diagnostic playback plus return to ordinary playback.

### Explicit rejection and retry

Introduce an authentication-rejected state bound to the current credential generation. Set it from every
authenticated player request that returns 401, including playlist/heartbeat requests, commercial uploads
and diagnostic-result uploads. The last currently calls request() directly through flushTest(). Ignore callbacks from a disposed or replaced generation.
Queue failures, storage failures, network errors and other fatal states must not masquerade as 401s.

Use a message such as “This device is not currently authorized. Retry or enter a new pairing code.” Offer
retry with the existing credential: a temporarily disabled screen or organization can be re-enabled.
A successful retry must re-establish the authorized player lifecycle without duplicate timers, detector
instances or receipts. Do not reopen camera/tools just because retry was clicked.

### Non-destructive pairing recovery

For an unpaired browser or explicit credential-rejection recovery, offer the existing one-time pairing-code
form. Opening/cancelling the form must not delete the old credential, queue, sequence metadata or diagnostic
record. Do not use `setCredential(null)` as the entry mechanism for an already paired browser.

Before deliberate replacement, read the current identity's pending and blocked counts from storage and
show a warning. Read failure means “could not check saved records,” not zero. Show counts, never record
contents. Explain that retained old-device records may no longer upload normally after replacement and
that preserving them does not guarantee billing or recovery.

Only a complete successful response to valid server-side pairing may replace the saved credential. Failed
codes, cancellation and incomplete responses retain the old local identity. Coordinate active-play
finalization and outstanding queue writes before switching identities; failures must remain visible and
must not be silently discarded. Keep old records under their original device IDs. Never relabel, delete or
resubmit them as delivery from the replacement.

Local preservation is not a server rollback guarantee: if pairing succeeds on the server but the response
is lost, the old device may already be revoked and the code consumed. Report an uncertain outcome honestly;
do not claim the old pairing is still valid or blindly assume retrying the same code is idempotent.

A pairing code authorizes its destination screen's pairing; it does not authorize access to records from the
previous identity. Dashboard security revocation remains available without a local-export prerequisite.
Replacement on another browser can still strand this browser's queue. Release A does not claim to prevent
all such cases or to create a server-side recovery/import path.

### Export boundary and explicit regression

Release A temporarily removes local in-app export. Records remain retained in browser storage, but A
provides no public recovery export, including after a 401. Browser clearing/eviction can still remove data.
If uninterrupted authorized local export is required, ship the minimum grant/export portion of B together
with A; do not bridge the gap with an unauthenticated export button.

If an export implementation remains callable, require an explicit, nonempty authorized device ID and
filter by it. Missing/empty IDs must not fall through to the all-device behavior of `queuedPlays()`.
Do not change legitimate internal all-identity bookkeeping indiscriminately, or keep dead export code
solely to add a filter. `strandedPlays()` returns other identities; it does not establish screen or tenant
scope. A new authorized exporter in B must enforce that scope regardless of what A removes.

### Flows that currently depend on the removed controls

*Added by Claude Code, 25 Sep 2026 20:54 IST, after reviewing this revision against source.*

Removing export and diagnostic-clear changes two existing flows that the sections above do not cover.

**A stuck diagnostic report would block screen tests permanently.** `app/player/page.tsx:208` refuses any new
diagnostic run while `pendingDiagnostic(device_id)` returns a saved report. A report that expires or is
rejected is marked `blocked` and kept (`lib/player-diagnostics.ts:13-22`); only a successful delivery removes
it (`:20`). Today the public "Clear saved diagnostic report" button is the only other way out. Without it, one
blocked report stops that device from ever running a screen test again, which would stall commissioning in A.
Required in A: a blocked report must not prevent the next test merely because it occupies the single
pending slot. Preserve it, including its original device/run identity, payload, creation time and rejection
reason, in a separate retained diagnostic store. Move it idempotently and durably before freeing that slot;
coordinate migration, flush completion and other tabs so an old callback cannot erase a newer report.
Existing pending/blocked records must survive migration, interruption and reload. A still-pending,
non-blocked report continues to gate new runs; that state does not guarantee the server will accept it.

Bound retention with explicit record-count and byte limits chosen and documented in the implementation.
Do not silently evict either old or new evidence. If the archive is full, corrupt or cannot be written,
retain the original report and refuse a new diagnostic run with an honest storage message. Check/reserve
capacity before consuming a diagnostic assignment so an unpersistable run is not started. Archive exhaustion
may therefore block further tests until authorized maintenance is available; it must not independently stop
otherwise eligible paid/filler playback. This is the necessary limit to the promise that one blocked report
no longer prevents commissioning. No public delete/export bypass is introduced, and diagnostics remain
separate from commercial delivery and billing. Release B's scoped export must include this retained history.

**Messages must describe recovery that actually exists.** `:208` offers export/clear and `:265` offers
export on queue-full; remove those instructions in A. Successful acknowledgements can free commercial queue
space after reconnecting, but blocked/expired records remain and count against the limit
(`lib/player-queue.ts:54-55,68-77`). Reconnection alone is not a guaranteed remedy; export itself never
removed those queued rows either. For retryable records, say “Delivery storage is full. Reconnect to retry
saved deliveries; new playback remains paused until space is available.” When blocked records prevent
progress, say “Saved delivery records need authorized review. They remain on this device; new playback
cannot start.” Do not suggest clearing browser storage, relabeling old records or re-pairing to bypass limits.
In A there may be no self-service remedy; record that limitation instead of promising automatic recovery.

The existing capacity check runs before paid, filler and diagnostic selection in startNext(), not only
before paid creatives. Preserve that behavior in A and use “new playback” rather than “paid playback” in
its status text. Changing filler/diagnostic behavior under a full commercial queue is a separate scheduler
change, not an incidental wording fix. A diagnostic-result 401 must also enter the current identity's
credential-rejected state; archiving its report does not authorize another run on a rejected credential.

**Release-note text:** “The public player no longer exposes camera/statistics outside commissioning, or
provides export and record-clearing controls. Saved delivery records remain on the device. Local in-app
export is temporarily unavailable pending authorized maintenance access. Pairing recovery preserves
existing records, but does not guarantee that old-device records can be accepted after replacement.”

### Release A acceptance checks

- Boot, tap, normal paid/filler playback, idle, camera failure, storage failure and 401 reveal neither
  record contents nor destructive maintenance controls; no hidden controls remain keyboard-accessible.
- Explicit commissioning/active diagnostics show the intended preview/statistics and then hide them again.
  Detection continues with the preview hidden; camera failure remains unmeasured/null.
- All authenticated player 401 paths, including diagnostic uploads, offer recovery; other failures do not. Retry after re-enabling a screen works with the old
  identity. Stale callbacks cannot reject a replacement identity.
- Cancelling, invalid codes and failed/incomplete pairing responses preserve the local identity and records.
  Successful replacement retains old-device records; in-flight writes are not silently lost.
- Count-read failure is distinct from zero, and no export or diagnostic-clear action remains publicly callable.
- The lost-response case does not claim pairing success, rollback or safe replay without evidence.
- A blocked diagnostic report is durably archived under its original device/run identity and permits a new
  run when archive capacity is available; a still-pending report continues to gate. Migration, retries,
  reload and competing tabs neither lose evidence nor erase a newer report.
- Full/corrupt/unwritable diagnostic storage refuses new tests without evicting records or independently
  stopping eligible paid/filler playback. Capacity is checked before a new diagnostic assignment is consumed.
- Queue-full messages distinguish retryable from blocked records, do not promise reconnect will fix all
  cases, and offer no removed export/clear action. Existing commercial-capacity behavior remains unchanged.

## 3. Release B — authorized local maintenance

Authenticate the human on their own phone/laptop using existing screen capability and tenant checks.
Do not require a full operator session on a public kiosk. Human sessions support account-wide invalidation
through `auth_version`; the reason to avoid them here is unnecessarily broad access, not an absence of
revocation support. See [API authorization](../lib/api.ts) and [access rules](../lib/access.ts).

The dashboard issues a grant for exactly one organization, screen and device identity. Use a maximum
ten-minute authorization window, one-time code redemption and a maintenance session that cannot extend
past that window. Store only hashed secrets server-side; redeem atomically, limit guessing across instances,
and audit issuance/redemption/closure without credentials. Keep the player capability in memory; reload,
expiry and authorization loss close the tools. Re-check the issuer's scope at redemption and sensitive
online operations. If authorization cannot be checked, fail closed and preserve records.

The grant allows only scoped maintenance, not dashboard access, playback authorization or reporting under
a revoked token. It may authorize recovery for an explicitly selected historical/revoked identity; requiring
a valid playback token for that recovery would lock out the records it is meant to recover. Historical
access needs its own human scope check. A locally stored ID or hidden gesture is never authorization.

For planned replacement, attempt to flush deliverable records while the old identity is valid, then show
what remains and offer scoped export before confirmation. Include pending/blocked commercial records and
pending and retained diagnostic evidence only for the authorized identity. Re-read the queue at replacement, coordinate
in-flight operations and other player tabs, and preserve original records. Destination pairing still uses
its own valid pairing code. Security revocation must not wait for successful export.

A browser download attempt is not proof of a saved backup. Use honest operator acknowledgement if that is
the implemented flow. Mandatory file re-selection/content verification is deferred; it must not delay A.
Even content matching would prove possession at that moment, not durable storage or accepted delivery.
Export/import reconciliation and changes to billing or revoked-device report acceptance are out of scope.
The UI protects ordinary app access, not a compromised browser or unrestricted OS access.

B requires access-boundary tests for organization/device scope, empty IDs, code reuse, concurrent redemption,
expiry, issuer access changes, revoked-identity recovery, offline authorization failure and absence of
credential logging. Export cancellation, queue changes and replacement must not delete or mix evidence.

## 4. Audio — separate change after Release A

Add `audio_enabled` to the playback configuration group, default `true`, with normal platform → organization
→ group → screen inheritance and existing server-side scope enforcement. It is a playback preference, not
a change to locked measurement/privacy keys. Test validation and inheritance rather than assuming the new
key reaches every layer. The reported one-laptop exception remains unverified; user interaction, another
media surface or browser state are possibilities, not findings.

Track requested sound, browser-blocked sound and the active playback surface separately. An unmuted element
does not prove audible speakers, a non-silent source or that anyone heard it. Add no billing interpretation
or new receipt schema for this cleanup.

- Apply sound-off to both native surfaces and YouTube immediately when new configuration arrives, even
  mid-creative. The current `pull()` stores pending configuration for the next boundary; do not rely only
  on that boundary or on `currentSlot.config`. Preserve the slot's measurement/economic provenance.
- Standby media stays muted. Mute/retire the previous active surface before allowing the next surface sound.
  Camera video always stays muted. Guard asynchronous callbacks against replaced slots/surfaces.
- On browser autoplay refusal, handle native `play()` rejection and YouTube `onAutoplayBlocked` separately.
  Retry the same media muted without another play UID, reset duration or duplicate receipt. Do not classify
  every media error as an autoplay denial. If muted playback also fails, retain honest failure reporting.
- Do not repeatedly retry blocked sound on every creative. Retry after a relevant user gesture, setting
  change or controlled reinitialization. Invoke permission-sensitive playback in the actual gesture path
  where required; a delayed “next ad” retry may not retain user activation.
- Provide a minimal intentional sound-recovery affordance when needed, without revealing camera or tools.
  Do not promise that one tap defeats every browser policy.

**Setting help:** “Online players normally receive this setting at their next successful sync; sound changes
as soon as it arrives. Browsers may block sound until it is enabled on the player or allowed by kiosk policy.”

Normal playlist polling is currently clamped to 30–300 seconds, default five minutes, with faster refresh
paths in some states. Offline, suspended or failing players have no bounded delivery time. A later
heartbeat-triggered pull can use the server's returned `config_version`; compare against the newest received
version, not only the frozen slot version. That follow-up needs no new push channel and is outside A/B.

**Kiosk guidance:** Prefer a managed Chrome `AutoplayAllowlist` scoped to the player origins, testing YouTube
iframe permission delegation. The `--autoplay-policy=no-user-gesture-required` developer switch is an
optional fallback for a dedicated controlled browser instance, not a recommendation for the operator's
normal browser. An owned Android WebView uses its host media-playback configuration; it is distinct from
Android Chrome. Autoplay with sound depends on browser state and policy, so muted fallback is always needed.
See [Chrome autoplay guidance](https://developer.chrome.com/blog/autoplay) and
[Android WebSettings](https://developer.android.com/reference/android/webkit/WebSettings#setMediaPlaybackRequiresUserGesture(boolean)).

Audio acceptance: default/inherited overrides; live config-off; native and YouTube rejection/fallback;
no standby sound or overlap at handoff; no duplicate receipts; gesture recovery; stale callback suppression;
camera always muted. Test supported desktop browsers. Physical Android/WebView results remain unverified
until an actual device is exercised; an emulated user agent is not equivalent.

## 5. Captions and playback controls — separately bounded changes

### Captions

For native media, disable exposed text tracks on metadata load and when new tracks appear, with lifecycle
cleanup when media changes. Burned-in text is part of the asset and cannot be disabled as a caption track.

For YouTube, `cc_load_policy=1` forces captions on; the documented default follows viewer preference.
`cc_load_policy=0` is not a documented universal force-off mechanism. `iv_load_policy=3` concerns annotations,
not caption suppression. The current IFrame reference does not document `unloadModule('captions')` or
`unloadModule('cc')`; documented captions options are `fontSize` and `reload`, not an off switch.
Do not implement the former speculative calls as a required fix or claim that feature detection proves
caption suppression. Any future workaround needs actual verification and failure isolation.

Sources: [YouTube player parameters](https://developers.google.com/youtube/player_parameters) and
[IFrame API reference](https://developers.google.com/youtube/iframe_api_reference).

Test a real embed with viewer captions enabled and native media with exposed text tracks. YouTube suppression
remains best-effort; do not promise “never subtitles” for arbitrary embeds. Strict caption-free output
requires controlled assets without caption tracks or burned-in subtitles. Enabling sound does not remove
this limitation or make captions technically unnecessary.

### Play/pause and interaction

Reproduce the reported button on the actual device/media type before attributing it to an embed, browser,
OS or host shell. Existing `controls: 0` and missing native controls do not establish the cause.
Retain the app's minimal kiosk controls; targeted context-menu/Picture-in-Picture restrictions may be added
only with relevant browser testing, not as a guarantee against OS/browser media controls.

The current pointer-events-none layer does not intercept clicks. If an interaction shield is added, route
intentional sound recovery through an actual gesture handler and test iframe behavior. A tap may show minimal
status, never commissioning or maintenance. Do not mask creative content, rely on browser-specific CSS as
an absolute guarantee, or block the only interaction that can recover playback.

## 6. Delivery and verification sequence

1. Specification correction and Release A deployment complete; see the handoff below.
2. Release A verified: lifecycle, authorization-state, queue/pairing and browser checks, TypeScript and
   production build passed. The reviewed commit was released through the existing Firebase workflow.
   The temporary export limitation remains documented below.
3. Release B scoped maintenance is implemented locally; see §8 for the release prerequisite and verification boundaries.
4. Review audio configuration/fallback and then caption/control changes as separate diffs after A. They need
   not wait for B and must not expand A's acceptance scope. Heartbeat-driven refresh remains a follow-up.
5. Record actual results and exact release SHAs in AI-LOG.md. Keep source review, automated tests, desktop
   browser tests and physical-device validation distinct. Do not mark an untested browser/device as passed.

Presence remains presence, unmeasured remains null, and all existing tenant, provenance and locked-config
rules continue to apply. This plan changes presentation, maintenance access and sound behavior; it does not
redefine delivery acceptance, billing, measurement or browser-storage durability.


## 7. Release A implementation and deployment handoff — 25 Sep 2026

The implementation is in `app/player/page.tsx` (player version `gridcast-web/0.5.0`),
`lib/player-diagnostics.ts` and `lib/player-media-cache.ts`. Application commit `f566bbb` is live on Firebase
through `build-2026-09-25-004`. Health confirmed Firestore database `gridcast`; a fresh unpaired browser
loaded the player and version `gridcast-web/0.5.0` without page errors or HTTP 5xx responses. This was a
read-only production smoke check, not a paired-device or venue-camera test.

- Preview visibility uses presentation state without replacing the camera element. Capture restarts are
  keyed to camera/model settings, not unrelated configuration-version changes. Public export and diagnostic
  clearing are removed, and the credential is preserved while pairing recovery is open.
- All authenticated player requests use the same rejection handling. Explicit same-identity retry waits
  for evidence/revocation writes and uses a fresh authenticated playlist plus a local revision check to
  restore cache authorization. Old downloads cannot lift a newer rejection; existing play allowances remain
  consumed. Pairing is serialized across tabs using Web Locks and rechecks the shared identity. Browsers
  without Web Locks refuse pairing with an explanatory message rather than silently bypass coordination.
- Diagnostic storage uses transactional IndexedDB, migrates the legacy localStorage result without dropping
  it before commit, and retains blocked results separately from the pending result. Limits are 32 entries
  and 2 MiB per device, with 64 KiB reserved before each run. A reservation abandoned for two minutes becomes
  retained interrupted-run metadata; its capacity remains available for a late completion of that same run.
  No retention eviction is performed. Oversized legacy evidence is preserved and blocks new reservations.
- Failed result writes retain their exact payload in memory and retry while the player remains open.
  Pairing transitions cannot discard unresolved writes. This is not durable storage while the browser's
  storage is broken: closing the page at that point can still lose the unsaved payload, so recovery messages
  tell the operator to keep the player open. Normal successfully stored records survive reload.
- Diagnostic capacity errors are visible without revealing camera/tools or consuming another test run.
  Commercial queue exhaustion retains its existing scheduling behavior and distinguishes records awaiting
  upload from records requiring authorized review.

Validation uses the unit/API suite, real Chromium browser integration tests, TypeScript and a production
build; exact outcomes and commit references are recorded in AI-LOG.md. Browser tests exercise the pinned
TensorFlow/COCO-SSD model with a synthetic camera, plus deterministic frame/count cases. They do not prove
venue counting accuracy, physical Android/WebView behavior, or Safari/Brave-specific behavior. Those checks
remain open. Authorized export remains unavailable on the current production Release A until Release B is deployed; audio remains unchanged.


## 8. Release B local implementation handoff — 25 Sep 2026

**Application version:** `gridcast-web/0.6.0`. This section describes local source, not a production release.
The verified live application at the top of this document remains Release A.

### Operator workflow

1. On the human's own device, open the screen dashboard and **Saved records and player maintenance**.
   Select the exact current or historical device identity. Create a one-time maintenance code.
2. In the browser holding the saved records, open `/player/maintenance` in a **new tab** and enter that code.
   Do not move the full dashboard session to the kiosk. Keep existing player tabs open; reload older tabs
   when prompted so they participate in evidence coordination. Do not clear browser storage.
3. Review pending/blocked delivery counts and diagnostic evidence. **Export this identity's records**
   requests a JSON download including original payloads, identities, timestamps and errors. It never
   deletes or relabels records, and it never exports another identity's history.
4. For a grant covering this browser's current identity, **Prepare replacement** pauses cooperating player
   tabs, finalizes pending writes and attempts a bounded retry with the original playback token. The pause
   spans review, export and acknowledgement. Check the downloaded file yourself; a browser download event
   cannot prove a durable backup. Enter a separate destination pairing code to confirm replacement.
5. Cancellation/closure releases the pause. Expiry, hidden maintenance tab, reload, offline state and loss
   of issuer authorization close the local tools. Original evidence remains; failed or uncertain pairing
   does not imply server rollback, and cannot guarantee that the original token is still valid.

### Authorization and persistence

- Dashboard paths: `GET/POST /screens/:screenId/maintenance` and
  `POST /screens/:screenId/maintenance/:grantId/revoke`. All require an authenticated human with screen
  capability in that screen's organization, or platform scope.
- Kiosk paths: `POST /maintenance/redeem`, `/maintenance/check`, `/maintenance/export`,
  `/maintenance/replace`, `/maintenance/close`. Sensitive operations require explicit organization,
  screen and device identity matching the grant. The maintenance capability cannot authorize playback,
  dashboard access, relabeled receipts or another identity's export.
- Codes contain 16 random characters and are displayed in four groups. Only their SHA-256 digest identifies
  the persisted grant; session credentials are also stored only as hashes. Redemption is transactional and
  one-time across instances. The original ten-minute deadline never extends. Kiosk authority lives only
  in memory; monotonic expiry is bounded using server-reported remaining time.
- Issuer status, role, organization and auth-version are rechecked at redemption and sensitive operations.
  Historical revoked devices can be recovered under valid human scope without a valid playback token.
- Guessing budgets are transactional and persist even on denied requests: 120 attempts globally and ten
  per client bucket per minute. There are 4,096 fixed hashed client buckets plus one global counter;
  collisions conservatively throttle. This bounds public limiter storage rather than creating unlimited
  records from arbitrary client identifiers. Audit rows never contain codes, tokens or exported payloads.
- Active grant listing excludes expired history; expired grants are retained and do not consume the current
  query's row allowance. This release does not add retention deletion or evidence-import/billing changes.

### Local evidence coordination and limits

Player tabs hold shared evidence locks. Maintenance requests an exclusive lock; a player releases only
when active evidence has been finalized and pending writes have settled. Planned replacement keeps a
memory-only pause lease until confirmation, cancellation or session closure. Export and replacement
re-read identity-scoped evidence; changed evidence requires a fresh review/export rather than weakening
the comparison. Release waits for in-flight work. Public pairing still needs its own valid code and uses
its existing cross-tab pairing lock.

The service worker probes open `/player` tabs for this coordination protocol. Older tabs fail closed with
reload instructions; their absence from the lock API is not mistaken for safety. Maintenance requires
Web Locks, BroadcastChannel and service-worker support. The browser controls local storage and can evict
it; this feature does not promise durability after browser clearing, forced termination or OS failure.
Exports do **not** free commercial or diagnostic capacity. The previously identified commercial blocked-row
capacity defect is a separate follow-up. Audio, captions and YouTube hover/change chrome remain unchanged.

### Release prerequisite and validation

**Before deploying B**, deploy and wait for the new Firestore composite index:
`maintenance_grants`: `screen_id ASC`, `expires_at ASC` (`firestore.indexes.json`). Then release the reviewed
application commit through the existing Firebase workflow. No cloud resource or index was changed in this
build task.

Tests cover real browser IndexedDB/service-worker/lock behavior, dashboard and kiosk UI, device-specific
exports, delayed responses after closure, planned replacement, and full-player pause/finalize/resume.
Backend tests include cross-process one-time redemption and rate limits using the Firestore emulator.
Exact test counts and source/commit references are in `AI-LOG.md`. Emulator success does not verify that
the production composite index is ready. Tests do not establish OS download completion, physical Android
behavior, Safari/Brave-specific behavior, or camera accuracy at a venue.
