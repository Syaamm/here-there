import Ionicons from '@expo/vector-icons/Ionicons';
import { useState, type Ref } from 'react';
import { Pressable, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { useT } from '@/lib/i18n';
import { tap } from '@/lib/haptics';
import { sc, sp, sph } from '@/lib/scale';
import { BTN } from '@/lib/buttons';
import { useTheme } from '@/lib/theme';
import { pressed } from './ui';
import { Text, TextInput } from './ScaledText';

/** What a form needs from an input: to move the cursor into it. */
export type InputHandle = { focus: () => void };

/** The sign-in and sign-up pages: round back button, centred title, pill fields, pill button (from the Figma design). */

/** The round back button at the top left (the design's 41 px circle with a thin rim and a chevron). */
export function AuthBack({ onPress }: { onPress: () => void }) {
  const { t } = useT();
  const { mode } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={t('Back')} hitSlop={6} onPress={onPress} style={({ pressed: p }) => [{ alignSelf: 'flex-start', width: sc(44), height: sc(44), alignItems: 'center', justifyContent: 'center' }, pressed(p)]}>
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
    <View style={{ alignItems: 'center', gap: sp(8) }}>
      <Text accessibilityRole="header" style={{ color: c.text, fontSize: 30, lineHeight: 36, fontWeight: mode === 'there' ? '700' : '600', textAlign: 'center' }}>{title}</Text>
      {subtitle ? <Text style={{ color: c.muted, fontSize: 16, lineHeight: 23, textAlign: 'center' }}>{subtitle}</Text> : null}
    </View>
  );
}

/** A labelled pill-shaped field. The label sits above it; a hint or an error sits below. */
export function AuthField({ label, hint, error, style, inputRef, ...rest }: TextInputProps & { label: string; hint?: string; error?: string | null; /** lets a form move on to the next field from the keyboard's Next key */ inputRef?: Ref<InputHandle> }) {
  const { c, mode } = useTheme();
  const { t } = useT();
  const [shown, setShown] = useState(false); // a password can be shown while it is typed
  const secret = !!rest.secureTextEntry;
  const multi = !!rest.multiline;
  return (
    <View style={{ gap: sp(14) }}>
      <Text style={{ color: c.forest, fontSize: 16, lineHeight: 22, fontWeight: '600', paddingLeft: 2 }}>{label}</Text>
      <View>
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          placeholderTextColor={c.placeholder}
          selectionColor={c.forest}
          cursorColor={c.forest}
          underlineColorAndroid="transparent"
          returnKeyType={multi ? undefined : 'done'}
          autoCorrect={secret || rest.autoCapitalize === 'none' ? false : undefined}
          {...rest}
          secureTextEntry={secret && !shown}
          textAlignVertical={multi ? 'top' : 'center'}
          style={[{ minHeight: sc(52), borderWidth: mode === 'there' && !error ? 0 : 1, borderRadius: sc(32), borderColor: error ? c.danger : c.line, backgroundColor: mode === 'there' ? '#fff' : c.surface, color: c.text, fontSize: 16, paddingHorizontal: sph(18), paddingVertical: sp(10), includeFontPadding: false }, secret ? { paddingRight: sph(52) } : null, style]}
        />
        {secret ? (
          <Pressable accessibilityRole="button" accessibilityLabel={shown ? t('Hide password') : t('Show password')} onPress={() => setShown((v) => !v)} hitSlop={4} style={{ position: 'absolute', right: sc(4), top: 0, bottom: 0, width: sc(44), alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name={shown ? 'eye-off-outline' : 'eye-outline'} size={sc(20)} color={c.muted} />
          </Pressable>
        ) : null}
      </View>
      {hint && !error ? <Text style={{ color: c.muted, fontSize: 12, lineHeight: 16, paddingLeft: sph(4) }}>{hint}</Text> : null}
      {error ? <Text style={{ color: c.danger, fontSize: 12, lineHeight: 16, paddingLeft: sph(4) }}>{error}</Text> : null}
    </View>
  );
}

/** The full-width pill button in deep forest. */
export function AuthButton({ title, onPress, loading, disabled, style, compact }: { title: string; onPress: () => void; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; /** a slimmer button (the Continue and Publish of the create forms) */ compact?: boolean }) {
  const { c } = useTheme();
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={() => {
        tap('Medium');
        onPress();
      }}
      style={({ pressed: p }) => [{ minHeight: sc(BTN.large), borderRadius: BTN.radiusLarge, /* every main action is the same size, `compact` or not (it used to make Continue and Review smaller than Request to join) */ backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center', paddingHorizontal: sph(20), opacity: off ? 0.5 : 1 }, style, !off && pressed(p)]}
    >
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} style={{ color: '#fff', ...BTN.text }}>{loading ? '…' : title}</Text>
    </Pressable>
  );
}

/** "Don't have an account?  Sign up", with a hairline on each side. */
export function AuthSwitch({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const { c } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: sp(10) }}>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
      <Text style={{ color: c.muted, fontSize: 12, flexShrink: 1, textAlign: 'center' }}>{prompt}</Text>
      <Pressable accessibilityRole="link" hitSlop={10} onPress={onPress} style={{ minHeight: sc(32), justifyContent: 'center' }}>
        <Text style={{ color: c.forest, fontSize: 16, fontWeight: '600' }}>{action}</Text>
      </Pressable>
      <View style={{ flex: 1, height: 1, backgroundColor: c.line }} />
    </View>
  );
}

/** The 18+ tick box: the design's small square, with a full-width tap area. */
export function AuthCheck({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  const { c, mode } = useTheme();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked }} onPress={() => onChange(!checked)} style={{ flexDirection: 'row', alignItems: 'center', gap: sp(12), minHeight: sc(44) }}>
      <View style={{ width: sc(20), height: sc(20), borderRadius: sc(4), borderWidth: 1, borderColor: checked ? c.forest : c.muted, backgroundColor: checked ? c.forest : mode === 'there' ? '#fff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {checked ? <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>✓</Text> : null}
      </View>
      <Text style={{ flex: 1, color: c.text, fontSize: 16, lineHeight: 23 }}>{label}</Text>
    </Pressable>
  );
}
