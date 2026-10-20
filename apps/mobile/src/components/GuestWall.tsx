import type { ReactNode } from 'react';
import { Banner, Btn, Card, Txt, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';

/** Shown instead of a screen that needs an account. Guests ("Explore demo") can only look around. */
export function GuestWall({ title, children }: { title: string; children: ReactNode }) {
  const { logout } = useMe();
  const go = useGo();
  return (
    <Card style={{ gap: 12 }}>
      <Txt variant="h3">{title}</Txt>
      <Txt variant="muted">{children}</Txt>
      <Btn title="Create a free account" onPress={() => logout()} />
      <Btn title="Keep exploring" variant="secondary" onPress={() => go('/')} />
    </Card>
  );
}

export function GuestBanner() {
  const { logout } = useMe();
  return <Banner onPress={() => logout()}>You're exploring as a guest. Create an account to join, host and chat. Create account ›</Banner>;
}
