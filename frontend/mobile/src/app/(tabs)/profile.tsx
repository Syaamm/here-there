import { Profile } from '@/features/Profile';
import { DockSpace, useDockSpace, useNoDock } from '@/lib/dock';

/** Your own profile, for everyone (a guest sees the demo profile; editing it asks for a verified account). */
export default function ProfileTab() {
  const parentSpace = useDockSpace();
  // your own profile takes the dock away on phones (it has its own Back)
  const away = useNoDock();
  return (
    <DockSpace.Provider value={away ? 0 : parentSpace}>
      <Profile showBack={away} />
    </DockSpace.Provider>
  );
}
