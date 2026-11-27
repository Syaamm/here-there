import AsyncStorage from '@react-native-async-storage/async-storage';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';
import { Text } from '@/components/ScaledText';
import { StepBars } from '@/components/StepMotion';
import { tap } from '@/lib/haptics';
import { useT } from '@/lib/i18n';
import { sc, sp, sph } from '@/lib/scale';
import { useTheme } from '@/lib/theme';

/**
 * The first-time tour on the real screens: the page is dimmed, a rounded spotlight sits on the thing being explained (the HERE | THERE
 * switch, a dock button), and a card says what it is, with Next and Skip. A step with no `id` is a centred card (welcome, the end).
 * Things register themselves with `useCoachRef('id')`; a step whose thing is not on the screen is skipped, so the tour never points at nothing.
 */
export type CoachStep = { id?: string; title: string; text: string; /** a round spotlight of this size (points) centred on the thing, for a thing whose own box is much bigger than what you look at (a dock button) */ size?: number };
type Box = { x: number; y: number; w: number; h: number };
type Node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void };

type Ctx = {
  register: (id: string, node: Node | null) => void;
  /** asks the home page to start the tour as soon as it is in front (after sign-up, or "Show the tour again") */
  requestTour: () => void;
  wanted: boolean;
  /** called by the home page: clears the request and starts the tour */
  begin: (steps: CoachStep[]) => void;
};
const CoachCtx = createContext<Ctx | null>(null);

export function useCoach() {
  const v = useContext(CoachCtx);
  if (!v) throw new Error('useCoach outside CoachProvider');
  return v;
}

/** A ref to put on the thing the tour should point at. Safe anywhere: with no tour it does nothing. */
export function useCoachRef(id?: string) {
  const v = useContext(CoachCtx);
  return useCallback(
    (node: unknown) => {
      if (id && v) v.register(id, (node as Node | null) ?? null);
    },
    [id, v],
  );
}

export function CoachProvider({ children }: { children: ReactNode }) {
  const nodes = useRef(new Map<string, Node>());
  const [steps, setSteps] = useState<CoachStep[] | null>(null);
  const [at, setAt] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [wanted, setWanted] = useState(false);

  const register = useCallback((id: string, node: Node | null) => {
    if (node) nodes.current.set(id, node);
    else nodes.current.delete(id);
  }, []);
  const requestTour = useCallback(() => setWanted(true), []);
  const begin = useCallback((s: CoachStep[]) => {
    setWanted(false);
    setBox(null);
    setAt(0);
    setSteps(s);
  }, []);
  const close = useCallback(() => setSteps(null), []);

  // where the current step's thing is on the screen (measured when the step opens); a thing that is not there is skipped
  useEffect(() => {
    if (!steps) return;
    const step = steps[at];
    if (!step) return close();
    if (!step.id) {
      setBox(null);
      return;
    }
    const node = nodes.current.get(step.id);
    let live = true;
    const skip = () => {
      if (live) setAt((n) => n + 1);
    };
    if (!node) {
      skip();
      return;
    }
    const timer = setTimeout(() => {
      node.measureInWindow((x, y, w, h) => {
        if (!live) return;
        if (!(w > 0 && h > 0)) return skip();
        setBox({ x, y, w, h });
      });
    }, 60);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [steps, at, close]);

  const value = useMemo<Ctx>(() => ({ register, requestTour, wanted, begin }), [register, requestTour, wanted, begin]);
  const step = steps?.[at];
  return (
    <CoachCtx.Provider value={value}>
      {children}
      {steps && step ? <Overlay step={step} index={at} total={steps.length} box={step.id ? box : null} loading={!!step.id && !box} onNext={() => (at + 1 >= steps.length ? close() : setAt(at + 1))} onBack={() => setAt((n) => Math.max(0, n - 1))} onGo={setAt} onSkip={close} /> : null}
    </CoachCtx.Provider>
  );
}

const PAD = 8; // the spotlight is a little bigger than the thing

function Overlay({ step, index, total, box, loading, onNext, onBack, onGo, onSkip }: { step: CoachStep; index: number; total: number; box: Box | null; loading: boolean; onNext: () => void; onBack: () => void; onGo: (i: number) => void; onSkip: () => void }) {
  const { t } = useT();
  const { c } = useTheme();
  const { width: sw, height: sh } = useWindowDimensions();
  const last = index + 1 >= total;
  // swipe left for the next step, right for the one before (the same as the steps of creating an activity); the latest handlers are read when the finger lifts
  const go = useRef({ onNext, onBack });
  go.current = { onNext, onBack };
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_, g) => Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderRelease: (_, g) => {
        if (g.dx < -40) go.current.onNext();
        else if (g.dx > 40) go.current.onBack();
      },
    }),
  ).current;
  const cardW = Math.min(sw - 32, 360);
  const d = step.size ? sc(step.size) : 0;
  const spot = box ? (d ? { x: box.x + box.w / 2 - d / 2, y: box.y + box.h / 2 - d / 2, w: d, h: d } : { x: box.x - PAD, y: box.y - PAD, w: box.w + PAD * 2, h: box.h + PAD * 2 }) : null;
  // the card sits under the spotlight, or over it when the thing is in the lower half of the screen (the dock)
  const above = !!spot && spot.y + spot.h / 2 > sh / 2;
  const left = spot ? Math.max(16, Math.min(sw - 16 - cardW, spot.x + spot.w / 2 - cardW / 2)) : (sw - cardW) / 2;
  const place = !spot ? { top: Math.max(sh * 0.3, 80) } : above ? { bottom: sh - spot.y + 14 } : { top: spot.y + spot.h + 14 };
  return (
    <Modal visible transparent statusBarTranslucent animationType="fade" onRequestClose={onSkip}>
      <View style={StyleSheet.absoluteFill} {...pan.panHandlers}>
        <Svg width={sw} height={sh} style={StyleSheet.absoluteFill} pointerEvents="none">
          <Defs>
            <Mask id="coach-cut">
              <Rect x={0} y={0} width={sw} height={sh} fill="white" />
              {spot ? <Rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx={d ? d / 2 : Math.min(Math.min(spot.w, spot.h) / 2, sc(28))} fill="black" /> : null}
            </Mask>
          </Defs>
          <Rect x={0} y={0} width={sw} height={sh} fill="rgba(8,24,20,0.72)" mask="url(#coach-cut)" />
        </Svg>
        {/* the dimmed screen takes the touches: the tour is read, not tapped through (Next or Skip) */}
        <Pressable accessible={false} style={StyleSheet.absoluteFill} onPress={() => undefined} />
        {loading ? null : (
          <View accessibilityViewIsModal style={[{ position: 'absolute', left, width: cardW, backgroundColor: c.surface, borderRadius: sc(18), padding: sp(16), gap: sp(8) }, place]}>
            {/* the steps: tap a bar to jump to it (back or forward), or swipe the card */}
            <View style={{ marginVertical: sp(6) }}>
              <StepBars step={index} count={total} track={c.sand} fill={c.forest} onPick={onGo} />
            </View>
            <Text style={{ color: c.muted, fontSize: 12, fontWeight: '600', letterSpacing: 0.4 }}>{t('{n} of {total}', { n: index + 1, total })}</Text>
            <Text accessibilityRole="header" style={{ color: c.text, fontSize: 18, lineHeight: 24, fontWeight: '700' }}>{step.title}</Text>
            <Text style={{ color: c.text, fontSize: 15, lineHeight: 22 }}>{step.text}</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: sp(6) }}>
              {last ? <View /> : (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={onSkip} style={{ minHeight: sc(44), justifyContent: 'center', paddingRight: sph(12) }}>
                  <Text style={{ color: c.muted, fontSize: 15, fontWeight: '600' }}>{t('Skip tour')}</Text>
                </Pressable>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: sph(8) }}>
              {index > 0 ? (
                <Pressable accessibilityRole="button" hitSlop={8} onPress={onBack} style={{ minHeight: sc(44), justifyContent: 'center', paddingHorizontal: sph(10) }}>
                  <Text style={{ color: c.forest, fontSize: 15, fontWeight: '600' }}>{t('Back')}</Text>
                </Pressable>
              ) : null}
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  tap('Light');
                  onNext();
                }}
                style={({ pressed }) => [{ minHeight: sc(44), minWidth: sc(110), paddingHorizontal: sph(20), borderRadius: sc(22), backgroundColor: c.forest, alignItems: 'center', justifyContent: 'center' }, pressed && { opacity: 0.88 }]}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{last ? t('Done') : t('Next')}</Text>
              </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

/**
 * The first time a step-by-step form opens (HERE: host an activity; THERE: plan a trip), once per phone for each: a cue on its step bars
 * says how to move between the steps. Put the returned ref on the bars (`rootRef`). Settings > Show the tour again brings the cues back.
 */
export function useStepsCue() {
  const { t } = useT();
  const { mode } = useTheme();
  const ref = useCoachRef('wizard-steps');
  const { begin } = useCoach();
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = `ht_cue_steps_${mode}`;
    AsyncStorage.getItem(key).then(
      (seen) => {
        if (!live || seen === '1') return;
        AsyncStorage.setItem(key, '1').catch(() => undefined);
        timer = setTimeout(
          () =>
            begin([
              {
                id: 'wizard-steps',
                title: t('Moving between the steps'),
                text: t('Tap a bar to jump to a step you have done, or swipe the page: left for the next step (once this one is filled in) and right to go back.'),
              },
            ]),
          900,
        );
      },
      () => undefined,
    );
    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}
