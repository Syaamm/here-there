import type { ReactNode } from 'react';
import { Banner, Btn, Card, Txt, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/** Shown instead of a screen that needs an account. Guests ("Explore demo") can only look around. */
export function GuestWall({ title, children }: { title: string; children: ReactNode }) {
  const { logout } = useMe();
  const go = useGo();
  const { t, tn } = useT();
  return (
    <Card style={{ gap: 12 }}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="muted">{children}</Txt>
      <Btn title={t('Create a free account')} onPress={() => logout()} />
      <Btn title={t('Keep exploring')} variant="secondary" onPress={() => go('/')} />
    </Card>
  );
}

export function GuestBanner() {
  const { logout } = useMe();
  const { t } = useT();
  return <Banner onPress={() => logout()}>{t("Exploring as a guest. Create account ›")}</Banner>;
}
