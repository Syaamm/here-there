import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { Row, Txt } from './ui';

import { sc, sp } from '@/lib/scale';
/** One line of a "Before joining" checklist: text on the left, a round tick (or cross) on the right. */
export function CheckLine({ ok, text, action }: { ok: boolean; text: string; action?: ReactNode }) {
  const { c } = useTheme();
  return (
    <View style={{ gap: sp(6), paddingVertical: sp(12), borderBottomWidth: 1, borderBottomColor: c.line }}>
      <Row style={{ justifyContent: 'space-between' }}>
        <Txt style={{ flex: 1 }}>{text}</Txt>
        <View style={{ width: sc(32), height: sc(32), borderRadius: sc(16), backgroundColor: ok ? c.accentSoft : c.badBg, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={ok ? 'checkmark' : 'close'} size={sc(18)} color={ok ? c.okFg : c.badFg} />
        </View>
      </Row>
      {action}
    </View>
  );
}
