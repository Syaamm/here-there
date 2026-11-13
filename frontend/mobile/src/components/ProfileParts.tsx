import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Circle, Path } from 'react-native-svg';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { BTN } from '@/lib/buttons';
import { useTheme } from '@/lib/theme';
import { AuthBack } from './AuthForm';
import { Text } from './ScaledText';

/** Building blocks for the Account, Edit profile and Notifications pages (Figma "Account", "Edit Profile", "Notifications"). */

/** Round back button with the page title beside it (the title is centred under the status bar like the design). */
export function PageTop({ title, align = 'center' }: { title: string; align?: 'center' | 'left' }) {
  const { c, mode } = useTheme();
  const { t } = useT();
  const router = useRouter();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/profile' as never));
  if (mode === 'there' && align === 'left') {
    // THERE's design: a plain chevron with the title beside it (no round button)
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: sc(48) }}>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} hitSlop={8} onPress={back} style={({ pressed }) => ({ width: sc(44), height: sc(44), justifyContent: 'center', paddingLeft: sph(6), opacity: pressed ? 0.6 : 1 })}>
          <Ionicons name="chevron-back" size={sc(22)} color={c.text} />
        </Pressable>
        <Text accessibilityRole="header" numberOfLines={1} style={{ flex: 1, color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700', marginLeft: sph(6) }}>{title}</Text>
      </View>
    );
  }
  return (
    <View style={{ minHeight: sc(48), justifyContent: 'center' }}>
      <View style={{ position: 'absolute', left: 0, top: 2 }}>
        <AuthBack onPress={back} />
      </View>
      <Text accessibilityRole="header" numberOfLines={1} style={{ color: c.text, fontSize: 22, lineHeight: 28, fontWeight: '700', textAlign: align === 'center' ? 'center' : 'left', paddingLeft: align === 'center' ? sph(52) : sph(56), paddingRight: align === 'center' ? sph(52) : 0 }}>
        {title}
      </Text>
    </View>
  );
}

/** The plain grey heading above a group ("Account", "Account & Security"). */
export function GroupLabel({ children }: { children: string }) {
  const { c } = useTheme();
  return <Text accessibilityRole="header" style={{ color: c.muted, fontSize: 16, lineHeight: 21, fontWeight: '500', marginTop: sp(6) }}>{children}</Text>;
}

/** A big rounded card with a hairline rim (radius 32 in the design). */
export function RoundCard({ children, style, pad = 20 }: { children: ReactNode; style?: object; pad?: number }) {
  const { c, mode } = useTheme();
  return <View style={[{ borderRadius: sc(32), borderWidth: 1, borderColor: mode === 'there' ? 'rgba(16,47,41,0.08)' : c.line, backgroundColor: mode === 'there' ? '#fff' : c.surface, paddingHorizontal: pad, paddingVertical: sp(8) }, style]}>{children}</View>;
}

/** The small round chevron button at the right end of a row. */
export function ChevronCircle() {
  const { c, mode } = useTheme();
  return (
    <View style={{ width: sc(34), height: sc(34), borderRadius: sc(17), borderWidth: 1, borderColor: c.line, backgroundColor: mode === 'there' ? '#fff' : undefined, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="chevron-forward" size={sc(15)} color={c.text} />
    </View>
  );
}

/** One row: icon, title, small grey line under it, then a chevron circle (or your own right side). */
export function AccountRow({ icon, title, subtitle, onPress, right, last, tint, dot }: { icon: React.ComponentProps<typeof Ionicons>['name']; /** a red dot beside the title: something here is new */ dot?: boolean; title: string; subtitle?: string; onPress?: () => void; right?: ReactNode; last?: boolean; tint?: string }) {
  const { c, mode } = useTheme();
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(14), minHeight: sc(64), paddingVertical: sp(12), borderBottomWidth: last ? 0 : 1, borderBottomColor: mode === 'there' ? 'rgba(16,47,41,0.09)' : c.line }}>
      <View style={{ width: sc(24), alignItems: 'center' }}>
        <Ionicons name={icon} size={sc(22)} color={tint ?? c.text} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(8) }}>
          <Text style={{ color: tint ?? c.text, fontSize: 16, lineHeight: 21, fontWeight: '500' }}>{title}</Text>
          {dot ? <View accessibilityLabel="New" style={{ width: sc(9), height: sc(9), borderRadius: sc(5), backgroundColor: c.danger }} /> : null}
        </View>
        {subtitle ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12, lineHeight: 16 }}>{subtitle}</Text> : null}
      </View>
      {right ?? (onPress ? <ChevronCircle /> : null)}
    </View>
  );
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} onPress={onPress} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
      {body}
    </Pressable>
  ) : (
    body
  );
}

/** Pill option group (language, text size): the chosen one is filled deep forest, the others have a hairline. */
export function PillChoice<T extends string>({ options, value, onChange, label, labelFor }: { options: [T, string][]; value: T; onChange: (v: T) => void; label: string; labelFor?: (l: string) => string }) {
  const { c, mode } = useTheme();
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: sp(8) }}>
      {options.map(([v, text]) => {
        const on = value === v;
        return (
          <Pressable key={v} accessibilityRole="radio" accessibilityLabel={labelFor ? labelFor(text) : text} accessibilityState={{ selected: on }} hitSlop={4} onPress={() => onChange(v)} style={{ minHeight: sc(BTN.pill), paddingHorizontal: sph(16), borderRadius: BTN.radiusPill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : mode === 'there' ? '#fff' : c.surface, borderWidth: 1, borderColor: on ? c.forest : c.line }}>
            <Text style={{ color: on ? '#fff' : c.text, ...BTN.text }}>{text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A multi-select pill (languages, interests): chosen ones are filled deep forest. */
export function TogglePill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const { c, mode } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: on }} hitSlop={4} onPress={onPress} style={{ minHeight: sc(BTN.pill), paddingHorizontal: sph(16), borderRadius: BTN.radiusPill, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? c.forest : mode === 'there' ? '#fff' : c.surface, borderWidth: 1, borderColor: on ? c.forest : c.line }}>
      <Text style={{ color: on ? '#fff' : c.text, ...BTN.text }}>{label}</Text>
    </Pressable>
  );
}

/** A small pill button next to the photo: filled (Change photo) or outlined (Remove). */
export function SmallPill({ title, onPress, filled, disabled, loading }: { title: string; onPress: () => void; filled?: boolean; disabled?: boolean; loading?: boolean }) {
  const { c, mode } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: !!off, busy: !!loading }} disabled={off} hitSlop={4} onPress={onPress} style={{ minHeight: sc(BTN.small), width: sc(150), /* the same width for Change photo and Remove, whatever the words are */ paddingHorizontal: sph(12), borderRadius: BTN.radiusSmall, alignItems: 'center', justifyContent: 'center', backgroundColor: filled ? c.forest : mode === 'there' ? '#fff' : c.surface, borderWidth: 1, borderColor: filled ? c.forest : c.line, opacity: off ? 0.5 : 1 }}>
      <Text style={{ color: filled ? '#fff' : c.text, ...BTN.text }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** The Reliability row's icon from the design: an outlined shield with a small location pin inside it. */
export function ReliabilityIcon({ size = 22, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" accessibilityElementsHidden importantForAccessibility="no">
      <Path d="M12 2.8 19.4 5.4V11.4C19.4 15.9 16.4 19.6 12 21.2 7.6 19.6 4.6 15.9 4.6 11.4V5.4Z" stroke={color} strokeWidth={1.7} strokeLinejoin="round" />
      <Circle cx="12" cy="9.6" r="2.1" stroke={color} strokeWidth={1.6} />
      <Path d="M12 11.8V15" stroke={color} strokeWidth={1.6} strokeLinecap="round" />
    </Svg>
  );
}
