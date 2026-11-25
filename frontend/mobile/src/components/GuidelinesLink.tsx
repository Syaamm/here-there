import { Text } from '@/components/ScaledText';
import { useGo } from '@/components/ui';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

/** The words "group guidelines" as a link that opens the guidelines page. Used inside a sentence such as "I agree to the group guidelines". */
export function GuidelinesLink() {
  const { t } = useT();
  const { c } = useTheme();
  const go = useGo();
  return (
    <Text accessibilityRole="link" onPress={() => go('/guidelines')} style={{ color: c.forest, fontWeight: '800' }}>
      {t('group guidelines')} ›
    </Text>
  );
}
