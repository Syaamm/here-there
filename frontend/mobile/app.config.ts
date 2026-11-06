import type { ConfigContext, ExpoConfig } from 'expo/config';

// (this file runs in Node when Expo reads the settings; the project has no Node type package, so the two helpers are typed by hand)
const { existsSync } = require('fs') as { existsSync(p: string): boolean };
const path = require('path') as { resolve(...parts: string[]): string };

/**
 * One app, two products: HERE and THERE are modes inside this binary ("HERE & THERE").
 *
 * IDs below are placeholders. Replace `io.herethere.app` with an identifier your company owns
 * BEFORE the first store build. Store listings are tied to it permanently.
 */
// ONE app id for every build (development, preview, production): same Firebase app, same keystore, same signing SHA-1.
// APP_ENV only switches behaviour (cleartext HTTP, code shrinking), never the id or name.
const APP_ID = 'io.herethere.app';
const isProd = process.env.APP_ENV === 'production';
// The domain whose shared links (/a/<id>, /t/<id>) open the app straight from a message. Set it for store builds; it also
// needs the two files the API serves under /.well-known (see deployment/FOR_DEPLOYMENT.md).
const SHARE_DOMAIN = process.env.SHARE_DOMAIN?.trim();

// Map keys are optional in development (Expo Go has its own). Standalone Android builds need one.
const mapKeys = {
  androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
  iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
};
const hasMapKeys = Object.values(mapKeys).some(Boolean);

// Phone push goes through Firebase (FCM) on both iPhone and Android. Each platform needs the file Firebase gives for the app
// (Firebase console > Project settings > Your apps). Put them next to this file, or point GOOGLE_SERVICES_JSON /
// GOOGLE_SERVICES_PLIST at them (on EAS: a file secret). Without a file that platform is built without Firebase, as before.
const androidFirebase = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
const iosFirebase = process.env.GOOGLE_SERVICES_PLIST ?? './GoogleService-Info.plist';
// The Android build fails if google-services.json has no entry for the app's package, so the Firebase file is only used when it
// lists this build's package.
const hasAndroidPackage = (file: string, pkg: string): boolean => {
  try {
    const json = JSON.parse(require('fs').readFileSync(path.resolve(process.cwd(), file), 'utf8'));
    return (json.client ?? []).some((c: any) => c?.client_info?.android_client_info?.package_name === pkg);
  } catch {
    return false;
  }
};
const hasAndroidFirebase = existsSync(path.resolve(process.cwd(), androidFirebase)) && hasAndroidPackage(androidFirebase, APP_ID);
const hasIosFirebase = existsSync(path.resolve(process.cwd(), iosFirebase));
const hasFirebase = hasAndroidFirebase || hasIosFirebase;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HERE & THERE',
  slug: 'here-there',
  owner: 'cloudhouse-production',
  scheme: 'herethere',
  version: '0.1.0',
  // Raise runtimeVersion whenever native code changes (new library, permission, icon, push setup). A code-only change is sent as an
  // update (OTA) to builds with the same runtimeVersion. The app asks first (see components/UpdatePrompt), so checkAutomatically is off.
  runtimeVersion: '1',
  updates: {
    url: `https://u.expo.dev/${process.env.EAS_PROJECT_ID ?? '4005c1f6-33e1-4757-b262-cfa7643b5b9b'}`,
    checkAutomatically: 'NEVER',
    fallbackToCacheTimeout: 0,
  },
  // iPads and tablets are used in both orientations, so rotation is allowed. Screens adapt (see src/lib/layout.ts).
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  // Browser preview of the same app (npm run mobile, then open http://localhost:8082)
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  ios: {
    bundleIdentifier: APP_ID,
    ...(hasIosFirebase ? { googleServicesFile: iosFirebase } : {}),
    supportsTablet: true, // runs natively on iPad (not as a stretched iPhone app)
    ...(SHARE_DOMAIN ? { associatedDomains: [`applinks:${SHARE_DOMAIN}`] } : {}),
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      UIBackgroundModes: ['remote-notification'], // push while the app is in the background or closed
      // Development only: lets the app talk to the API on your computer over the local network.
      // Production traffic must be HTTPS, so this stays off in production builds.
      ...(isProd ? {} : { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }),
    },
  },
  android: {
    package: APP_ID,
    permissions: ['android.permission.POST_NOTIFICATIONS', 'android.permission.VIBRATE', 'android.permission.RECEIVE_BOOT_COMPLETED'],
    ...(hasAndroidFirebase ? { googleServicesFile: androidFirebase } : {}),
    adaptiveIcon: {
      backgroundColor: '#102F29',
      foregroundImage: './assets/android-icon-foreground.png',
      backgroundImage: './assets/android-icon-background.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    predictiveBackGestureEnabled: false,
    ...(SHARE_DOMAIN
      ? {
          intentFilters: [
            {
              action: 'VIEW',
              autoVerify: true,
              data: [
                { scheme: 'https', host: SHARE_DOMAIN, pathPrefix: '/a/' },
                { scheme: 'https', host: SHARE_DOMAIN, pathPrefix: '/t/' },
              ],
              category: ['BROWSABLE', 'DEFAULT'],
            },
          ],
        }
      : {}),
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // Listed before expo-notifications on purpose: Expo runs the manifest changes of the last plugin first, so this one must come
    // first in the list to run after expo-notifications has added the entry it patches.
    './plugins/with-notification-color-override.js',
    ['expo-notifications', { color: '#102F29' }],
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'HERE & THERE uses your approximate location only when you tap "Near me", to show activities close to you. It is never shared with other people.',
      },
    ],
    // Plain HTTP to a dev machine is blocked on Android by default. Allowed only outside production.
    // The home-screen icon can be switched to THERE in Settings (HERE is the default icon). Needs an installed build.
    [
      'expo-alternate-app-icons',
      [
        {
          name: 'There',
          ios: './assets/icons/there/icon.png',
          android: { foregroundImage: './assets/icons/there/android-icon-foreground.png', backgroundColor: '#0B3226' },
        },
      ],
    ],
    // Release builds only: R8 code shrinking + unused-resource removal (smaller APK/AAB, less memory for dex). Revert by deleting the two flags if a release build crashes on a missing class.
    ['expo-build-properties', { android: { usesCleartextTraffic: !isProd, ...(isProd ? { enableMinifyInReleaseBuilds: true, enableShrinkResourcesInReleaseBuilds: true } : {}) }, ...(hasIosFirebase ? { ios: { useFrameworks: 'dynamic' } } : {}) }],
    ...(hasFirebase ? ([['@react-native-firebase/app']] as NonNullable<ExpoConfig['plugins']>) : []),
    ...(hasMapKeys ? ([['react-native-maps', mapKeys]] as NonNullable<ExpoConfig['plugins']>) : []),
  ],
  extra: {
    // The Expo (EAS) project for cloud builds, from `eas init` (@syammns/here-there). The id is not a secret.
    // EAS_PROJECT_ID overrides it, e.g. for a different Expo account.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? '4005c1f6-33e1-4757-b262-cfa7643b5b9b' },
  },
});
