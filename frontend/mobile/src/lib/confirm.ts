import { Platform } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { t } from './i18n';

// Pop-ups go through appAlert: in the app's own look on Android, the system alert on iPhone (components/AppDialog).

/** A dialog with two choices and Cancel: resolves 'a', 'b', or null when cancelled or dismissed. */
export function chooseAsync(title: string, message: string | undefined, a: string, b: string) {
  if (Platform.OS === 'web') return Promise.resolve<'a' | 'b' | null>(window.confirm(`${title}

${a}?`) ? 'a' : 'b');
  return new Promise<'a' | 'b' | null>((resolve) => {
    appAlert(
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

/** A confirm dialog as a promise. Resolves false when cancelled or dismissed. */
export function confirmAsync(title: string, message?: string, okLabel = t('Confirm'), destructive = false) {
  // the browser preview uses the browser's own dialog
  if (Platform.OS === 'web') return Promise.resolve(window.confirm(message ? `${title}\n\n${message}` : title));
  return new Promise<boolean>((resolve) => {
    appAlert(
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
