import { View } from 'react-native';
import { useEffect } from 'react';
import { Between, Btn, Card, Chip, ListRow, Screen, Txt, useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';

/** Safety controls shared by HERE and THERE: identity verification status and plain-language guidance. (Blocked people are under Settings > Reports & blocked.) */
export default function Safety() {
  const { me, reload } = useMe();
  const go = useGo();
  const { t } = useT();
  // always re-check the latest verification result when this screen is opened
  useEffect(() => {
    void reload();
  }, [reload]);
  const e = me?.eligibility;

  return (
    <Screen hasHeader>
      <Txt variant="h1" style={{ fontSize: 34, lineHeight: 40 }}>{t('Feel confident meeting people.')}</Txt>
      <Txt variant="muted">{t('Safety features, not a guarantee. Meet in public places.')}</Txt>

      <Card>
        <Between>
          <Txt variant="h3">{t('Identity verification')}</Txt>
          {e === 'verified' ? <Chip label={t('Verified adult')} tone="ok" /> : e === 'pending' ? <Chip label={t('Pending')} tone="warn" /> : e === 'rejected' ? <Chip label={t('Not approved')} tone="bad" /> : e === 'expired' ? <Chip label={t('Expired')} tone="warn" /> : e === 'reverification_required' ? <Chip label={t('Re-check needed')} tone="warn" /> : <Chip label={t('Not started')} tone="neutral" />}
        </Between>
        <Txt variant="small">{t('Only the result is shared, never your documents.')}</Txt>
        <Btn title={e === 'verified' ? t('View verification') : e === 'pending' ? t('View status') : e === 'rejected' ? t('Try verification again') : e === 'expired' || e === 'reverification_required' ? t('Verify again') : t('Get verified')} variant={e === 'verified' ? 'secondary' : 'primary'} onPress={() => go('/verify')} />
      </Card>

      <ListRow icon="flag-outline" title={t('Report a user, activity or trip')} subtitle={t('Tap ⋯ on anything to report it.')} />

      <View>
        <ListRow icon="location-outline" title={t('Location controls')} subtitle={t('We never share live location.')} />
        <ListRow icon="lock-closed-outline" title={t('Private group chat')} subtitle={t('Only approved members can read it.')} />
        <ListRow icon="call-outline" title={t('Emergency support')} subtitle={t('If you are at risk, contact local emergency services right away (112 in the EU). We can\'t respond to emergencies.')} last />
      </View>
    </Screen>
  );
}
