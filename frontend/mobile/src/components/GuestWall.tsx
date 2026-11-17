import type { ReactNode } from 'react';
import { Banner, Btn, Card, Txt, useGo } from '@/components/ui';
import { useGuestSignUp } from '@/lib/guestSignUp';
import { useT } from '@/lib/i18n';


import { sc, sp } from '@/lib/scale';
/** Shown instead of a screen that needs an account. Guests ("Explore demo") can only look around. */
export function GuestWall({ title, children }: { title: string; children: ReactNode }) {
  const signUp = useGuestSignUp();
  const go = useGo();
  const { t, tn } = useT();
  return (
    <Card style={{ gap: sp(12) }}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="muted">{children}</Txt>
      <Btn title={t('Create a free account')} onPress={signUp} />
      <Btn title={t('Keep exploring')} variant="secondary" onPress={() => go('/')} />
    </Card>
  );
}

export function GuestBanner() {
  const signUp = useGuestSignUp();
  const { t } = useT();
  return <Banner onPress={signUp}>{t("Exploring as a guest. Create account ›")}</Banner>;
}
