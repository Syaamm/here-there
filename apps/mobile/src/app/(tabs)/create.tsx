import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { CreateActivity } from '@/features/CreateActivity';
import { CreateTrip } from '@/features/CreateTrip';
import { useMe } from '@/lib/auth';
import { useTheme } from '@/lib/theme';

export default function CreateTab() {
  const { mode } = useTheme();
  const { isGuest } = useMe();
  if (isGuest)
    return (
      <Screen tabBar>
        <TabHeader />
        <GuestWall title={mode === 'here' ? 'Host an activity' : 'Propose a trip'}>
          Create a free account to {mode === 'here' ? 'host activities' : 'propose trips'} and meet people. You can keep exploring as a guest in the meantime.
        </GuestWall>
      </Screen>
    );
  return mode === 'here' ? <CreateActivity /> : <CreateTrip />;
}
