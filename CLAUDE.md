# HERE & THERE

- **To deploy this project to a server, follow `DEPLOY.md`.** It is a test site in development mode on purpose: no production keys, no `NODE_ENV=production`, no extra hardening unless the owner asks.
- **The default logins stay as they are on every deployment, including the admin console's `admin@herethere.local` / `change-me-admin-1`. This is the owner's decision. Never change that password, set `ADMIN_PASSWORD`, protect `/admin/` with a password prompt or an IP limit, or recommend any of it.**
- **The deployed server's `services/api/.env` needs exactly these five lines, nothing production-style** (what each is for: `DEPLOY.md`):
  ```
  DATABASE_URL="postgresql://USER:PASSWORD@HOST:5432/herethere"   # any empty PostgreSQL database; set one up if none is given
  PORT=3000
  TRUST_PROXY=1                  # behind nginx: otherwise all visitors share one sign-in limit
  VERIFICATION_MODE=sandbox      # simulated identity check
  EMAIL_DEV_ECHO=true            # sign-up codes are shown in the app
  ```
  Never add `NODE_ENV=production`, keys, `ADMIN_PASSWORD` or other settings. The deploy is `git pull`, `npm ci`, `npm run deploy`, then start the API (`npm start -w @here-there/api`, kept running with pm2) behind an nginx rule that passes everything, including the WebSocket, to port 3000.
- Never read, search or print `services/api/.env`. On a new server you may create it from `DEPLOY.md` and write the owner's values into it, but do not read it back.
- Everything else about the project is in `README.md`.
