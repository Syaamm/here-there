# HERE & THERE

Two social products in one app (the app is named **LAMIS**; HERE and THERE are its two modes), on one shared backend.

- **HERE.** Find and host things happening in the next hours: a coffee, a run, an aperitivo. Hosts choose *Request to join* (they approve each person) or *Instant join* (anyone verified is in until the places are full).
- **THERE.** Propose a trip, find travel companions and plan it together. A trip is always a proposal, never a booking, and the app never holds money.
- **Shared.** One account, one identity check, group chats, blocking and reporting, reliability levels, and a staff admin console.

Only verified adults can create, join or chat. Browsing needs no verification.

## What is in this repository

| Folder | What it is |
|---|---|
| `backend/api` | The backend: NestJS 12, Prisma 6 (PostgreSQL), zod, JWT, WebSocket live updates. Tests use `node:test`. |
| `frontend/mobile` | The app for iOS, Android and web: Expo SDK 58 (React Native), expo-router. HERE and THERE are two modes of the same app. |
| `frontend/admin` | The staff console: Vite and React. Reports, identity checks, users, appeals, no-shows, audit log, overview dashboard. |
| `deployment/` | Everything for putting it on a server: `DEPLOY.md` (the step-by-step guide), `FOR_DEPLOYMENT.md` (settings, keys, limits, checklist) and the build and deploy scripts. |
| `handover/` | Notes for whoever takes the project over: the project hand-over, `WORKFLOW.md` (how the app works end to end) and the dated client progress reports. |
| `docs/` | Load-test notes, the Postgres move and the compliance drafts (see below). |
| `backend/api/docs/` | The generated API documentation. |

The code lives in `backend` and `frontend`; the other folders are documents and scripts. `build/` (made by `npm run build:web`) is the built website the API serves.

## Run it on your own computer (for anyone who gets the project from GitHub)

Windows PowerShell shown; macOS and Linux use the same commands (copy the file with `cp` instead of `Copy-Item`). Do each step in order.

**1. Install these once:** [Node.js](https://nodejs.org) 24 or newer (it includes npm), [Git](https://git-scm.com) and [PostgreSQL](https://www.postgresql.org/download/) 16 or newer (remember the password you set for the `postgres` user). For the app on a phone, also install **Expo Go** from the App Store or Play Store.

**2. Get the code and install it:**

```
git clone https://github.com/Syaamm/here-there.git
cd here-there
npm install
```

**3. Create an empty database** (use the password from step 1):

```
psql -U postgres -c "CREATE DATABASE herethere;"
```

**4. Settings.** Copy the example file and open it:

```
cd backend/api
Copy-Item .env.example .env
```

In `.env` set `DATABASE_URL` to `postgresql://postgres:YOUR_PASSWORD@localhost:5432/herethere` and leave the rest as the example has it. With the example values, sign-up codes appear in the app and in the API console, so you need no email, SMS or identity account. Never commit `.env`.

**5. Create the tables and the first admin** (still in `backend/api`):

```
npm run db:generate
npm run db:push
npm run seed
npm run build
```

Optional sample plans and trips to look at: `npm run demo:feed` and `npm run demo:there`.

**6. Start it.** Open three terminals in the `here-there` folder, one command each:

```
npm run api                  # the API, port 3000 (leave running)
npm run mobile               # the app, port 8082: press w for the browser, or scan the QR code with Expo Go
npm run admin:standalone     # the staff console, port 5173
```

On a real phone the API must be reachable from it: use the same Wi-Fi and set `EXPO_PUBLIC_API_URL=http://<your-computer-ip>:3000` in `frontend/mobile/.env` (copy `frontend/mobile/.env.example`), or follow `frontend/mobile/README.md` for tunnels.

**If something fails:** `database ... does not exist` means step 3 was skipped; `password authentication failed` means a wrong password in `DATABASE_URL` (a special character in it must be %-encoded); `port 3000 in use` means another API is already running. After you change `prisma/schema.prisma`, stop the API and run `npm run db:push` and `npm run build` again.

**Check that it works** (in `backend/api`): `npm test` runs every test (about two minutes). Type-check the apps with `npx tsc --noEmit` inside `frontend/mobile` or `frontend/admin`.

## Commands to run it on the server

In the repository folder on the server (`backend/api/.env` already holds the five lines from `deployment/DEPLOY.md`):

```
git pull
npm ci
npm run deploy
pm2 restart herethere || pm2 start "npm start -w @here-there/api" --name herethere
pm2 save
pm2 logs herethere    # read errors, for example push settings
```

The API then serves the web app at `/`, the admin console at `/admin/`, the API at `/v1` and live updates at `/v1/live`, all on port 3000 behind nginx. Run one API process only.

**Tests and docs** (in `backend/api`): `npm test`, `npm run docs`. **Phone builds and over-the-air updates:** `deployment/BUILDS.md` (raise `"version"` in `frontend/mobile/package.json` before every build).

## Get it running

You need Node.js (the project was built with version 24) and npm. Run `npm install` once in the repository root; `backend/api`, `frontend/mobile` and `frontend/admin` are npm workspaces.

1. **Settings.** In `backend/api`, copy `.env.example` to `.env` and fill it in (at least `DATABASE_URL`, `JWT_SECRET`). Every setting is explained in `deployment/FOR_DEPLOYMENT.md`. Never commit `.env`.
2. **Database.** In `backend/api`: `npm run db:push` (creates the tables in the PostgreSQL database named in `DATABASE_URL`; create the empty database first). Optionally `npm run seed` for the first staff account.
3. **API.** In `backend/api`: `npm run build`, then `npm start`. It listens on port 3000.
4. **App.** In `frontend/mobile`: `npm start` (Expo on port 8082). Scan the QR code with Expo Go, or press `w` for the browser version. See `frontend/mobile/README.md` for phones, tunnels and builds.
5. **Admin console.** In `frontend/admin`: `npm run dev` (port 5173).

After you change `prisma/schema.prisma`, stop the API, run `npm run db:push`, rebuild, and start the API again.

### Sample data

`npm run demo:feed`, `demo:there`, `demo:chat`, `demo:waitlist`, `demo:reliability` and the other `demo:*` scripts in `backend/api` fill the *development* database with sample accounts and plans for trying one feature. They never touch a live server.

## Deploying (from git)

The full guide is **`deployment/DEPLOY.md`**: a test site in development mode (no production keys), written for a developer or for Claude doing it for you. In short, on the server, in the repository folder (Node 24.7 or newer, a PostgreSQL database, and `backend/api/.env` with `DATABASE_URL`):

```
git pull
npm ci
npm run deploy
npm start -w @here-there/api
```

`npm run deploy` builds everything (the database client, the API, and the website: the web app and the admin console), creates the database tables, and adds the first admin and sample data only if the database is empty. The API serves the website itself: the app at `/`, the admin console at `/admin/`, the API at `/v1`. Point your web server at the API's port and it is all live at the server's own address, on any domain, with no files to copy. A real launch needs more (keys, real providers): `deployment/FOR_DEPLOYMENT.md`.

## Tests

```
cd backend/api
npm test
```

This builds the project and runs every test file (340 tests at the last full run, 9 November 2026). The full suite takes about two minutes on a laptop, so run it in the background and send its output to a file. Run a single file with `node --test dist/test/<name>.test.js`. Each test file gets its own throwaway PostgreSQL schema (`test_<name>`, in the database named by `TEST_DATABASE_URL`, or `DATABASE_URL` if that is not set) and drops it when done, so files can run side by side and your data is never touched. Do not run two full suites at the same time.

Type-check the other apps with `npx tsc --noEmit` inside `frontend/mobile` or `frontend/admin`.

## API documentation

`npm run docs` in `backend/api` writes three files from the live code, and they always move together:

- `docs/openapi.json`: the OpenAPI 3.1 document (for Postman, Swagger and code generators). The running API also serves it at `GET /v1/openapi.json`.
- `docs/API.md`: the same document as readable Markdown (every route, its fields, its responses and the error codes). Do not edit it by hand.
- `docs/ERROR-CODES.md`: every error code, what it means and what the app should do.

When you add or change a route, a field or an error code, update `src/docs/routes.ts` (or `src/docs/error-guide.ts`) and run `npm run docs`. A test fails if the files are out of date.

## More documents

| File | Read it for |
|---|---|
| `deployment/BUILDS.md` | Phone builds (Main and Dev apps), GitHub Actions, TestFlight and over-the-air updates, Firebase push files. |
| `deployment/FOR_DEPLOYMENT.md` | Everything needed to go live: settings, keys, outside services, limits, what will not survive many users, a final checklist. |
| `docs/DESIGN.md` | The Figma design in the app: where the design is (a PDF export), which design page is which screen and file, the rules followed, what was left out and what is still unfinished (parts of THERE). |
| `docs/LOAD_TEST.md` | The load test: how to seed a throw-away database and run thousands of simulated phones against a test server, and the first results (2 Nov 2026). |
| `docs/POSTGRES_MOVE.md` | The move from SQLite to Postgres: what was done on 2026-11-02, what it found, what is still open, and how to set up your own database. |
| `handover/PROJECT-HANDOVER.md` | What is built, what is open, how to run and test, the owner's working rules. |
| `docs/compliance/` | Drafts for the privacy notice, terms, data inventory, DPIA and retention schedule. They need a lawyer's review. |
| `handover/WORKFLOW.md` | How the app works end to end: feed ranking, paging, joining, reliability, safety. |

Some of these files are kept private and are listed in `.gitignore`.

## Where it stands

It is a solid prototype for a pilot (one district, hundreds of people). Load tests (`docs/LOAD_TEST.md`): chat with 2,000 simulated phones passed (2 Nov 2026); the full app at 5,000 phones on one laptop slowed down (3 Nov 2026), so launch needs several API processes. Before thousands of users it needs Postgres, a shared store such as Redis for live connections and rate limits, more than one API server, cloud storage for photos, real push notifications and a real identity provider. The order of that work is in `deployment/FOR_DEPLOYMENT.md`.

Outside services that are still simulated in development: email and SMS sending, the identity provider (Persona works in its sandbox, iDenfy is built but untried with real keys), map keys, phone push (built on Firebase, not yet proven on a real phone), and Apple and Google sign-in.
