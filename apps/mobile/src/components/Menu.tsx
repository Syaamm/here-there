import { useState } from 'react';
import { Pressable } from 'react-native';
import { Text } from './ScaledText';
import { FloatingButton } from './Hero';
import { Btn, Sheet } from './ui';
import { useTheme } from '@/lib/theme';

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/** The ⋯ button. Opens a sheet of actions. `floating` renders it as the white square used on hero images. */
export function Menu({ items, floating }: { items: MenuItem[]; floating?: boolean }) {
  const { c } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <>
      {floating ? (
        <FloatingButton icon="ellipsis-horizontal" label="More options" onPress={() => setOpen(true)} />
      ) : (
        <Pressable accessibilityRole="button" accessibilityLabel="More options" onPress={() => setOpen(true)} hitSlop={10} style={{ paddingHorizontal: 8 }}>
          <Text style={{ fontSize: 26, color: c.text, lineHeight: 28 }}>⋯</Text>
        </Pressable>
      )}
      <Sheet visible={open} title="Options" onClose={() => setOpen(false)}>
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
        <Btn title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
      </Sheet>
    </>
  );
}
