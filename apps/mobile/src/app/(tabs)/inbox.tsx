import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { Inbox } from '@/features/Inbox';
import { useMe } from '@/lib/auth';

export default function InboxTab() {
  const { isGuest } = useMe();
  if (isGuest)
    return (
      <Screen tabBar header={<TabHeader />}>
        <GuestWall title="Your inbox">Create a free account to get join decisions, plan changes and group chats here.</GuestWall>
      </Screen>
    );
  return <Inbox />;
}
