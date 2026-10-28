import { useState } from 'react';
import { Pressable } from 'react-native';
import { Text } from './ScaledText';
import { FloatingButton } from './Hero';
import { Btn, Sheet } from './ui';
import { useT } from '@/lib/i18n';
import { useTheme } from '@/lib/theme';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** The ⋯ button. Opens a sheet of actions. `floating` renders it as the white square used on hero images. */
export function Menu({ items, floating, round, size }: { items: MenuItem[]; floating?: boolean; round?: boolean; size?: number }) {
  const { c } = useTheme();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      {floating ? (
        <FloatingButton round={round} size={size} icon="ellipsis-horizontal" label={t('More options')} onPress={() => setOpen(true)} />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel={t('More options')} onPress={() => setOpen(true)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 26, color: c.text, lineHeight: 28 }}>⋯</Text>
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
