import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { Inbox } from '@/features/Inbox';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function InboxTab() {
  const { isGuest } = useMe();
  const { t } = useT();
  const { mode } = useTheme();
  if (isGuest)
    return (
      // the same plain header as the signed-in Inbox (the HERE | THERE switch), without the coloured band
      <Screen tabBar plain header={<TabHeader plain />}>
        <GuestWall title={t('Your inbox')}>{t('Create a free account to get join decisions, plan changes and group chats here.')}</GuestWall>
      </Screen>
    );
  return <Inbox />;
}
