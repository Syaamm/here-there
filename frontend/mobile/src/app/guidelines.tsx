import { AcctCard, AcctLabel, AcctRow, AcctScreen } from '@/components/AccountParts';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';
import { openLegal } from '@/lib/legal';
import { useTheme } from '@/lib/theme';

/** The group guidelines in plain words: what every member agrees to before joining a plan or sending a trip application. */
export default function Guidelines() {
  const { t } = useT();
  const { c } = useTheme();
  return (
    <AcctScreen title={t('Group guidelines')}>
      <Text style={{ color: c.muted, fontSize: 16, lineHeight: 26 }}>{t('What every member agrees to, so that plans stay friendly and safe.')}</Text>

      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="heart-outline" title={t('Be respectful')} subtitle={t('No harassment, threats or discrimination.')} />
        <AcctRow icon="people-outline" title={t('Meet in public')} subtitle={t('Choose public places and tell someone where you are going. Do not share your home address or live location.')} />
        <AcctRow icon="person-circle-outline" title={t('Be yourself')} subtitle={t('One account, your real identity. No pretending to be someone else.')} />
        <AcctRow icon="wallet-outline" title={t('Keep it non-commercial')} subtitle={t('No asking people for money or selling things.')} />
        <AcctRow icon="shield-checkmark-outline" title={t('Keep it safe and legal')} subtitle={t('Nothing illegal, sexual, violent or misleading. Do not collect other people\'s personal data.')} />
        <AcctRow icon="flag-outline" title={t('Report anything that feels wrong')} subtitle={t('Tap ⋯ on anything to report it, or block a person at any time. If you are at risk, call 112.')} last />
      </AcctCard>

      <AcctLabel>{t('More')}</AcctLabel>
      <AcctCard style={{ paddingVertical: 8 }}>
        <AcctRow icon="document-text-outline" title={t('Terms and conditions')} onPress={() => openLegal('terms-and-conditions')} />
        <AcctRow icon="lock-closed-outline" title={t('Privacy policy')} onPress={() => openLegal('privacy-policy')} last />
      </AcctCard>
    </AcctScreen>
  );
}
