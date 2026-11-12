import { MapHere } from '@/features/MapHere';
import { MapThere } from '@/features/MapThere';
import { useTheme } from '@/lib/theme';

export default function DiscoverTab() {
  const { mode } = useTheme();
  return mode === 'here' ? <MapHere /> : <MapThere />;
}
