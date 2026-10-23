import { View } from 'react-native';
import { useEffect } from 'react';
import { Banner, Between, Btn, Card, Chip, ErrorBanner, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { del, get } from '@/lib/api';
import { useMe } from '@/lib/auth';
import { useAction, useLoad } from '@/lib/hooks';

/** Safety controls shared by HERE and THERE: identity verification status, blocking, and plain-language guidance. */
export default function Safety() {
  const { me, reload } = useMe();
  const go = useGo();
  const blocks = useLoad(() => get<{ items: { userId: string; displayName?: string }[] }>('/v1/blocks'), []);
  // always re-check the latest verification result when this screen is opened
  useEffect(() => {
    void reload();
  }, [reload]);
  const unblock = useAction(() => void blocks.reload());
  const e = me?.eligibility;

  return (
    <Screen hasHeader>
      <Txt variant="h1" style={{ fontSize: 34, lineHeight: 40 }}>Feel confident meeting people.</Txt>
      <Txt variant="muted">HERE and THERE provide safety features, not a guarantee of personal safety. Choose public places and trust your judgment.</Txt>

      <Card>
        <Between>
          <Txt variant="h3">Identity verification</Txt>
          {e === 'verified' ? <Chip label="Verified adult" tone="ok" /> : e === 'pending' ? <Chip label="Pending" tone="warn" /> : e === 'rejected' ? <Chip label="Not approved" tone="bad" /> : e === 'expired' ? <Chip label="Expired" tone="warn" /> : e === 'reverification_required' ? <Chip label="Re-check needed" tone="warn" /> : <Chip label="Not started" tone="neutral" />}
        </Between>
        <Txt variant="small">A specialist provider checks your ID and matches a selfie, to confirm you are a real adult. Only the result is shared with others, never your documents. Browsing is open to everyone. You need this to join, host or chat, in HERE and THERE.</Txt>
        {e === 'pending' && <Banner tone="warn">Your check is being reviewed. We'll notify you as soon as there's a decision.</Banner>}
        {e === 'verified' && <Banner tone="ok">You're verified. You can host, join and chat in activities and trips.</Banner>}
        <Btn title={e === 'verified' ? 'View verification' : e === 'pending' ? 'View status' : e === 'rejected' ? 'Try verification again' : e === 'expired' || e === 'reverification_required' ? 'Verify again' : 'Get verified'} variant={e === 'verified' ? 'secondary' : 'primary'} onPress={() => go('/verify')} />
      </Card>

      <ListRow icon="flag-outline" title="Report a user, activity or trip" subtitle="Tap ⋯ on any activity, trip or message. Reports reach our moderation team." />

      <Card>
        <Txt variant="h3">Blocked people</Txt>
        <Txt variant="small">Blocking applies across HERE and THERE. Blocked people can't see or contact you, and you won't see them.</Txt>
        <ErrorBanner message={unblock.error} />
        {blocks.data?.items.length === 0 && <Txt variant="muted">You haven't blocked anyone.</Txt>}
        {blocks.data?.items.map((b) => (
          <Between key={b.userId}>
            <Txt>{b.displayName ?? b.userId}</Txt>
            <Btn title="Unblock" variant="secondary" small disabled={unblock.busy} onPress={() => unblock.run(() => del(`/v1/blocks/${b.userId}`))} />
          </Between>
        ))}
      </Card>

      <View>
        <ListRow icon="location-outline" title="Location controls" subtitle="We never publish a participant's live location. The map only shows public venues." />
        <ListRow icon="lock-closed-outline" title="Private group chat" subtitle="Only approved members can read the conversation. Access ends the moment you leave or are removed." />
        <ListRow icon="call-outline" title="Emergency support" subtitle="If you are at risk, contact local emergency services right away (112 in the EU). We can't respond to emergencies." last />
      </View>
    </Screen>
  );
}
