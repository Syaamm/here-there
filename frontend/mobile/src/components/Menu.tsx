import Ionicons from '@expo/vector-icons/Ionicons';
import { useRef, useState } from 'react';
import { Modal, Pressable, View, useWindowDimensions } from 'react-native';
import { Text } from './ScaledText';
import { FloatingButton } from './Hero';
import { Btn, Sheet } from './ui';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** The ⋯ button. Opens a sheet of actions. `floating` renders it as the white square used on hero images. */
export function Menu({ items, floating, round, size, popover, onDark }: { items: MenuItem[]; floating?: boolean; round?: boolean; size?: number; popover?: boolean; /** white dots, for the dark header band */ onDark?: boolean }) {
  const { c } = useTheme();
  const { t } = useT();
  const [open, setOpen] = useState(false);
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
            style={{ minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', paddingHorizontal: 8 }}
          >
            <Ionicons name="ellipsis-horizontal" size={22} color={onDark ? c.onBand : c.text} />
          </Pressable>
        </View>
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)} statusBarTranslucent navigationBarTranslucent>
          <Pressable accessibilityRole="button" accessibilityLabel={t('Close')} onPress={() => setOpen(false)} style={{ flex: 1 }}>
            <View accessibilityViewIsModal style={{ position: 'absolute', top, right: Math.max(12, (width - 760) / 2 + 12), minWidth: 200, backgroundColor: '#fff', borderRadius: 20, paddingVertical: 8, shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 8 }, elevation: 8 }}>
              {items.map((i) => (
                <Pressable
                  key={i.label}
                  accessibilityRole="menuitem"
                  accessibilityLabel={i.label}
                  onPress={() => {
                    setOpen(false);
                    setTimeout(i.onSelect, 250); // let the popover close first so a following confirm or screen change is not swallowed
                  }}
                  style={({ pressed }) => [{ minHeight: 48, justifyContent: 'center', paddingHorizontal: 22 }, pressed && { backgroundColor: c.bg }]}
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
        <Pressable accessibilityRole="button" accessibilityLabel={t('More options')} onPress={() => setOpen(true)} hitSlop={10} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="ellipsis-horizontal" size={22} color={onDark ? c.onBand : c.text} />
        </Pressable>
      )}
      <Sheet visible={open} title={t('Options')} onClose={() => setOpen(false)}>
        {items.map((i) => (
          <Btn
            key={i.label}
            title={i.label}
            variant={i.danger ? 'danger' : 'secondary'}
            onPress={() => {
              setOpen(false);
              // let the sheet close first so a following confirm()/navigation isn't swallowed by the modal
              setTimeout(i.onSelect, 250);
            }}
          />
        ))}
        <Btn title={t('Cancel')} variant="ghost" onPress={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
