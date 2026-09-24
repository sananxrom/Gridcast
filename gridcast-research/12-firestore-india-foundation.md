# Gridcast — Firestore India foundation

24 September 2026 · base source `13083f5` · setup completed separately from app migration.

## Resources

| Item | Verified state |
|---|---|
| Firebase project | `gridcast-508011` |
| Database | `gridcast` (named database, not `(default)`) |
| Region | `asia-south1` — Mumbai, India |
| Edition | Enterprise; follows the Firebase skill's new-database default |
| Data interface | Firestore native enabled; MongoDB disabled |
| Realtime updates | Disabled; no app realtime dependency currently exists |
| Deletion protection | Enabled |
| Existing App Hosting backend | `gridcast-backend`, `asia-southeast1` — Singapore |
| App uses new database | No — collections-based adapter/migration remains to be implemented |

The Firestore API was initially disabled. After enabling it through the existing
Firebase login, database listing returned an empty list; no existing database was
replaced. The Google Cloud CLI had an unrelated active identity and was not used
to mutate Gridcast. Database creation and subsequent metadata readback succeeded.
No database documents or application credentials were created in this step.

## Hosting review

Official [Firestore locations](https://firebase.google.com/docs/firestore/enterprise/locations)
include Mumbai and Delhi. Official [App Hosting locations](https://firebase.google.com/docs/app-hosting/about-app-hosting#app-hosting-locations)
currently include Singapore but no India region. The existing backend stays in
Singapore, which means a future database connection crosses regions. This setup
does not place the app runtime wholly in India.

If India-only runtime is required, [Cloud Run supports Mumbai](https://cloud.google.com/run/docs/locations).
That is a separate deployment and cutover; this work creates no replacement backend
and does not retire either live origin. Database location cannot be changed in place.

## Access model and validation

`firestore.rules` is an initial deny-all client policy, not the eventual application
authorization system. Current application code has no Firestore client queries,
collections or SDK usage. Server SDK access uses IAM and bypasses these rules;
`lib/access.ts` and server-side tenant checks remain necessary after integration.
No data model-specific client validators are needed while all writes are denied.
`firestore.indexes.json` is intentionally empty until query shapes are implemented.

Firebase's rules test service compiled the file with zero issues. Nineteen synthetic
contexts were expected to be denied and all passed: public list/read; anonymous
create; foreign-owner create/update; immutable timestamp update; wrong types;
oversized update; required-field omission; self-admin creation; schema pollution;
invalid state transition; foreign path reference; negative amount; another user's
contact read; counter replay; orphan subcollection read; authenticated list; delete.
The rules contain no resource fetches, so these tests did not write documents.
These checks cover the initial deny-all policy, not the future server IAM/query layer.

Rules release status is recorded in `AI-LOG.md`. Apply only the named database's
rules with `firebase deploy --only firestore:rules --project gridcast-508011`;
this is separate from application deployment.

## Next implementation boundary

1. Create server repositories for individual entities and bounded event queries.
   Do not map the old JSON blob into one Firestore document or load all history on
   every request. Keep credentials and private organisation fields out of public
   projections. Preserve own-org and transaction-reference checks from WP1.
2. Use transactions/preconditions for concurrent entity edits, role/session
   revocation, unique account email, play idempotency and accrual. A per-process
   request queue is insufficient across hosting instances.
3. Plan indexes from actual queries; Enterprise does not auto-index every field.
   Preserve raw measured/unmeasured provenance and explicit synthetic seed source.
4. Exercise the same authorization suite against an emulator-backed repository,
   plus concurrency, retries, duplicate events and migration consistency tests.
5. Provision real accounts and hosting secrets, validate runtime IAM, then cut over
   an isolated app deployment. The existing file-backed app is unchanged remotely.

Do not mark WP0 or WP4 complete from database creation alone. The current API's
production guard only accepts Redis and must be updated along with the actual
Firestore adapter, after tests. No live data transfer has occurred.
