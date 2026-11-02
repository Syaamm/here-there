# The move from SQLite to PostgreSQL

Status (2 November 2026): **done in the code.** All 282 tests pass on PostgreSQL 18 (the whole suite takes about 2 minutes, against about 30 minutes on SQLite). Still open: the owner's own local database, a managed Postgres server for going live, real Prisma migrations, PostGIS, alert columns, backups and the load test (see "Still open").

The code has no raw SQL worth the name (everything goes through Prisma), so the move was mostly settings, tests and a few behaviour checks. The order of the wider launch work is in `FOR_DEPLOYMENT.md` (Postgres, then Cloudflare, then a load test, then Redis and more servers if needed).

## Your own database (do this once)

1. Create an empty database on your PostgreSQL service, for example `herethere` (pgAdmin, or `psql` in `C:\Program Files\PostgreSQL\18\bin`).
2. In `services/api/.env` set `DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/herethere"`. Special characters in the password must be percent-encoded (`@` becomes `%40`, `#` becomes `%23`). Optionally set `TEST_DATABASE_URL` for the tests (default: the same database; the tests only touch schemas named `test_*`).
3. In `services/api`, with the API stopped: `npm run build`, `npm run db:push`, `npm run seed`, then `npm start`.

Your old `dev.db` data does not carry over: the app starts empty, and the demo scripts (`npm run demo:feed` and the others in `services/api/package.json`) refill it with sample people and plans. `dev.db` is not used any more and can be deleted.

## What was changed

- **Provider and address:** `prisma/schema.prisma` uses `provider = "postgresql"`; `DATABASE_URL` is a `postgresql://` address. `scripts/gen-docs.ts` uses a placeholder address (it only assembles the app and never connects). The SQLite write-ahead-log code in `common/prisma.service.ts` was removed.
- **Test set-up:** `test/test-db.ts` gives every test file its own schema `test_<name>` inside one database, builds its tables with `prisma db push`, and drops the schema afterwards. The address comes from `TEST_DATABASE_URL`, or `DATABASE_URL`, taken from the environment or from `services/api/.env`. Only schemas starting with `test_` are ever dropped, so the data in the normal schema is safe. `KEEP_TEST_DB=1` leaves a file's schema in place after the run, to look at the rows after a failure. The 18 `p0-*` files, `harness.ts`, `docs.test.ts` and `admin-overview.test.ts` use it. The harness option `queueWrites` (for SQLite's single writer) is ignored now.
- **Case-sensitive search:** SQLite's `contains` ignores case, Postgres does not. The admin user search (email and display name) now uses `mode: 'insensitive'`. Trip destination search was already safe (it searches a lowercased copy, `destinationKey`).
- **Join races:** `common/locks.ts` already took a lock on the activity or trip row before counting members. Running the tests on Postgres found one more place that needed it: the status after a join (`ActivitiesService.refreshStatus`: full / confirmed / published) read and wrote outside the lock, so ten people joining at once could leave a full activity marked "confirmed". It now counts and writes under the lock. `test/race.test.ts` covers it.
- **Three tests that only worked because SQLite was slow:**
  - the on-call escalation test expected nothing to be escalated, but an earlier test left a day-old report open; on SQLite a background schedule had happened to escalate it first. The test now empties the open queue first;
  - the presence push test added a made-up push token while a "you can now chat" push was still queued; on Postgres that push reached the real Expo, the token was refused and deleted. The test now lets queued pushes finish first;
  - the identity test built the verification service without the job scheduler it now needs.
- **Push grouping:** found on the way. The one-push-a-minute window for a chat started even when there was nobody to push to, so the next message was skipped. It now starts only when a push is really sent (`PushService.noteSent`).

## Behaviour differences, and what was checked

| Difference | Result |
|---|---|
| Sort order of equal rows | The paged lists (`pageOf`, `sliceKeyset`, the feed cursors) sort by a time and then `id`, and the paging tests pass. Lists elsewhere were not checked line by line: a sort with no `id` tie-breaker can return equal rows in another order on Postgres. Also, Postgres puts empty (NULL) values first when sorting from high to low, SQLite last. |
| Time precision | Prisma's `DateTime` columns are `timestamp(3)` on Postgres (milliseconds, like before), so the paging cursors (`common/paging.ts`, the activity and feed cursors) compare the same values; the paging tests pass. |
| Several writers at once | The only unprotected read-then-write found was the status refresh above. Joining, approving and the waiting list already lock the row. |
| Connection pool | Not set yet. See "Still open". |
| Raw SQL | Two start-up statements in `regions.service.ts` (`lower(trim(...))`) and a `SELECT 1` health check; all valid on Postgres. |

## Still open

- **Your own database** (steps above).
- **A managed Postgres on the live server**, with backups and a tested restore. Set the pool size with `?connection_limit=N` in `DATABASE_URL`: N times the number of API servers must stay under the database's own connection limit; use PgBouncer or the host's pooler with several servers.
- **Real Prisma migrations** (`prisma migrate dev` to write them, `prisma migrate deploy` on the server) instead of `db push`, before the first upgrade of live data.
- **Alerts found by their JSON text.** These filter the `Notification.data` text column with `contains`: the unread-chat check (`conversations.controller.ts`, two places), `settleRequest` and the grouping check (`notifications.service.ts`). They work on Postgres but cannot use an index. Better: real columns (`conversationId`, `activityId`, `tripId`, `applicantId`) on `Notification`, filled when an alert is created, with an index.
- **PostGIS** for the distance filter (today the exact radius runs in code after the query), real array or JSON columns for tags, languages and the `data` / `meta` text fields, photos in cloud storage with a CDN instead of `ProfilePhoto.data` bytes.
- **The load test** (`FOR_DEPLOYMENT.md` section 9 E): a seed script with realistic data and k6 scripts for browsing, joining, chat and sign-in bursts, run against a production-like server.

## If the machine's Postgres asks for a password you do not have

For testing you can run a private throwaway cluster that does not touch the real service (Windows, from `C:\Program Files\PostgreSQL\18\bin`):

1. `initdb.exe -D <folder> -U postgres -A trust -E UTF8 --locale=C -N` (no password; this takes a few minutes).
2. `pg_ctl.exe -D <folder> -o "-p 54329" -l <logfile> -w start`.
3. `psql.exe -h 127.0.0.1 -p 54329 -U postgres -c "create database herethere_dev"`.
4. Use `DATABASE_URL=postgresql://postgres@127.0.0.1:54329/herethere_dev`.

Start the programs with output redirected to files (PowerShell `Start-Process -RedirectStandardOutput`); piping their output straight into another command hangs on this machine. Stop it with `pg_ctl.exe -D <folder> stop`.
