import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Modal, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ScaledText';
import { FloatingButton } from './Hero';
import { Btn, Sheet } from './ui';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

import { sc, sp, sph } from '@/lib/scale';
export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** The ⋯ button. Opens a sheet of actions. `floating` renders it as the white square used on hero images. */
export function Menu({ items, floating, round, size, popover, onDark }: { items: MenuItem[]; floating?: boolean; round?: boolean; size?: number; popover?: boolean; /** white dots, for the dark header band */ onDark?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  // the action picked runs once the menu is fully closed: iPhone silently drops a sheet or alert opened while it is still leaving
  const pending = useRef<(() => void) | null>(null);
  const pick = (fn: () => void) => {
    pending.current = fn;
    setOpen(false);
    if (popover && Platform.OS !== 'ios') setTimeout(runPending, 200); // the popover's own fade, then the action
  };
  const runPending = () => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  };
  const [top, setTop] = useState(90);
  const anchor = useRef<React.ComponentRef<typeof View>>(null);
  const { width } = useWindowDimensions();
  if (popover)
    return (
      <>
        <View ref={anchor} collapsable={false}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('More options')}
            accessibilityState={{ expanded: open }}
            onPress={() => {
              // the card opens right under the button
              anchor.current?.measureInWindow((_x, y, _w, h) => {
                setTop(y + h + 4);
                setOpen(true);
              });
            }}
            hitSlop={10}
            style={{ minWidth: sc(44), minHeight: sc(44), alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: sph(8) }}
          >
            <Ionicons name="ellipsis-horizontal" size={sc(22)} color={onDark ? c.onBand : c.text} />
          </Pressable>
        </View>
        <Modal
          visible={open}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(false)}
          // iPhone says when the popover has fully gone; Android has no such call, and its popover is gone right away
          onDismiss={runPending}
          onShow={() => void (pending.current = null)}
          statusBarTranslucent
          navigationBarTranslucent
        >
          <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => setOpen(false)} style={{ flex: 1 }}>
            <View accessibilityViewIsModal style={{ position: 'absolute', top, right: Math.max(12, (width - 760) / 2 + 12), minWidth: sc(200), backgroundColor: '#fff', borderRadius: sc(20), paddingVertical: sp(8), shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: sc(8) }, elevation: 8 }}>
              {items.map((i) => (
                <Pressable
                  key={i.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={i.label}
                  onPress={() => pick(i.onSelect)}
                  style={({ pressed }) => [{ minHeight: sc(48), justifyContent: 'center', paddingHorizontal: sph(22) }, pressed && { backgroundColor: c.bg }]}
                >
                  <Text style={{ color: i.danger ? c.danger : '#000', fontSize: 16, lineHeight: 22 }}>{i.label}</Text>
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Modal>
      </>
    );
  return (
    <>
      {floating ? (
        <FloatingButton round={round} size={size} icon="ellipsis-horizontal" label={t('More options')} onPress={() => setOpen(true)} />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('More options')} onPress={() => setOpen(true)} hitSlop={10} style={{ minWidth: sc(44), minHeight: sc(44), alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-horizontal" size={sc(22)} color={onDark ? c.onBand : c.text} />
        </Pressable>
      )}
      <Sheet visible={open} title={t('Options')} onClose={() => setOpen(false)} onClosed={runPending}>
        {items.map((i) => (
          <Btn
            key={i.label}
            title={i.label}
            variant={i.danger ? 'danger' : 'secondary'}
            onPress={() => pick(i.onSelect)}
          />
        ))}
        <Btn title={t('Cancel')} variant="ghost" onPress={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
