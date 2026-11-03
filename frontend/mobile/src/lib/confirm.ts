import { Alert, Platform } from 'react-native';
import { t } from './i18n';

/** Native confirm dialog as a promise. Resolves false when cancelled or dismissed. */
export function confirmAsync(title: string, message?: string, okLabel = t('Confirm'), destructive = false) {
  // Alert.alert does nothing in a browser, so the web preview uses the browser's own dialog.
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: t('Cancel'), style: 'cancel', onPress: () => resolve(false) },
        { text: okLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}
