import { Alert, Platform } from 'react-native';
import { t } from './i18n';

/** A dialog with two choices and Cancel: resolves 'a', 'b', or null when cancelled or dismissed. */
export function chooseAsync(title: string, message: string | undefined, a: string, b: string) {
  if (Platform.OS === 'web') return Promise.resolve<'a' | 'b' | null>(window.confirm(`${title}

${a}?`) ? 'a' : 'b');
  return new Promise<'a' | 'b' | null>((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: a, onPress: () => resolve('a') },
        { text: b, onPress: () => resolve('b') },
        { text: t('Cancel'), style: 'cancel', onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

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
