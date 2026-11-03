import { useEffect } from 'react';
import { View } from 'react-native';
import { AcctCard, AcctLabel, AcctRow, AcctScreen, StatusTag } from '@/components/AccountParts';
import { AuthButton } from '@/components/AuthForm';
import { Text } from '@/components/ScaledText';
import { useGo } from '@/components/ui';
import { useMe } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** Safety controls shared by HERE and THERE: identity verification status and plain-language guidance. (Blocked people are under Settings > Reports & blocked.) */
export default function Safety() {
  const { me, reload } = useMe();
  const go = useGo();
  const { t } = useT();
  const { c } = useTheme();
  // always re-check the latest verification result when this screen is opened
  useEffect(() => {
    void reload();
  }, [reload]);
  const e = me?.eligibility;

  return (
    <AcctScreen title={t('Safety & privacy')}>
      <Text style={{ color: c.muted, fontSize: 14, lineHeight: 27 }}>{t('Safety features, not a guarantee. Meet in public places.')}</Text>

      <AcctCard style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text accessibilityRole="header" style={{ color: c.text, fontSize: 15, lineHeight: 22, fontWeight: '500', flexShrink: 1 }}>{t('Identity verification')}</Text>
          {e === 'verified' ? <StatusTag label={t('Verified adult')} tone="ok" /> : e === 'pending' ? <StatusTag label={t('Pending')} tone="warn" /> : e === 'rejected' ? <StatusTag label={t('Not approved')} tone="bad" /> : e === 'expired' ? <StatusTag label={t('Expired')} tone="warn" /> : e === 'reverification_required' ? <StatusTag label={t('Re-check needed')} tone="warn" /> : <StatusTag label={t('Not started')} tone="neutral" />}
        </View>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>{t('Only the result is shared, never your documents.')}</Text>
        <AuthButton
          style={{ marginTop: 8 }}
          title={e === 'verified' ? t('View verification') : e === 'pending' ? t('View status') : e === 'rejected' ? t('Try verification again') : e === 'expired' || e === 'reverification_required' ? t('Verify again') : t('Get verified')}
          onPress={() => go('/verify')}
        />
      </AcctCard>

      <AcctLabel>{t('Privacy controls')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="flag-outline" title={t('Report a user, activity or trip')} subtitle={t('Tap ⋯ on anything to report it.')} />
        <AcctRow icon="location-outline" title={t('Location controls')} subtitle={t('We never share live location.')} />
        <AcctRow icon="lock-closed-outline" title={t('Private group chat')} subtitle={t('Only approved members can read it.')} last />
      </AcctCard>

      <AcctLabel>{t('Emergency assistance')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="call-outline" title={t('Emergency support')} subtitle={t('If you are at risk, contact local emergency services right away (112 in the EU). We can\'t respond to emergencies.')} last />
      </AcctCard>
    </AcctScreen>
  );
}
