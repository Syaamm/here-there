import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { Inbox } from '@/features/Inbox';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function InboxTab() {
  const { isGuest } = useMe();
  const { t } = useT();
  if (isGuest)
    return (
      <Screen tabBar header={<TabHeader />}>
        <GuestWall title={t('Your inbox')}>{t('Create a free account to get join decisions, plan changes and group chats here.')}</GuestWall>
      </Screen>
    );
  return <Inbox />;
}
