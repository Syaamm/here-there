import { useIsFocused } from 'expo-router';
import { useEffect } from 'react';
import { ExploreHere } from '@/features/ExploreHere';
import { ExploreThere } from '@/features/ExploreThere';
import { useCoach, type CoachStep } from '@/lib/coach';
import { dockHide } from '@/lib/dock';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * The first-time tour: starts on Home, once, after sign-up (and again from Settings > "Show the tour again"). It points at the real
 * HERE | THERE switch and dock buttons; a step whose thing is not on the screen is skipped.
 */
function TourStarter() {
  const { t } = useT();
  const { mode } = useTheme();
  const { wanted, begin } = useCoach();
  const focused = useIsFocused();
  useEffect(() => {
    if (!wanted || !focused) return;
    // a moment for the page to settle (and for the dock to be in view) before the first card
    const timer = setTimeout(() => {
      dockHide.setValue(0);
      const steps: CoachStep[] = [
        { title: t('Welcome to Lamis'), text: t('A quick tour of the screen, under a minute. You can skip it any time, and find it again in Settings.') },
        { id: 'mode', title: t('HERE and THERE'), text: t('HERE is for activities near you. THERE is for trips with a group. Tap to switch between them any time.') },
        mode === 'here'
          ? { id: 'tab-discover', size: 64, title: t('The map'), text: t('See the activities around you on a map, and tap one to read the details and ask to join.') }
          : { id: 'tab-discover', size: 64, title: t('Explore trips'), text: t('Search trips by destination and dates, then tap one to read the plan and apply.') },
        { id: 'create', size: 76, title: t('Host something'), text: t('Tap + to host an activity (HERE) or plan a trip (THERE). Others ask to join and you decide.') },
        { id: 'tab-inbox', size: 64, title: t('Chats and alerts'), text: t('Your group chats, join requests and reminders live here. A red badge means something is new.') },
        { id: 'tab-profile', size: 64, title: t('Your profile'), text: t('Your activities, trips, favourites, friends and reliability level. Settings has a "How it works" guide.') },
        { title: t('You are ready'), text: t('When a plan is over you will be asked if you went. It is one tap, and it helps everyone trust each other.') },
      ];
      begin(steps);
    }, 700);
    return () => clearTimeout(timer);
  }, [wanted, focused, begin, mode, t]);
  return null;
}

export default function ExploreTab() {
  const { mode } = useTheme();
  return (
    <>
      {mode === 'here' ? <ExploreHere /> : <ExploreThere />}
      <TourStarter />
    </>
  );
}
