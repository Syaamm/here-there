import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import { appAlert } from '@/components/AppDialog';
import { Text } from '@/components/ScaledText';
import { ErrorBanner, pressed } from '@/components/ui';
import { ApiError, post } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { BTN } from '@/lib/buttons';
import { tap } from '@/lib/haptics';
import { useAction } from '@/lib/hooks';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { appleToken, availableProviders, googleToken, type SocialProvider, type SocialToken } from '@/lib/social';
import { useTheme } from '@/lib/theme';

/** Asks the one question a brand-new account needs: are you 18 or older? Resolves true on "Yes". */
const askAdult = (t: (s: string) => string) =>
  new Promise<boolean>((done) => {
    appAlert(t('Create your account'), t('To create an account you must be 18 or older. Are you?'), [
      { text: t('Cancel'), style: 'cancel', onPress: () => done(false) },
      { text: t('I am 18 or older'), onPress: () => done(true) },
    ], { cancelable: true, onDismiss: () => done(false) });
  });

/**
 * "Continue with Apple" and "Continue with Google", under the email form of the login and sign-up pages. Only the ones the API has
 * switched on (and this phone can do) are shown; with none, nothing is drawn. `adultConfirmed` is the sign-up page's 18+ tick box:
 * given there, a new account is made straight away; on the login page a new person is asked once.
 */
export function SocialButtons({ adultConfirmed }: { adultConfirmed?: boolean }) {
  const { t } = useT();
  const { c } = useTheme();
  const { signIn } = useMe();
  const act = useAction();
  const [on, setOn] = useState<Record<SocialProvider, boolean> | null>(null);
  const [Apple, setApple] = useState<typeof import('expo-apple-authentication') | null>(null);

  useEffect(() => {
    let live = true;
    // TEMPORARY layout preview (remove before a build): EXPO_PUBLIC_PREVIEW_SOCIAL=1 forces both buttons on
    const preview = process.env.EXPO_PUBLIC_PREVIEW_SOCIAL === '1' && Platform.OS !== 'web';
    (preview ? Promise.resolve({ apple: Platform.OS === 'ios', google: true }) : availableProviders()).then((p) => {
      if (!live) return;
      setOn(p);
      if (p.apple) {
        try {
          setApple(require('expo-apple-authentication') as typeof import('expo-apple-authentication'));
        } catch {}
      }
    });
    return () => {
      live = false;
    };
  }, []);

  const go = (provider: SocialProvider) =>
    act.run(async () => {
      if (process.env.EXPO_PUBLIC_PREVIEW_SOCIAL === '1') {
        appAlert('Preview only', 'Layout preview. Signing in needs the new build.');
        return;
      }
      const got: SocialToken | null = provider === 'apple' ? await appleToken() : await googleToken();
      if (!got) return; // the person closed the sheet: not an error
      let adult = adultConfirmed === true;
      for (;;) {
        try {
          const r = await post<{ token: string; refreshToken?: string; created?: boolean }>('/v1/auth/social', {
            provider,
            idToken: got.idToken,
            ...(adult ? { adultConfirmed: true } : {}),
            ...(got.name ? { displayName: got.name } : {}),
          });
          await signIn({ token: r.token, refreshToken: r.refreshToken }, { fresh: r.created === true }); // a new account goes through onboarding once
          return;
        } catch (e) {
          if (e instanceof ApiError && e.code === 'ADULT_CONFIRMATION_REQUIRED' && !adult) {
            if (!(await askAdult(t))) return;
            adult = true; // ask again with the same token, it is still good for a few minutes
            continue;
          }
          throw e;
        }
      }
    });

  if (!on || (!on.apple && !on.google)) return null;
  return (
    <View style={{ gap: sp(14) }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10) }}>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
        <Text style={{ color: c.muted, fontSize: 12 }}>{t('or')}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      </View>
      <ErrorBanner message={act.error} />
      {on.apple && Apple && Platform.OS === 'ios' ? (
        // Apple's own button: its guidelines require the official look (its text size follows the button height and can't be set)
        <Apple.AppleAuthenticationButton
          buttonType={Apple.AppleAuthenticationButtonType.CONTINUE}
          buttonStyle={Apple.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={BTN.radiusSmall}
          style={{ height: sc(BTN.small), width: '100%', opacity: act.busy ? 0.5 : 1 }}
          onPress={() => {
            if (!act.busy) go('apple');
          }}
        />
      ) : null}
      {on.google ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Continue with Google')}
          accessibilityState={{ disabled: act.busy, busy: act.busy }}
          disabled={act.busy}
          onPress={() => {
            tap('Medium');
            go('google');
          }}
          style={({ pressed: p }) => [{ minHeight: sc(BTN.small), borderRadius: BTN.radiusSmall, borderWidth: 1, borderColor: c.line, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: sp(10), paddingHorizontal: sph(20), opacity: act.busy ? 0.5 : 1 }, !act.busy && pressed(p)]}
        >
          <Ionicons name="logo-google" size={sc(17)} color="#1F1F1F" />
          <Text numberOfLines={1} style={{ color: '#1F1F1F', ...BTN.text }}>{t('Continue with Google')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
