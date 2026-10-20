import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { Profile } from '@/features/Profile';
import { useMe } from '@/lib/auth';

export default function ProfileTab() {
  const { isGuest } = useMe();
  if (isGuest)
    return (
      <Screen tabBar header={<TabHeader subtitle="Exploring as a guest" />}>
        <GuestWall title="You're exploring as a guest">Create a free account to get a profile, join activities and trips, host your own and chat with the group.</GuestWall>
      </Screen>
    );
  return <Profile />;
}
