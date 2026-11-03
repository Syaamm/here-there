import { ExploreHere } from '@/features/ExploreHere';
import { ExploreThere } from '@/features/ExploreThere';
import { useTheme } from '@/lib/theme';

export default function ExploreTab() {
  const { mode } = useTheme();
  return mode === 'here' ? <ExploreHere /> : <ExploreThere />;
}
