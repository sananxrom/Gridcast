# Reporting release — docs 17 and 18

## Implemented

Daily reporting is a separate read model, written atomically with accepted device receipts. Keys include screen, campaign, creative and IST delivery-start day. This extra attribution is necessary to isolate advertisers and provide campaign/creative comparisons. Device retry identity protects reporting and settlement together. Billing decisions remain unchanged.

Paid rendered, paid billable, paid failed and filler reports remain separate. Presence sums and measured-play counts include only rendered paid plays with valid clocks; no mean-of-means and no substitution of zero for missing measurement. Invalid-clock receipts are counted separately on receive day, excluded from dated delivery and presence. Filler measurement and airtime remain separate.

The authenticated metrics endpoint pages through all summaries in an explicit 1–93-day range. Operators see their receiving organisation; advertisers see only their advertiser ID across receiving organisations; administrators may select an organisation or the platform. Bootstrap no longer returns event history. Limited detail receipts remain under Diagnostics, labelled with their actual loaded time window.

Admin, operator, advertiser, campaign and screen pages use these summaries. Date presets and custom dates use IST. Numbers have clickable definitions; daily delivery and hourly presence preserve unknown values. Sparse series use exact tables. CSV exports the full selected daily aggregate range with numerator, denominator and coverage, not the loaded receipt window. Large tables and screen cards paginate.

## Coverage and deliberate limits

The first accepted receipt creates a reporting-start marker. Before that marker the UI displays unavailable, not zero. Earlier dates and the first partial day remain explicitly incomplete; old receipts have not been backfilled. Offline devices may report up to 72 hours late. A fully covered period means the writer was active, not that every device has reported. Pages load every aggregate page before presenting totals; these live reads are not a frozen, cross-request accounting snapshot. Settlement remains the existing authoritative money path.

Continuous playback has no fixed expected-play contract, so no loop-derived delivery percentage or projected pacing target is invented. Historical uptime requires heartbeat history and is not inferred from play gaps. Fleet uptime heatmaps, maps, controlled A/B claims and PDF reports are not part of this release. Existing current-inventory capacity meters remain. Full raw receipt export/pagination is separate follow-up work; current CSV is an explicitly named daily summary export and diagnostics exports say limited recent diagnostics.

## Verification

- Unit suite: 226 tests, 222 passed, four emulator-only tests skipped, zero failures.
- Enterprise Firestore emulator: 20 passed, zero failures/skips. Includes concurrent writes, duplicate retries, cross-process settlement/reporting and real scoped metrics queries.
- Browser regressions: 35 existing tests plus two reporting tests passed (the two isolated screen-readiness tests were rerun after adding their new reporting dependency stub). Covers actual self-hosted detector inference, continuous rotation, offline media, budgets, diagnostics, report pagination, keyboard explanations, CSV, mobile viewport and missing coverage.
- TypeScript and production build passed before release; final build rerun after directory coverage copy clarification.
- All 69 required Firestore indexes READY, including 12 additive reporting indexes. No existing index removed.

## Deployment

Firebase App Hosting, existing Singapore backend; Firestore remains Mumbai. Deployment SHA and live verification belong in AI-LOG.md. No Vercel deployment is requested for this release.
