# Continuous playback, budgets and offline media

This decision supersedes the fixed-loop timing and physical slot-capacity model in document16. Approved by Sanan on25September2026 after the continuous rotation and filler discussion.

## Playback and allocation

Eligible paid ads repeat continuously. A round has no fixed wall-clock length and no intentional blank interval. Each booking has an integer `rotation_weight`: relative turns per round, default1. Existing explicit `slots_per_loop` values are read as relative turns until a campaign is edited; legacy implicit allocations retain their previous relative count. The next campaign edit persists the new field. Actual media duration determines airtime. Turns are not guaranteed plays/hour or share of airtime. Less competition can increase play frequency and spending. Distinct advertiser and released network advertiser limits remain enforced across overlapping bookings.

Uploaded videos use server-inspected duration. Static PNG/JPEG/WebP images have operator-set duration, default20seconds, allowed1–600seconds, and verified dimensions. Changing image duration requires approval again. Screens set minimum and maximum creative duration; an out-of-range creative is not eligible. Legacy loop/slot settings remain readable for historic estimates but no longer schedule the web player.

Monthly screen value and per-advertiser monthly price still derive from venue factors and the distinct-advertiser count. The legacy reverse calculator is an illustrative historical estimate, not a continuous-delivery frequency promise. Existing agreed per-play prices remain frozen. There is no separate hourly pacing cap in this release; total budget and the bounded assignment allowance constrain delivery.

## Budget control

Per-campaign Firestore ledgers atomically reserve monetary allowances across screens before playback. Each immutable assignment carries a finite `max_plays`, a frozen price and validity. The player consumes a durable IndexedDB allowance before attempting playback, including across tabs and browser restarts. Failed attempts may strand allowance temporarily; they cannot create additional authorizations. The server reconciles evidence idempotently and releases remaining holds only after their acceptance period. Outstanding reservations cannot be spent by a second screen or erased by reducing the campaign budget.

Legacy assignments receive conservative holds until receipt acceptance expires. This can temporarily reduce availability; evidence is not silently cancelled. Old players cannot obtain new paid playlists without protocol2. A player already holding old valid instructions needs a refresh; a deployment cannot revoke instructions on a disconnected old browser instantly. Receipt-side enforcement protects charges. Per-play budgets stop further paid authorization; flat agreements are not charged per play.

## Filler and measurement

When paid allowances or eligibility run out, approved uploaded filler owned by the screen organisation is eligible. Filler has no advertiser/campaign charge and is recorded separately with a null campaign. Presence remains presence, not unique visitors or footfall. Filler still consumes physical playback time. Once paid delivery becomes eligible it resumes at a creative boundary. No filler assets are invented during deployment: an empty authorised content pool shows an explicit waiting state. A never-blank guarantee requires configured, playable fallback media.

## Offline preparation and limitations

Uploaded media is downloaded in the background and verified by SHA256 and byte count. The saved schedule is replaced only after all media needed for that offline schedule is ready. The app shell and uploaded blobs support restart without a connection. Local allowances and server validity continue to apply. Authorizations last at most24hours for uploaded-only schedules and may be shortened by screen hours, campaign dayparts/end or mixed online media. Storage eviction, first installation without connectivity, corrupted downloads and expired authorizations must fail honestly.

YouTube remains online-only. No YouTube audiovisual downloading or offline caching is implemented. YouTube transitions cannot promise the same continuity as preloaded native media. Offline changes to campaign status, schedules or approval take effect once the device reconnects or its issued authorization expires.

## Rollout evidence

Automated unit, API, browser and Enterprise Firestore emulator checks are recorded in AI-LOG.md with the release SHA. Simulated timing and local offline checks are not a physical72-hour screen burn-in. Existing organisations, screens, accounts and media are preserved. No demo reseed or account reset is part of this release.
