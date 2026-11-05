# Phone builds (GitHub Actions + updates)

Two apps on one phone, built on GitHub (no EAS build credits). Push is direct Firebase on both iPhone and Android.

| | Main app | Dev app |
|---|---|---|
| Name | HERE & THERE | HERE & THERE (Dev) |
| Id (Android package / iOS bundle) | `io.herethere.app` | `io.herethere.app.dev` |
| eas.json profile | `production` / `production-testflight` | `development` / `development-testflight` |
| Code comes from | built in, updated by OTA | live from the PC (dev client) |
| Android | APK link from the releases repo | APK from the GitHub run's Artifacts |
| iPhone | TestFlight (public link) | TestFlight, internal testers |

Config: `frontend/mobile/eas.json`, `frontend/mobile/app.config.ts` (`APP_ENV=development` switches to the Dev app), workflow `.github/workflows/mobile.yml`.

## One-time setup (owner)
1. **Firebase**: Android apps `io.herethere.app` and `io.herethere.app.dev`; iOS apps with the same two ids. Put the files in `frontend/mobile/`: `google-services.json` (both Android apps), `GoogleService-Info.plist` (main), `GoogleService-Info.dev.plist` (dev). They are not secret: **commit them** (the GitHub build needs them). Without the `.dev` entries the Dev app is built without Firebase push.
2. **Apple push key (APNs, .p8)**: upload it in Firebase > Project settings > Cloud Messaging > each iOS app.
3. **Firebase service-account key** (server sends with it): secret, server only, never commit.
4. **App Store Connect**: create both apps, copy each Apple ID into `eas.json` > `submit` (replace the two `REPLACE_WITH_...`).
5. **EAS credentials** (once per app; for the Dev app set `$env:APP_ENV = "development"` first and check the id ends in `.dev`):
   `cd frontend/mobile` then `npx eas credentials -p ios` and `npx eas credentials -p android` (profiles `production-testflight` / `development-testflight` for iOS; `production` / `development` for Android). Android also needs a keystore for each.
6. **GitHub**: repo secrets `EXPO_TOKEN` (expo.dev robot, role Developer) and `RELEASES_TOKEN` (fine-grained, Contents read/write on the releases repo). Create the public releases repo and put its name in `mobile.yml` (`RELEASES_REPO`).
7. **expo.dev** > project > Environment variables > `production`: the app's `EXPO_PUBLIC_*` values (API URL etc.).

## Each build
Run: GitHub > Actions > Mobile build > Run workflow (action, platform, profile).

| Change | Do |
|---|---|
| JS/TS code, screens, text, images | `action = ota-update`. Raise `version` first. Users see "Update available" in the app. |
| New native library, permission, icon, push setup, Expo SDK upgrade | `action = build`. Raise `runtimeVersion` in `app.config.ts` and `version`. |
| iPhone TestFlight build near 90 days old | new iOS build |
| Dev app | rebuild only after native changes; daily work: `npx expo start --dev-client --tunnel` |

After the first iOS build: App Store Connect > TestFlight > add testers (Internal, then External with a public link).
