// Android only. A release APK holds native code for every processor type it lists. Real phones use only the two ARM types
// (arm64-v8a, and armeabi-v7a on older ones); x86 / x86_64 are for PC emulators. Leaving those out makes the APK roughly
// 40% smaller. Used for production and preview builds only (see app.config.ts); development builds keep all four so
// emulators still work. iPhone builds are not affected.
const { withGradleProperties } = require('expo/config-plugins');

const KEY = 'reactNativeArchitectures';
const PHONES = 'armeabi-v7a,arm64-v8a';

module.exports = function withPhoneAbis(config) {
  return withGradleProperties(config, (cfg) => {
    cfg.modResults = cfg.modResults.filter((p) => !(p.type === 'property' && p.key === KEY));
    cfg.modResults.push({ type: 'property', key: KEY, value: PHONES });
    return cfg;
  });
};
