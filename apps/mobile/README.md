# HERE & THERE: mobile app (iOS + Android)

One Expo / React Native codebase, one app. HERE (activities happening now) and THERE (group trips)
are two modes inside it. Switch with the HERE | THERE toggle at the top of any main tab.

Both modes share the same five tabs (Explore, Map or Search, Create, Inbox, Profile), the same
account, identity verification, blocking, reports and chat. The API is `services/api`.

## Run it on your phone (fastest)

1. Install **Expo Go** on the phone (App Store / Google Play).
2. Phone and computer on the **same Wi-Fi**.
3. Start the API, then the app:
   ```
   cd services/api && npm start          # API on :3000
   cd apps/mobile  && npm start          # Expo on :8082, shows a QR code
   ```
4. Scan the QR code (Camera on iOS, Expo Go on Android).

The app finds the API on your computer by itself (same address as Expo, port 3000).
If it can't connect, Windows Firewall is usually blocking port 3000 or 8082: allow Node.js on
"Private networks" when Windows asks, or set `EXPO_PUBLIC_API_URL=http://<your-pc-ip>:3000` in `.env`.

Sign in with the seeded demo users (`sofia@demo.local` / `demo-password-1`) or register and get
verified from the admin console (`apps/admin`).

## Android emulator / iOS simulator

- Android: install Android Studio, create a virtual device, then `npm run android`.
  The emulator reaches your computer at `10.0.2.2` automatically.
- iOS simulator needs a Mac (`npm run ios`). Windows users test iOS on a real iPhone with Expo Go
  or through an EAS build (below).

## Installable builds (EAS Build, from any computer)

One-time setup (needs a free Expo account):

```
npm install -g eas-cli      # or: npx eas-cli@latest <command>
eas login
cd apps/mobile
eas init                    # creates the project, writes the id into your account
```

Then:

| Goal | Command | Result |
|---|---|---|
| Android APK to install and test | `eas build -p android --profile preview` | `.apk` download link |
| iOS test build (needs Apple Developer account) | `eas build -p ios --profile preview` | ad-hoc build for registered devices |
| Play Store release | `eas build -p android --profile production` | `.aab` bundle |
| App Store release | `eas build -p ios --profile production` | `.ipa`, then `eas submit -p ios` |

Profiles live in `eas.json`. Production builds set `APP_ENV=production`, which turns off the
development-only network allowances (plain HTTP to a local server).

## Before the first real release (checklist)

- [ ] Replace the placeholder app id `io.herethere.app` in `app.config.ts` (iOS bundle id and Android
      package). Store listings are tied to it permanently.
- [ ] Deploy the API on **HTTPS** with PostgreSQL and a real `JWT_SECRET`. Set `EXPO_PUBLIC_API_URL`
      to it. Plain HTTP is blocked in production builds.
- [ ] Google Maps keys for standalone builds: `GOOGLE_MAPS_ANDROID_KEY`, `GOOGLE_MAPS_IOS_KEY`
      (restrict each to the app id). Expo Go works without them.
- [ ] Real app icon, adaptive icon and splash (the files in `assets/` are Expo placeholders).
- [ ] Apple Developer account (99 USD/year) and Google Play Console (25 USD one-time).
- [ ] Privacy policy and terms URLs (both stores require them), data-safety / privacy-label answers.
- [ ] A real identity-verification provider (Persona is built, see `docs/FOR_DEPLOYMENT.md`) and push notifications (see "Not built yet").
- [ ] Shared links: set `SHARE_DOMAIN` (for example `herethere.app`) and `EXPO_PUBLIC_SHARE_URL` for store builds, and publish the two `/.well-known` files from the API so the app opens straight from a link (`docs/FOR_DEPLOYMENT.md`, "Shared links").

## What's inside

```
src/app/            screens (Expo Router: every file is a route)
  (auth)/           welcome, login, register
  (tabs)/           the five tabs; each swaps HERE / THERE content by mode
  activity/ join/ host/     HERE: detail, join request, host review
  trip/ apply/ review/      THERE: detail, application, organizer review
  chat/ safety              shared
src/features/       the HERE and THERE tab screens
src/components/     shared UI kit
src/lib/            API client, auth, theme, hooks
```

## Not built yet

- Push notifications on real devices (the code exists but is untested; Expo Go cannot receive push, and Android needs Firebase in a real build).
- A working live identity provider (Persona is connected but still in sandbox testing).
- Host transfer when a host leaves (a host can only cancel), per-chat mute, trip waiting list and trip reminders, quiet hours.
- Free-text search of activities is still filtered on the phone.
- Deferred deep linking (after installing from a shared link the person taps the link again).
- Maps: only Milan has map data in the pilot; Android needs a Google Maps key.

Built since this list was first written: THERE date polls, shared itinerary and budget notes, travel-buddy matching, the HERE waiting list, appeals, account deletion and export, live chat updates over a WebSocket, drafts, place search, shared links, and server-side paging with chat history loaded on scroll.

## Checks

```
npm run typecheck     # TypeScript
npm run doctor        # Expo project health
```
