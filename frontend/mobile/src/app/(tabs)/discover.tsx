import { MapHere } from '@/features/MapHere';
import { SearchThere } from '@/features/SearchThere';
import { useTheme } from '@/lib/theme';

export default function DiscoverTab() {
  const { mode } = useTheme();
  return mode === 'here' ? <MapHere /> : <SearchThere />;
}
