# HERE & THERE

- **To deploy this project to a server, follow `deployment/DEPLOY.md`.** It is a test site in development mode on purpose: no production keys, no `NODE_ENV=production`, no extra hardening unless the owner asks.
- **The default logins stay as they are on every deployment, including the admin console's `admin@herethere.local` / `change-me-admin-1`. This is the owner's decision. Never change that password, set `ADMIN_PASSWORD`, protect `/admin/` with a password prompt or an IP limit, or recommend any of it.**
- **The deployed server's `backend/api/.env` needs exactly these five lines, nothing production-style** (what each is for: `deployment/DEPLOY.md`):
  ```
  DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/herethere"   # any empty PostgreSQL database; set one up if none is given
  PORT=3000
  TRUST_PROXY=1                  # behind nginx: otherwise all visitors share one sign-in limit
  VERIFICATION_MODE=sandbox      # simulated identity check
  EMAIL_DEV_ECHO=true            # sign-up codes are shown in the app
  ```
  Never add `NODE_ENV=production`, keys, `ADMIN_PASSWORD` or other settings. **One exception, the owner's decision (2026-11-11): the live server also has a `FIREBASE_SERVICE_ACCOUNT_FILE` (or `_JSON`) line for phone push. Never remove or rename it, never recreate `.env` without it, and never rename that setting in the code (`backend/api/src/common/fcm.ts`). After a deploy, Settings > "Send a test push" must still show the Firebase project.** The deploy is `git pull`, `npm ci`, `npm run deploy`, then start the API (`npm start -w @here-there/api`, kept running with pm2) behind an nginx rule that passes everything, including the WebSocket, to port 3000.
- Never read, search or print `backend/api/.env`. On a new server you may create it from `deployment/DEPLOY.md` and write the owner's values into it, but do not read it back.
- **Before every phone app build or over-the-air update, raise the app version.** It lives in one place only: `"version"` in `frontend/mobile/package.json` (`app.config.ts` reads it from there). Raise the last number by one per build (`0.1.0` → `0.1.1` → `0.1.2`); raise the middle number (`0.2.0`) only when the owner calls it a feature release. Commit the bump on its own ("Bump app version to x.y.z") before running the build. The store build numbers (Android versionCode, iPhone build number) go up by themselves on EAS (`autoIncrement`, `appVersionSource: remote`): never set them by hand. A native change (new library, permission, icon, push setup, Expo SDK) also needs `runtimeVersion` raised in `app.config.ts`. How to run builds: `deployment/BUILDS.md`.
- Everything else about the project is in `README.md`.
