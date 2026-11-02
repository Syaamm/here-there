# Load test

Simulates many signed-in phones chatting at once and reports what a person would feel: how long a send takes, how long until the **other members** receive the message over the live connection, how many messages are lost, and the errors.

Scripts: `services/api/scripts/load-seed.ts` (data) and `services/api/scripts/load-test.ts` (the run).

## Rules
- **Use a throw-away database.** The seed writes thousands of people, groups and messages. Never the owner's data, never the live site.
- The runner refuses any address that is not this computer unless you pass `--allow-remote`.
- Everything the seed makes is `load-NNNNN@load.test`; `npm run load:seed -- --clean` removes it.

## Run it (from `services/api`)
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

Still to do: runs of 5,000 and 10,000 phones, a sign-in burst (2,000 sign-ins take about 35 s, 30 a second, because Argon2id is slow on purpose), a longer run to see memory growth, one chat with a very large group, and the same test with the generator on another machine against a production-like server. Clean up afterwards by dropping the throw-away database.
