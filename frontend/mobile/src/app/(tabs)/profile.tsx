import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { Profile } from '@/features/Profile';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function ProfileTab() {
  const { isGuest } = useMe();
  const { t } = useT();
  if (isGuest)
    return (
      // the same plain header as the Inbox (the HERE | THERE switch), without the coloured band
      <Screen tabBar plain header={<TabHeader plain />}>
        <GuestWall title={t("You're exploring as a guest")}>{t('Create a free account to get a profile, join activities and trips, host your own and chat with the group.')}</GuestWall>
      </Screen>
    );
  return <Profile />;
}
