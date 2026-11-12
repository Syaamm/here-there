# Phone builds (GitHub Actions + updates)

**ONE app for every build (changed 2026-11-06):** `LAMIS`, id `io.herethere.app` (Android package and iOS bundle). There is no `.dev` app any more: one Firebase app per platform, one keystore, one signing SHA-1. Development, preview and production builds all use this id; they differ only in the EAS profile.

| EAS profile | Use |
|---|---|
| `development` | dev client, code loads live from the PC (`npx expo start --dev-client --tunnel`); Android APK |
| `preview` | internal test build against the live site, channel `preview`; Android APK |
| `production` | the release build, channel `production` |
| `development-testflight` / `production-testflight` | iPhone builds sent to TestFlight |

Because the id is the same, only ONE of these builds can be installed on a phone at a time (a new one replaces the old one, uninstall first if the signing differs).

Config: `frontend/mobile/eas.json`, `frontend/mobile/app.config.ts` (`APP_ENV` only switches cleartext HTTP and code shrinking, never the id), workflow `.github/workflows/mobile.yml`.

## One-time setup (owner)
1. **Firebase** (project **`mobile-app-build-513904`**, since 2026-11-09; it replaced the old personal project `dev-lamis`, which is no longer used). Firebase apps: Android `io.herethere.app` and iOS `io.herethere.app`. Two files in `frontend/mobile/` (committed, not secret; the GitHub build needs them):
   - `google-services.json`: Android (`io.herethere.app`).
   - `GoogleService-Info.plist`: iOS (`io.herethere.app`).
   Without the right entry/file the app is built without Firebase push.
   **Keep both files out of git** (they hold Google API keys): on a computer put them in `frontend/mobile/secrets/` (git-ignored; `app.config.ts` reads them there first); on EAS add each as a **file** environment variable, `GOOGLE_SERVICES_JSON` and `GOOGLE_SERVICES_PLIST`. The Google Maps keys are read from `GOOGLE_MAPS_ANDROID_KEY` / `GOOGLE_MAPS_IOS_KEY` the same way (never written in the code).
   Expo's own credentials page (FCM V1 key, Push Key) stays EMPTY: it is only for Expo's push service, we send through Firebase directly.
2. **Apple push key (APNs, .p8)**: upload it in Firebase > Project settings > Cloud Messaging > each iOS app.
3. **Firebase service-account key** of `mobile-app-build-513904` (server sends with it): secret, server only, never commit. A key from any other project (e.g. the old `dev-lamis`) is refused with `SENDER_ID_MISMATCH` in the API log.
4. **App Store Connect**: create both apps, copy each Apple ID into `eas.json` > `submit` (replace the two `REPLACE_WITH_...`).
5. **EAS credentials** (once; the id is always `io.herethere.app`):
   `cd frontend/mobile` then `npx eas credentials -p ios` and `npx eas credentials -p android`. Android: ONE keystore, created 2026-11-06 under profile `production`, SHA-1 `62:F5:2E:42:32:B6:2E:C7:61:AD:1C:3C:B7:69:61:2B:64:39:0A:A9`. All Android profiles share it (credentials belong to the app id, not the profile). Download a backup copy (Keystore > Download existing keystore).
6. **GitHub**: repo secrets `EXPO_TOKEN` (expo.dev robot, role Developer) and `RELEASES_TOKEN` (fine-grained, Contents read/write on the releases repo). Create the public releases repo and put its name in `mobile.yml` (`RELEASES_REPO`).
7. **expo.dev** > project > Environment variables > `production`: the app's `EXPO_PUBLIC_*` values (API URL etc.).

## Each build
Run: GitHub > Actions > Mobile build > Run workflow (action, platform, profile).

| Change | Do |
|---|---|
| JS/TS code, screens, text, images | `action = ota-update`. Raise `version` in `frontend/mobile/package.json` first (last number +1, see CLAUDE.md). Users see "Update available" in the app. |
| Any `action = build` | Raise `version` in `frontend/mobile/package.json` first (last number +1, see CLAUDE.md) and commit it. Build numbers go up by themselves. |
| New native library, permission, icon, push setup, Expo SDK upgrade | `action = build`. Also raise `runtimeVersion` in `app.config.ts`. |
| iPhone TestFlight build near 90 days old | new iOS build |
| Development build | rebuild only after native changes; daily work: `npx expo start --dev-client --tunnel` |

After the first iOS build: App Store Connect > TestFlight > add testers (Internal, then External with a public link).

## Live site: push, maps, shared links (live site `https://here-there.susmitha.site`)
The production build already points at the live site (`eas.json` > `production` > `env`: `EXPO_PUBLIC_API_URL`, `SHARE_DOMAIN`, `EXPO_PUBLIC_SHARE_URL`).

**Server settings to add** to `backend/api/.env` (the owner approves these; they go beyond the original five lines). Never paste the key itself into a chat:
```
FIREBASE_SERVICE_ACCOUNT_FILE=/home/<user>/secrets/firebase-adminsdk.json   # phone push (Firebase > Project settings > Service accounts > Generate new private key; file stays on the server, outside git)
APPLE_TEAM_ID=N7X7Q2H8V8                                                    # shared links open the app on iPhone
```
Later, when the app is in the stores: `APP_STORE_URL`, `PLAY_STORE_URL`, `ANDROID_CERT_SHA256`. Restart the API (pm2) after changing `.env`.

**Order matters:** put the server settings live first, then install the build (Apple reads `/.well-known/apple-app-site-association` when the app is installed). Check it: `https://here-there.susmitha.site/.well-known/apple-app-site-association` shows JSON, no redirect.

**Push also needs** the Apple push key (.p8, APNs) uploaded in Firebase for the iOS app. No rebuild needed after adding it.

**Maps:** iPhone uses Apple Maps, no key. Android needs `GOOGLE_MAPS_ANDROID_KEY` set for the Android build; without it the Android app crashes when the map page opens ("API key not found", seen 2026-11-06). The key must come from the company's Google Cloud project (see "Move Firebase and Maps to the company" below).

## Development build, step by step
The development build is a dev client with the same id as production: code loads from the PC. Profiles: Android `development`, iPhone `development-testflight`. Build on EAS cloud with `$env:EAS_NO_VCS = "1"` (uploads the whole folder, so uncommitted files are included; a git build would only send committed files).
1. Credentials: already set (see step 5 above); iPhone with the App Store Connect API key variables (see the iOS memory/guide).
2. Build: `npx eas build -p android --profile development` and `npx eas build -p ios --profile development-testflight`, then `npx eas submit -p ios --profile development-testflight`. iPhone now needs the ONE app's Apple ID in `eas.json` > `submit` (the `ascAppId` there was made for the old `.dev` app: replace it with the Apple ID of the `io.herethere.app` app).
3. Run against the live site: `$env:EXPO_PUBLIC_API_URL = "https://here-there.susmitha.site"` then `npx expo start --dev-client --tunnel` (a dev client reads this from the PC, not from the cloud build).
4. Push needs: Apple APNs key (.p8, different from the App Store Connect API key) in Firebase > Cloud Messaging for both iOS apps with team id N7X7Q2H8V8; Firebase service-account key of `mobile-app-build-513904` on the server with `FIREBASE_SERVICE_ACCOUNT_FILE`. Android needs nothing more. Android maps need `GOOGLE_MAPS_ANDROID_KEY`.

## Move Firebase and Maps to the company (do once, before real users)
**Status 2026-11-09:** Firebase moved from the personal `dev-lamis` to `mobile-app-build-513904`; the two app files in `frontend/mobile/` are the new project's (steps 1 to 3 done). The Firebase files are baked into the builds, so only builds made after the switch use the new project; older builds keep talking to `dev-lamis` and get no push.

**Why:** Expo, Apple and the builds belong to the company, so Firebase and the Google Maps bill must too.

**You need first:** a company Google account with owner rights, and a Google Cloud billing account (Maps needs billing switched on, even inside Google's free monthly credit).

1. [x] **Create the Firebase project** in the company Google account (the free Spark plan is enough for push). Name it for the company, not "dev".
2. [x] **Add two apps** to it: Android `io.herethere.app` and iOS `io.herethere.app`. Both in this ONE project: the server can use only one project's service-account key.
3. [x] **Replace the two files in `frontend/mobile/`** with the new ones, then commit and push (the GitHub build needs them; they are not secret):
   - `google-services.json`: Android (`io.herethere.app`).
   - `GoogleService-Info.plist`: iOS (`io.herethere.app`).
4. [ ] **Upload the Apple push key** (APNs `.p8`, Key ID `CVHH4LBXUC`, Team ID `N7X7Q2H8V8`: check the Team ID in the Apple Developer portal, Membership) in Firebase > Project settings > Cloud Messaging > Apple app configuration, for the iOS app, in BOTH the development and the production slot. Leave "APNs Certificates" empty.
5. [ ] **New Firebase service-account key** for the server: Firebase > Project settings > Service accounts > Generate new private key. Put the file on the server outside git, set `FIREBASE_SERVICE_ACCOUNT_FILE` in `backend/api/.env` to its path, restart the API (pm2). Secret: never commit it or paste it into a chat.
6. [ ] **Google Maps key (Android) in the company's Google Cloud project** (it does not have to be the Firebase project, only company-owned with billing on): enable **Maps SDK for Android**, then APIs & Services > Credentials > Create credentials > API key.
   - Restrict it: Application restrictions > Android apps, add `io.herethere.app` with its signing SHA-1 (`cd frontend/mobile` then `npx eas credentials -p android`; once the app is in Google Play, also the Play App Signing SHA-1). API restrictions > Maps SDK for Android only.
   - Put the key in as `GOOGLE_MAPS_ANDROID_KEY` for the Android build (as an EAS environment variable, never in `eas.json`, which is in git: `npx eas env:create --name GOOGLE_MAPS_ANDROID_KEY --value "<key>" --environment production`, same for `preview` and `development`). The key ends up inside the app, so restrict it in Google Cloud to the Android package + SHA-1 and to the Maps SDK only. iPhone needs nothing: Apple Maps.
7. [ ] **Rebuild once.** Raise `version` (in `frontend/mobile/package.json`) and `runtimeVersion` (in `app.config.ts`), then build both platforms (see "Each build"). An over-the-air update cannot carry these changes.
8. [ ] **Test on real phones**, Android and iPhone, both apps: a push notification arrives, and the Android map page opens without crashing and shows tiles (grey tiles with a key = the SHA-1 restriction does not match the build).
9. [ ] **Clean up** once every tester is on the new builds: delete the service-account key and the old project `dev-lamis` in the personal account, and remove the personal account's access to anything the company uses.
