import type { TextStyle } from 'react-native';
import { Text } from '@/components/ScaledText';
import { useT } from '@/lib/i18n';
import { openLegal } from '@/lib/legal';

/** "<lead> · Terms · Privacy policy": two links to the website's pages, for the welcome screen and sign-up. */
export function LegalLinks({ lead, color, linkColor, size = 12, style }: { lead?: string; color: string; linkColor?: string; size?: number; style?: TextStyle }) {
  const { t } = useT();
  // no underline (it cut through the letters that hang below the line): the links are told apart by a darker colour and a heavier weight
  const link: TextStyle = { color: linkColor ?? color, fontWeight: '600' };
  return (
    <Text style={[{ color, fontSize: size, lineHeight: Math.round(size * 1.8), textAlign: 'center' }, style]}>
      {lead ? `${lead} · ` : ''}
      <Text accessibilityRole="link" onPress={() => openLegal('terms-and-conditions')} style={link}>
        {t('Terms')}
      </Text>
      {' · '}
      <Text accessibilityRole="link" onPress={() => openLegal('privacy-policy')} style={link}>
        {t('Privacy policy')}
      </Text>
    </Text>
  );
}
