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
      <Screen tabBar header={<TabHeader />}>
        <GuestWall title={mode === 'here' ? t('Host an activity') : t('Propose a trip')}>
          {mode === 'here'
            ? t('Create a free account to host activities and meet people. You can keep exploring as a guest in the meantime.')
            : t('Create a free account to propose trips and meet people. You can keep exploring as a guest in the meantime.')}
        </GuestWall>
      </Screen>
    );
  return mode === 'here' ? <CreateActivity /> : <CreateTrip />;
}
