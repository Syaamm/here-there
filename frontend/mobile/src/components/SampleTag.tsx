import { View } from 'react-native';
import { useT } from '@/lib/i18n';
import { Text } from './ScaledText';

/**
 * "Sample": marks the made-up people, activities and trips of the sample data (the server sends `sample: true` for them, see
 * common/demo.ts on the API), so nobody takes them for real people. `onPhoto` is the dark see-through look for a card's picture.
 */
export function SampleTag({ onPhoto }: { onPhoto?: boolean }) {
  const { t } = useT();
  return (
    <View
      accessible
      accessibilityLabel={t('Sample content, not a real person')}
      style={[
        { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
        onPhoto ? { backgroundColor: 'rgba(0,0,0,0.5)' } : { backgroundColor: '#EEEAE2', borderWidth: 1, borderColor: 'rgba(0,0,0,0.08)' },
      ]}
    >
      <Text style={{ color: onPhoto ? '#fff' : '#5B5A55', fontSize: 10.5, lineHeight: 14, fontWeight: '600', letterSpacing: 0.4 }}>{t('SAMPLE')}</Text>
    </View>
  );
}
