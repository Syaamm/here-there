import { GuestBanner } from '@/components/GuestWall';
import { Banner, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';

const TEXT: Record<string, string> = {
  pending: 'Your identity check is being reviewed. Keep exploring in the meantime.',
  expired: 'Your verification has expired. Verify again to keep joining, hosting and chatting.',
  reverification_required: 'We need you to verify your identity again to keep joining, hosting and chatting.',
  rejected: 'Your last identity check was not approved. You can try again.',
};

/** The one-line nudge at the top of Explore. Browsing is always free; this only explains what verification unlocks. */
export function VerifyBanner() {
  const { me, isGuest } = useMe();
  const go = useGo();
  if (!me) return null;
  if (isGuest) return <GuestBanner />;
  if (me.eligibility === 'verified') return null;
  return <Banner onPress={() => go('/verify')}>{TEXT[me.eligibility] ?? 'You can explore freely. Verify your identity to join, host and chat.'} Details ›</Banner>;
}
