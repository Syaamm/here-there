# Moving from SQLite to Postgres: the checklist

Status: PLANNED, nothing here is done yet (written 2026-10-29). Do it when a Postgres database exists to test against.
The code has no raw SQL (everything goes through Prisma), so this is mostly settings, tests and a few behaviour checks.
Order of the wider launch work is in `FOR_DEPLOYMENT.md` (Postgres first, then Redis, then more servers).

## Steps, in order

- [ ] 1. **Provider and address.** `prisma/schema.prisma`: `provider = "postgresql"`; `DATABASE_URL=postgresql://...`. `dev.db` data does not carry over (start empty, or write a one-off copy script). Move from `db push` to real Prisma migrations for production.
- [ ] 2. **Test set-up.** Every test file makes a throwaway SQLite file (`file:./test.db`, `test-<name>.db`, `overview-test.db`, `docs-test.db`) in `before()` and deletes it after. Replace with a Postgres test database (a schema per test file, or a fresh database per run). Files: `test/harness.ts`, `test/p0.test.ts`, `test/docs.test.ts`, `test/admin-overview.test.ts`. Also `scripts/gen-docs.ts`, the seed and demo scripts.
- [ ] 3. **Run all tests and fix what fails** (195 pass on SQLite as of 2026-10-29).
- [ ] 4. **Case-sensitive search.** SQLite `contains` ignores case, Postgres does not. Add `mode: 'insensitive'` to the admin user search (`admin.controller.ts`, email and display name). NOTE: that option fails on SQLite, so it can only be added at the switch. Check that emails are always stored lowercase. Trip destination search is safe (searches a lowercased copy, `destinationKey`).
- [ ] 5. **Alerts searched by their JSON text.** These filter the `Notification.data` text column with `contains`: the unread-chat check (`conversations.controller.ts`, two places) and `settleRequest` (`notifications.service.ts`). Works on Postgres but cannot use an index. Better: real columns (for example `conversationId`, `activityId`, `tripId`, `applicantId`) on `Notification`, filled when an alert is created, with an index.
- [ ] 6. **Behaviour differences to check.**
  - Ordering: any sort without an `id` tie-breaker can return equal rows in a different order.
  - Time precision: Postgres keeps microseconds, SQLite milliseconds; re-check the keyset cursors (`common/paging.ts`, the activity cursor, the feed cursor).
  - Stricter concurrency: races that SQLite hid by running one write at a time (two people taking the last place, joining at the same moment) can surface as real conflict errors; add retries or row locks where it matters (joinNow, approvals, fillFromWaitlist, announce spot).
  - Connection pool: size it against Postgres's connection limit and the number of API servers.
- [ ] 7. **Optional, after the switch works.**
  - PostGIS for the distance filter (today the exact radius runs in code after the query).
  - Real array/JSON columns for tags, languages and the `data`/`meta` text fields.
  - Photos to cloud storage + CDN instead of `ProfilePhoto.data` bytes.
  - Run the load test (`production-readiness-checklist`, item 13).

## Already done that helps
Cursor paging everywhere (2026-10-26/27), indexes on the busy columns (2026-10-29), one-query counting for lists, the password-hash limiter.
