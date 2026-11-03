# HERE & THERE

Two social products in one app, on one shared backend.

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

This builds the project and runs every test file (282 tests at the last full run, 2 November 2026). The full suite takes about two minutes on a laptop, so run it in the background and send its output to a file. Run a single file with `node --test dist/test/<name>.test.js`. Each test file gets its own throwaway PostgreSQL schema (`test_<name>`, in the database named by `TEST_DATABASE_URL`, or `DATABASE_URL` if that is not set) and drops it when done, so files can run side by side and your data is never touched. Do not run two full suites at the same time.

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
| `deployment/FOR_DEPLOYMENT.md` | Everything needed to go live: settings, keys, outside services, limits, what will not survive many users, a final checklist. |
| `docs/DESIGN.md` | The Figma design in the app: where the design is (a PDF export), which design page is which screen and file, the rules followed, what was left out and what is still unfinished (parts of THERE). |
| `docs/LOAD_TEST.md` | The load test: how to seed a throw-away database and run thousands of simulated phones against a test server, and the first results (2 Nov 2026). |
| `docs/POSTGRES_MOVE.md` | The move from SQLite to Postgres: what was done on 2026-11-02, what it found, what is still open, and how to set up your own database. |
| `handover/PROJECT-HANDOVER.md` | What is built, what is open, how to run and test, the owner's working rules. |
| `docs/compliance/` | Drafts for the privacy notice, terms, data inventory, DPIA and retention schedule. They need a lawyer's review. |
| `handover/WORKFLOW.md` | How the app works end to end: feed ranking, paging, joining, reliability, safety. |

Some of these files are kept private and are listed in `.gitignore`.

## Where it stands

It is a solid prototype for a pilot (one district, hundreds of people). Chat has had one load test (2,000 simulated phones, 2 Nov 2026, `docs/LOAD_TEST.md`); the rest of the app has not. Before thousands of users it needs Postgres, a shared store such as Redis for live connections and rate limits, more than one API server, cloud storage for photos, real push notifications and a real identity provider. The order of that work is in `deployment/FOR_DEPLOYMENT.md`.

Outside services that are still simulated in development: email and SMS sending, the identity provider (Persona works in its sandbox, iDenfy is built but untried with real keys), map keys, push notifications, and Apple and Google sign-in.
