import { View } from 'react-native';
import { GuestWall } from '@/components/GuestWall';
import { TabHeader } from '@/components/TabHeader';
import { Screen } from '@/components/ui';
import { CreateActivity } from '@/features/CreateActivity';
import { CreateTrip } from '@/features/CreateTrip';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export default function CreateTab() {
  const { mode } = useTheme();
  const { t } = useT();
  const { isGuest } = useMe();
  if (isGuest)
    return (
      // the same plain header as the Inbox (the HERE | THERE switch), without the coloured band
      <Screen tabBar plain header={<TabHeader plain />}>
        <GuestWall title={mode === 'here' ? t('Host an activity') : t('Propose a trip')}>
          {mode === 'here'
            ? t('Create a free account to host activities and meet people. You can keep exploring as a guest in the meantime.')
            : t('Create a free account to propose trips and meet people. You can keep exploring as a guest in the meantime.')}
        </GuestWall>
      </Screen>
    );
  // both forms stay mounted, so switching HERE/THERE keeps what was typed in each; only the one for this mode shows
  return (
    <>
      <View style={mode === 'here' ? { flex: 1 } : { display: 'none' }}>
        <CreateActivity />
      </View>
      <View style={mode === 'there' ? { flex: 1 } : { display: 'none' }}>
        <CreateTrip />
      </View>
    </>
  );
}
