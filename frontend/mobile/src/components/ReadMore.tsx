import { useState } from 'react';
import { Pressable, View, type StyleProp, type TextStyle } from 'react-native';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';
import { Text } from './ScaledText';

import { sc, sp } from '@/lib/scale';
/**
 * A description shown at `lines` lines, with "read more" when it is longer than that. Whether it is longer is measured, not
 * guessed from the number of characters: a list of short bullet points is few characters but many lines, and was cut off with
 * no way to read the rest. An invisible full copy is laid out to count its lines (both platforms report every line there).
 */
export function ReadMore({ text, lines = 3, style }: { text: string; lines?: number; style?: StyleProp<TextStyle> }) {
  const { t } = useT();
  const { c } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const [long, setLong] = useState(false);
  return (
    <View style={{ gap: sp(4) }}>
      <View>
        <Text numberOfLines={expanded ? undefined : lines} style={style}>
          {text}
        </Text>
        {/* the same text at full length, never seen: only its line count is read */}
        <Text
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          onTextLayout={(e) => setLong(e.nativeEvent.lines.length > lines)}
          style={[style, { position: 'absolute', left: 0, right: 0, top: 0, opacity: 0 }]}
        >
          {text}
        </Text>
      </View>
      {long ? (
        <Pressable accessibilityRole="button" accessibilityLabel={expanded ? t('Read less') : t('Read more')} onPress={() => setExpanded((v) => !v)} hitSlop={8} style={{ minHeight: sc(32), justifyContent: 'center', alignSelf: 'flex-start' }}>
          <Text style={{ color: c.green, fontSize: 16, fontWeight: '600' }}>{expanded ? t('read less') : t('read more')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}
