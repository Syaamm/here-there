import { View } from 'react-native';
import { CreateActivity } from '@/features/CreateActivity';
import { CreateTrip } from '@/features/CreateTrip';
import { DockSpace, useDockSpace, useNoDock } from '@/lib/dock';
import { useTheme } from '@/lib/theme';

export default function CreateTab() {
  const { mode } = useTheme();
  const parentSpace = useDockSpace();
  // The create forms (HERE and THERE) take the dock away on phones: they have their own Back, Continue and Review, and nothing may sit
  // on top of their fields or buttons. Everyone gets the forms, guests too: only publishing needs a verified account (it says so there).
  const away = useNoDock();
  // both forms stay mounted, so switching HERE/THERE keeps what was typed in each; only the one for this mode shows
  return (
    <DockSpace.Provider value={away ? 0 : parentSpace}>
      <View style={mode === 'here' ? { flex: 1 } : { display: 'none' }}>
        <CreateActivity />
      </View>
      <View style={mode === 'there' ? { flex: 1 } : { display: 'none' }}>
        <CreateTrip />
      </View>
    </DockSpace.Provider>
  );
}
