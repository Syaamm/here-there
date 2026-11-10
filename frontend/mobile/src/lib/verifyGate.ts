import { useRouter } from 'expo-router';
import { useMe } from './auth';
import { useT } from './i18n';

/** What a not-yet-verified person tried to do: it picks the line of the button. */
export type Gated = 'join' | 'publish' | 'edit' | 'travel';

/**
 * Everyone can look at the whole app, guests ("Explore the demo") included. Only a few things need a verified account: joining or
 * asking to join an activity or a trip, publishing one, editing your profile (guests) and Travel buddies. Those buttons stay where
 * they are. For a guest they say "Sign up to ..." and tapping one ends the demo and opens the sign-up page; for a signed-up person
 * who is not verified yet they say "Get verified to ..." and tapping one opens the identity verification page.
 */
export function useVerifyGate() {
  const { me, isGuest, logout } = useMe();
  const { t } = useT();
  const router = useRouter();
  const verified = !isGuest && me?.eligibility === 'verified';

  const TITLE: Record<Gated, string> = isGuest
    ? {
        join: t('Sign up to join'),
        publish: t('Sign up to publish'),
        edit: t('Sign up to edit your profile'),
        travel: t('Sign up to use Travel buddies'),
      }
    : {
        join: t('Get verified to join'),
        publish: t('Get verified to publish'),
        edit: t('Get verified to edit your profile'),
        travel: t('Get verified to use Travel buddies'),
      };

  const ask = async (_what: Gated) => {
    if (isGuest) {
      // the demo ends here: the guest session is closed (the welcome page is under it, so Back returns there) and sign-up opens
      logout();
      setTimeout(() => router.push('/register' as never), 150);
      return;
    }
    router.push('/verify' as never);
  };

  return { verified, isGuest, ask, title: (what: Gated) => TITLE[what] };
}
