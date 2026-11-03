# Load test

Simulates many signed-in phones chatting at once and reports what a person would feel: how long a send takes, how long until the **other members** receive the message over the live connection, how many messages are lost, and the errors.

Scripts: `backend/api/scripts/load-seed.ts` (data) and `backend/api/scripts/load-test.ts` (the run).

## Rules
- **Use a throw-away database.** The seed writes thousands of people, groups and messages. Never the owner's data, never the live site.
- The runner refuses any address that is not this computer unless you pass `--allow-remote`.
- Everything the seed makes is `load-NNNNN@load.test`; `npm run load:seed -- --clean` removes it.

## Run it (from `backend/api`)
```
npm run build

# 1. an EMPTY database of its own, with the tables
DATABASE_URL=postgresql://USER:PASS@localhost:5432/loadtest npm run db:push

# 2. the data: 300 people in groups of 10 (writes load-manifest.json)
LOAD_DATABASE_URL=postgresql://USER:PASS@localhost:5432/loadtest npm run load:seed -- 300 10

# 3. an API on that database, with settings that let one computer act as many people (test servers only)
DATABASE_URL=postgresql://USER:PASS@localhost:5432/loadtest PORT=3100 TRUST_PROXY=1 ACCESS_TOKEN_MINUTES=600 REGISTER_LIMIT_PER_HOUR=100000 npm start

# 4. the test
npm run load:test -- --base http://localhost:3100 --users 300 --seconds 60 --msgs-per-min 6
npm run load:test -- --base http://localhost:3100 --users 300 --seconds 60 --mode legacy   # compare with the old behaviour
```
Options: `--users` (whole groups only), `--seconds`, `--msgs-per-min` (max 25; the server allows 30), `--mode optimised|legacy`, `--manifest`, `--allow-remote`.

## What it does
1. Signs everyone in (the real Argon2id sign-in), 20 at a time.
2. Opens a live connection per phone and sends `presence`.
3. For the duration, each phone sends chat messages at a random pace and polls the feed and alerts about once a minute. When another member's message arrives it behaves like the app: `optimised` = the message goes on screen as it is and the phone has told the server its chat is open (no extra calls), `legacy` = re-read the whole chat page for every message.
4. Prints a table per request (count, per second, p50/p95/p99, status codes) and the live-delivery summary, and saves `load-result-<mode>-<phones>.json`.

**Verdict OK** = under 1% of messages lost, 95% delivered within 2 s, under 2% of connections dropped.

## Reading the results
- `lost` > 0: live messages not delivered. `connectionDrops` > 0: sockets closed during the run.
- `429` on a request: a rate limit answered (expected for abuse limits, a finding if it is a normal action).
- `0` as a status: the connection itself failed (server overloaded or down).
- The first seconds after the server starts are slow (cold start); one early run showed 4 s tails that did not come back.
- The client and the server share one computer in a local run, so numbers are a floor on what the server can do, not a ceiling. For real figures run the client on another machine and pass `--allow-remote` with a **test** server that looks like production.

## Results (2 Nov 2026, one laptop: server, PostgreSQL 18 and the load generator all on the same 8-core machine)

**2,000 phones, 200 groups of 10, 60 s of chatting.**

| | Before the fixes | After the fixes |
|---|---|---|
| 1 message per person per minute (about 33 messages a second) | NOT OK: send p95 24 s, live delivery p95 18 to 22 s, 30 to 50% of requests failed | **OK**: send p95 91 ms, live delivery p95 84 ms, no errors, nothing lost |
| 6 messages per person per minute (about 165 messages a second, 1,500 live deliveries a second) | NOT OK: send p95 21 to 35 s, most requests failed | Degraded, not failing: no errors, nothing lost, send p95 5.4 s, live delivery p95 4.9 s |

A re-run later the same day with the Expo dev server closed (it had been using about 160% of a CPU) gave, at 6 per minute: send p95 3.2 s and delivery p95 2.9 s (0 failed, 0 lost), and at 1 per minute: send p95 86 ms, delivery p95 81 ms. Close other heavy programs before a run.

6 per minute from every phone is far more than real chat, so it is the limit-finding run: the server is the limit there, not the database.

What the test found and what was done about it (all in the code now):
1. **Logging was half of the server's busy time.** A CPU profile showed about 31% of the whole run in synchronous console writes: one line per request and one per slow query, and when the server is struggling every query is "slow", so it logged itself slower. Log lines are now written together every 100 ms (`LOG_FLUSH_MS`), and slow-query lines are capped at 10 a second (`SLOW_QUERY_LOG_PER_SEC`); the counters and the admin console still see every one. This matters on a real server too (pm2, systemd and docker pipes are synchronous as well).
2. **A push job was written for every member of every message** (about 20,000 job rows a minute at this size), even for people looking at the app. Decided in memory now, before any database write.
3. **The app tells the server which chat is open** (`{"type":"chat","id":...}` over the live connection). A member reading that chat gets the message live and no alert is written, so there is no "mark read" call and no badge refresh afterwards. At 1 message per minute this removed about 17,000 read calls a minute.
4. A bigger database connection pool made no difference: the database was never the limit (Postgres used a few percent of the CPU).

### 5,000 phones, full app (3 Nov 2026, same laptop: server, PostgreSQL 18 and generator together)
New: `--scenario full` makes each phone also browse, join, favourite, search trips, apply to trips and open its own plans and chats (`--browse-every <seconds>`, default 20), and the seed takes `--open=800 --trips=300` for things to browse. 100 phones in the full scenario: **OK**, every route answered 200/201, nothing lost.

5,000 phones (500 groups, 1 chat message a minute and one app action about every 20 s each, 180 s, about 410 requests a second plus 60,000 live deliveries): **NOT OK**.
- Sign-in of all 5,000: OK, 70 s (about 25 a second), p95 420 ms.
- Live delivery: nothing lost (0 of 60,093) and no dropped connections, but delivery p95 26 s.
- Every request type was slow (p50 about 3 s, p95 10 to 60 s); about half failed with status 0 (connection gave up on the client) and 226 join requests got a 500. The API process grew from 190 MB to 1.5 GB.
- **Re-runs with probes (same day, `backend/api/scripts/load-test.ts` now records why requests fail; the server was run with an event-loop and CPU probe and `--cpu-prof`):**
  1. First run's status-0 failures were mostly the generator running out of Windows network ports (`EADDRINUSE`, `ENOBUFS`). Fixed: the test now uses pooled keep-alive connections (`--http-sockets`).
  2. After that fix the result is the same shape: the server completes about 180 to 220 requests a second while the test asks for about 550 (5,000 phones, each one app action every 20 s, a poll every 45 s, one chat message a minute). The rest wait in a queue, so every request type shows a median of 20 to 60 s. Nothing is lost on the live connection (0 of 82,485), no connection drops.
  3. **The limit is the Node process's main thread, not the database or the pool.** Event-loop delay sat at 50 to 90 ms median (a healthy server is under 10 ms); the server used about 2 to 3 cores in total with the main thread near saturation; about half of its busy JavaScript time was Prisma's client layer (building queries, parsing engine answers), the rest request handling. Postgres used about 2 of the 8 cores (peaks near 3.5). A connection pool of 100 instead of 20 changed nothing (218 requests a second against 181). Single-row lookups logged as "slow, 250 ms" are time spent waiting for the busy main thread, not slow queries.
  4. **The 500s are a symptom.** Every one (159 and 267 in two runs) was a Prisma interactive transaction (joining a plan) that passed its own 5 s limit while queued. `ECONNREFUSED` in the last run is the server's accept queue overflowing for the same reason.
  5. Memory: the API process rose from about 190 MB to about 1.0 to 1.5 GB over the run and has not yet been shown to level off.
  6. **Run 5, after two code fixes** (home feed ranks on light rows and loads full details only for the page shown; the notifications list uses one grouped count instead of three). Same 5,000 phones, same load shape:

     | | Run 1 | Run 3 (port fix) | Run 4 (pool 100) | Run 5 (fixes) |
     |---|---|---|---|---|
     | Throughput (requests/s) | 410 (counts failed attempts, distorted by port exhaustion) | 181 | 218 | **283** |
     | Typical request (p50) | about 3 to 15 s | about 50 s | about 30 s | **about 28 s** |
     | 500 errors | 226 | 159 | 267 | **24** |
     | Live messages delivered | 60,093 of 60,093 | 82,485 of 82,485 | 73,260 of 73,260 | **102,429 of 102,429** |

     Still NOT OK at this intensity, but throughput is about 56% higher than run 3 and the 500s dropped from 159 to 24. Nothing lost and no dropped connection in any run; all 5,000 signed in every time (70 to 74 s). The 290 tests pass after the fixes.

     Where the busy time went in run 5 (CPU profile, 232 s busy): about 60% Prisma's client layer, about 11% request and log writing, about 10% chat send (alerts and fan-out), 4.5% the sign-in check on every request, 3% the feed ranking, 2.7% static-page handling running on API requests.
  - **What it means:** one API process handles roughly 1,500 phones that are this active at the same time (about 0.14 requests a second each). 5,000 phones at this intensity needs several API processes behind nginx, and that needs the live connection events shared between them (Redis, `FOR_DEPLOYMENT.md` section 11). Cheaper first: fewer database calls per request (plan detail, my plans, chat open and chat send are next), lighter per-request logging, and skipping the static-page lookup for `/v1/*`, so each request costs less main-thread time. After run 5 these are the ranked next steps; a short cache of the signed-in user row (needs a clear-on-change rule so suspensions stay immediate) and several API processes with Redis come after.
  - **Not claimed:** the numbers are a floor, because server, Postgres and generator share one laptop; real users are not all active at once, so 5,000 registered users is far lighter than 5,000 phones in this test.

Still to do: runs of 10,000 phones, a sign-in burst (2,000 sign-ins take about 35 s, 30 a second, because Argon2id is slow on purpose), a longer run to see memory growth, one chat with a very large group, and the same test with the generator on another machine against a production-like server. Clean up afterwards by dropping the throw-away database.
