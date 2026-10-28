import { GuestBanner } from '@/components/GuestWall';
import { Banner, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';

const TEXT: Record<string, string> = {
  pending: 'Your identity check is in review.',
  expired: 'Your verification has expired.',
  reverification_required: 'Please verify your identity again.',
  rejected: 'Your last check was not approved.',
};

/** The one-line nudge at the top of Explore. Browsing is always free; this only explains what verification unlocks. */
export function VerifyBanner() {
  const { me, isGuest } = useMe();
  const go = useGo();
  const { t } = useT();
  if (!me) return null;
  if (isGuest) return <GuestBanner />;
  if (me.eligibility === 'verified') return null;
  return <Banner onPress={() => go('/verify')}>{t(TEXT[me.eligibility] ?? 'Verify your identity to join, host and chat.')} {t('Details ›')}</Banner>;
}
