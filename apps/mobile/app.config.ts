import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One app, two products: HERE and THERE are modes inside this binary ("HERE & THERE").
 *
 * IDs below are placeholders. Replace `io.herethere.app` with an identifier your company owns
 * BEFORE the first store build. Store listings are tied to it permanently.
 */
const APP_ID = 'io.herethere.app';
const isProd = process.env.APP_ENV === 'production';
// The domain whose shared links (/a/<id>, /t/<id>) open the app straight from a message. Set it for store builds; it also
// needs the two files the API serves under /.well-known (see docs/FOR_DEPLOYMENT.md).
const SHARE_DOMAIN = process.env.SHARE_DOMAIN?.trim();

// Map keys are optional in development (Expo Go has its own). Standalone Android builds need one.
const mapKeys = {
  androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_KEY,
  iosGoogleMapsApiKey: process.env.GOOGLE_MAPS_IOS_KEY,
};
const hasMapKeys = Object.values(mapKeys).some(Boolean);

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'HERE & THERE',
  slug: 'here-there',
  scheme: 'herethere',
  version: '0.1.0',
  // iPads and tablets are used in both orientations, so rotation is allowed. Screens adapt (see src/lib/layout.ts).
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  // Browser preview of the same app (npm run mobile, then open http://localhost:8082)
  web: { bundler: 'metro', output: 'single', favicon: './assets/favicon.png' },
  ios: {
    bundleIdentifier: APP_ID,
    supportsTablet: true, // runs natively on iPad (not as a stretched iPhone app)
    ...(SHARE_DOMAIN ? { associatedDomains: [`applinks:${SHARE_DOMAIN}`] } : {}),
    config: { usesNonExemptEncryption: false },
    infoPlist: {
      // Development only: lets the app talk to the API on your computer over the local network.
      // Production traffic must be HTTPS, so this stays off in production builds.
      ...(isProd ? {} : { NSAppTransportSecurity: { NSAllowsLocalNetworking: true } }),
    },
  },
  android: {
    package: APP_ID,
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
    ['expo-build-properties', { android: { usesCleartextTraffic: !isProd } }],
    ...(hasMapKeys ? ([['react-native-maps', mapKeys]] as NonNullable<ExpoConfig['plugins']>) : []),
  ],
  extra: {
    // The Expo (EAS) project for cloud builds, from `eas init` (@syammns/here-there). The id is not a secret.
    // EAS_PROJECT_ID overrides it, e.g. for a different Expo account.
    eas: { projectId: process.env.EAS_PROJECT_ID ?? 'a1eb28f5-2384-410f-959f-b1876bfedc25' },
  },
});
