import { Pressable, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useT } from '@/lib/i18n';
import { sc } from '@/lib/scale';
import { useTheme } from '@/lib/theme';
import { pressed } from './ui';
import { Text, TextInput } from './ScaledText';

/** The sign-in and sign-up pages: round back button, centred title, pill fields, pill button (from the Figma design). */

/** The round back button at the top left (the design's 41 px circle with a thin rim and a chevron). */
export function AuthBack({ onPress }: { onPress: () => void }) {
  const { t } = useT();
  const { mode } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} hitSlop={6} onPress={onPress} style={({ pressed: p }) => [{ alignSelf: 'flex-start', width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>
      <Svg width={41} height={41} viewBox="0 0 41 41" fill="none">
        {mode === 'there' ? <Circle cx={20.5} cy={20.5} r={20} fill="#fff" /> : null}
        <Rect x={0.525641} y={0.525641} width={39.9487} height={39.9487} rx={19.9744} stroke="black" strokeOpacity={0.09} strokeWidth={1.05128} />
        <Path d="M22.5492 27.3846L17.4515 22.2869C16.8495 21.6849 16.8495 20.6997 17.4515 20.0977L22.5492 15" stroke="black" strokeWidth={1.17278} strokeMiterlimit={10} strokeLinecap="round" strokeLinejoin="round" />
      </Svg>
    </Pressable>
  );
}

/** Big centred title with the one-line promise under it. */
export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  const { c, mode } = useTheme();
  return (
    <View style={{ alignItems: 'center', gap: 8 }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 30, lineHeight: 36, fontWeight: mode === 'there' ? '700' : '600', textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{subtitle}</Text> : null}
    </View>
  );
}

/** A labelled pill-shaped field. The label sits above it; a hint or an error sits below. */
export function AuthField({ label, hint, error, style, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null }) {
  const { c, mode } = useTheme();
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: c.forest, fontSize: 13, lineHeight: 16, fontWeight: '600', paddingLeft: 2 }}>{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={c.placeholder}
        {...rest}
        style={[{ minHeight: sc(52), borderWidth: mode === 'there' && !error ? 0 : 1, borderRadius: 32, borderColor: error ? c.danger : c.line, backgroundColor: mode === 'there' ? '#fff' : c.surface, color: c.text, fontSize: 14, paddingHorizontal: 18, paddingVertical: 10 }, style]}
      />
      {hint && !error ? <Text style={{ color: c.muted, fontSize: 11, lineHeight: 15, paddingLeft: 4 }}>{hint}</Text> : null}
      {error ? <Text style={{ color: c.danger, fontSize: 11, lineHeight: 15, paddingLeft: 4 }}>{error}</Text> : null}
    </View>
  );
}

/** The full-width pill button in deep forest. */
export function AuthButton({ title, onPress, loading, disabled, style }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle> }) {
  const { c } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed: p }) => [{ minHeight: sc(54), borderRadius: 32, backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, opacity: off ? 0.5 : 1 }, style, !off && pressed(p)]}
    >
      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '500' }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** "Don't have an account?  Sign up", with a hairline on each side. */
export function AuthSwitch({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      <Text style={{ color: c.muted, fontSize: 13 }}>{prompt}</Text>
      <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress} style={{ minHeight: 32, justifyContent: 'center' }}>
        <Text style={{ color: c.forest, fontSize: 14, fontWeight: '600' }}>{action}</Text>
      </Pressable>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
    </View>
  );
}

/** The 18+ tick box: the design's small square, with a full-width tap area. */
export function AuthCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c, mode } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 }}>
      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: checked ? c.forest : c.muted, backgroundColor: checked ? c.forest : mode === 'there' ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Text style={{ color: '#fff', fontSize: 13, fontWeight: '800' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, color: c.text, fontSize: 14, lineHeight: 20 }}>{label}</Text>
    </Pressable>
  );
}
