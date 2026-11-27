import { useLocalSearchParams, useRouter } from 'expo-router';
import { AcctCard, AcctLabel, AcctRow, AcctScreen } from '@/components/AccountParts';
import { Text } from '@/components/ScaledText';
import { Btn } from '@/components/ui';
import { useGo } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/**
 * "How it works": a short guide in plain words. Opened once after sign-up (?first=1, with a button to start), and always available
 * under Settings. The numbers below (hours and days) are the server's rules for attendance and reliability (backend/api/src/reliability/reliability.ts):
 * change them there and here together.
 */
export default function HowItWorks() {
  const { t } = useT();
  const { c } = useTheme();
  const go = useGo();
  const router = useRouter();
  const first = useLocalSearchParams<{ first?: string }>().first === '1';
  return (
    <AcctScreen title={t('How it works')}>
      <Text style={{ color: c.muted, fontSize: 16, lineHeight: 26 }}>{t('A quick guide: two apps in one, how plans work, friends, attendance and your reliability level.')}</Text>

      <AcctLabel>{t('Two apps in one')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="location-outline" title={t('HERE: activities near you')} subtitle={t('A coffee, a walk, a game tonight or this week. You join, meet in person, and it is over the same day.')} />
        <AcctRow icon="airplane-outline" title={t('THERE: trips with a group')} subtitle={t('Pick a destination and dates, apply, and travel with people the organizer approves. The budget is an estimate, never a booking.')} />
        <AcctRow icon="swap-horizontal-outline" title={t('Switch any time')} subtitle={t('Use the HERE | THERE switch at the top of the screen.')} last />
      </AcctCard>

      <AcctLabel>{t('Joining a plan')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="hand-right-outline" title={t('Request to join')} subtitle={t('Some activities let you in at once, others wait for the host to approve you. For a trip you write a short introduction and the organizer decides.')} />
        <AcctRow icon="chatbubbles-outline" title={t('The group chat opens when you are in')} subtitle={t('Until you are approved nothing is shared with you.')} />
        <AcctRow icon="exit-outline" title={t('Leaving')} subtitle={t('You can leave any time. Leaving within 2 hours of the start (a trip: within 7 days) counts against your reliability, so cancel early if you can.')} last />
      </AcctCard>

      <AcctLabel>{t('Friends and travel buddies')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="person-add-outline" title={t('Follow people')} subtitle={t('Follow someone from their profile. They are told, and can follow you back.')} />
        <AcctRow icon="people-outline" title={t('Friends')} subtitle={t('When you follow each other you are Friends. A friend going to a plan is marked in Who is going, and plans with friends in them come first in your feed.')} />
        <AcctRow icon="heart-outline" title={t('Travel buddies')} subtitle={t('Friends are your travel buddies: when they are going on a trip you see it on the trip. In THERE, Travel match can suggest people with similar plans.')} last />
      </AcctCard>

      <AcctLabel>{t('After the plan: attendance')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="checkmark-circle-outline" title={t('Say if you were there')} subtitle={t('When a plan or trip is over you can answer Yes, I went or No, I did not. It is one tap, it cannot be changed, and the group sees it. We never track your location.')} />
        <AcctRow icon="clipboard-outline" title={t('The host can note who did not come')} subtitle={t('The host or organizer has 48 hours to say who did not come. You are told straight away and have 7 days to dispute it. A moderator decides, and nothing counts against you until then.')} />
        <AcctRow icon="alert-circle-outline" title={t('If the host never came')} subtitle={t('Members can tell us the host did not show up, from 30 minutes after the start until 72 hours after the end. A moderator looks at it. If it is confirmed it counts against the host, and the notes they made about members are cancelled.')} last />
      </AcctCard>

      <AcctLabel>{t('Your reliability level')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="ribbon-outline" title={t('What it is')} subtitle={t('A level (New, Reliable, Very reliable or Building trust) based only on plans you were approved for that have finished. It is not a score to compete on.')} />
        <AcctRow icon="trending-up-outline" title={t('How it grows')} subtitle={t('Everyone starts as New and is never marked down for having no history. After 3 kept plans you are Reliable, and after 10 with a clean record, Very reliable.')} />
        <AcctRow icon="trending-down-outline" title={t('What lowers it')} subtitle={t('A no-show that stands, leaving late, or a report a moderator upheld. Older events count less every month.')} />
        <AcctRow icon="person-outline" title={t('Your own answer')} subtitle={t('What you answer yourself (Yes, I went or No, I did not) is shown to the group but does not change your level, either way. Only a note from the host that stands counts.')} />
        <AcctRow icon="stats-chart-outline" title={t('See yours')} subtitle={t('Everything it is based on, and how to dispute a note.')} onPress={() => go('/reliability')} last />
      </AcctCard>

      <AcctLabel>{t('If something goes wrong')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="flag-outline" title={t('Report or block')} subtitle={t('Tap ⋯ on anything to report it, or block a person at any time. Moderators look at every report, and if you disagree with a decision you can ask for a review.')} />
        <AcctRow icon="shield-checkmark-outline" title={t('Stay safe')} subtitle={t('Meet in public places and tell someone where you are going. If you are at risk, call 112.')} />
        <AcctRow icon="document-text-outline" title={t('Group guidelines')} subtitle={t('What every member agrees to.')} onPress={() => go('/guidelines')} last />
      </AcctCard>

      {first ? <Btn title={t("Got it, let's go")} onPress={() => router.replace('/' as never)} /> : null}
    </AcctScreen>
  );
}
