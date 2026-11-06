// Android only. expo-notifications sets the push icon colour (see `color` in app.config.ts) and @react-native-firebase/messaging
// sets its own default for the same manifest entry, so the Android manifest merge fails ("Attribute ... is also present").
// This marks the app's value as the winner (tools:replace), which is what the merge error itself suggests.
const { withAndroidManifest } = require('expo/config-plugins');

const NAME = 'com.google.firebase.messaging.default_notification_color';

module.exports = function withNotificationColorOverride(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults.manifest;
    manifest.$['xmlns:tools'] = manifest.$['xmlns:tools'] || 'http://schemas.android.com/tools';
    const items = manifest.application?.[0]?.['meta-data'] ?? [];
    for (const item of items) {
      if (item.$['android:name'] === NAME) item.$['tools:replace'] = 'android:resource';
    }
    return cfg;
  });
};
