import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse, G, Path } from 'react-native-svg';

/**
 * The opening animation: the LAMIS dot (as on the app icon) crouches, hops across the word, and each landing pops a letter
 * up (a, m, i, s) while the monogram's "l" reshapes into the wordmark's "l". Ported from the approved film; time `t` is in
 * the film's seconds, so every number below is the film's own.
 */

// --- the logo, in the film's units (1920 x 1080 stage) ---
const L_MONO = [0,184.423,15.0374,0,6.7325,6.74788,0,15.0718,0,39.5865,47.9104,0,54.6583,6.73249,54.6583,15.0374,184.423,55.9834,188.72,62.5094,196.917,80,195.331,234,57.6397,31.7892,233.008,2.96972,225.076,0,184.423];
const L_WORD = [0,216.504,13.081,0,5.85657,5.85657,0,13.081,0,38.3105,45.5345,0.0006,51.3915,5.85694,51.3915,13.081,216.504,52.6383,221.549,58.7735,231.169,75.2159,229.307,274.701,54.1923,29.888,273.537,2.79258,264.226,0,216.504];
const L_IS_Y = [0,1,1,0,1,0,1,0,1,0,0,1,0,1,0,1,1,0,1,0,1,0,1,1,0,0,1,0,1,0,1];
const MONO_DY = 40.7;
const A = L_MONO.map((v, i) => v + (L_IS_Y[i] ? MONO_DY : 0));
const f3 = (n: number) => n.toFixed(3);
function lPath(P: number[]) {
  const c = (i: number) => 'C' + [0, 1, 2, 3, 4, 5].map((k) => f3(P[i + k])).join(' ');
  return 'M' + f3(P[0]) + ' ' + f3(P[1]) + 'V' + f3(P[2]) + c(3) + 'H' + f3(P[9]) + c(10) + 'V' + f3(P[16]) + c(17) + 'V' + f3(P[23]) + 'H' + f3(P[24]) + c(25) + 'Z';
}

const LETTERS = [
  { id: 'a', x0: 99.8, x1: 258.0, d: 'M161.174 275.131C149.556 275.131 139.092 273.062 129.781 268.924C120.55 264.707 113.229 258.5 107.818 250.303C102.486 242.107 99.8203 232.001 99.8203 219.984C99.8203 209.639 101.73 201.085 105.55 194.321C109.37 187.557 114.582 182.145 121.187 178.087C127.792 174.029 135.232 170.965 143.508 168.896C151.864 166.747 160.498 165.196 169.411 164.241C180.153 163.127 188.867 162.132 195.552 161.256C202.236 160.302 207.09 158.869 210.114 156.959C213.218 154.97 214.77 151.906 214.77 147.768V147.052C214.77 138.06 212.104 131.097 206.772 126.163C201.44 121.229 193.761 118.762 183.734 118.762C173.151 118.762 164.755 121.07 158.548 125.685C152.421 130.301 148.283 135.752 146.134 142.039L105.789 136.309C108.972 125.168 114.224 115.858 121.545 108.377C128.866 100.818 137.818 95.1676 148.402 91.4275C158.986 87.6078 170.684 85.698 183.496 85.698C192.329 85.698 201.122 86.7325 209.876 88.8015C218.629 90.8705 226.627 94.2923 233.868 99.0669C241.11 103.762 246.919 110.168 251.295 118.285C255.752 126.402 257.98 136.548 257.98 148.723V271.431H216.441V246.245H215.008C212.382 251.338 208.682 256.112 203.907 260.569C199.212 264.945 193.284 268.487 186.122 271.192C179.039 273.818 170.724 275.131 161.174 275.131ZM172.395 243.38C181.069 243.38 188.589 241.669 194.955 238.247C201.321 234.746 206.215 230.13 209.637 224.401C213.138 218.671 214.889 212.425 214.889 205.661V184.055C213.536 185.169 211.228 186.204 207.966 187.159C204.783 188.114 201.202 188.949 197.223 189.666C193.244 190.382 189.305 191.018 185.406 191.575C181.506 192.132 178.124 192.61 175.259 193.008C168.814 193.883 163.044 195.315 157.951 197.305C152.858 199.294 148.84 202.08 145.895 205.661C142.951 209.162 141.479 213.698 141.479 219.268C141.479 227.226 144.384 233.234 150.193 237.292C156.002 241.351 163.402 243.38 172.395 243.38Z' },
  { id: 'm', x0: 301.4, x1: 559.3, d: 'M301.429 271.431V88.0853H342.73V119.24H344.878C348.698 108.736 355.024 100.539 363.857 94.6504C372.69 88.6821 383.234 85.698 395.489 85.698C407.903 85.698 418.368 88.7219 426.882 94.7698C435.477 100.738 441.525 108.895 445.026 119.24H446.936C450.994 109.054 457.838 100.937 467.467 94.8891C477.175 88.7617 488.674 85.698 501.963 85.698C518.834 85.698 532.601 91.0296 543.264 101.693C553.927 112.356 559.259 127.914 559.259 148.365V271.431H515.929V155.049C515.929 143.67 512.905 135.354 506.857 130.102C500.81 124.77 493.409 122.105 484.655 122.105C474.231 122.105 466.074 125.367 460.185 131.893C454.376 138.338 451.472 146.734 451.472 157.079V271.431H409.097V153.259C409.097 143.789 406.232 136.229 400.503 130.579C394.853 124.93 387.452 122.105 378.301 122.105C372.094 122.105 366.444 123.696 361.351 126.879C356.258 129.983 352.199 134.399 349.175 140.129C346.151 145.779 344.639 152.384 344.639 159.943V271.431H301.429Z' },
  { id: 'i', x0: 599.8, x1: 649.9, d: 'M603.096 271.431V88.0853H646.306V271.431H603.096ZM624.821 62.0636C617.977 62.0636 612.088 59.7956 607.154 55.2597C602.221 50.6442 599.754 45.1136 599.754 38.6679C599.754 32.1425 602.221 26.6119 607.154 22.076C612.088 17.4606 617.977 15.1528 624.821 15.1528C631.744 15.1528 637.633 17.4606 642.487 22.076C647.42 26.6119 649.887 32.1425 649.887 38.6679C649.887 45.1136 647.42 50.6442 642.487 55.2597C637.633 59.7956 631.744 62.0636 624.821 62.0636Z' },
  { id: 's', x0: 682.6, x1: 839.6, d: 'M835.65 136.548L796.26 140.845C795.146 136.866 793.196 133.126 790.411 129.625C787.705 126.123 784.044 123.298 779.429 121.15C774.814 119.001 769.164 117.927 762.479 117.927C753.487 117.927 745.927 119.876 739.8 123.776C733.752 127.675 730.768 132.728 730.847 138.935C730.768 144.267 732.717 148.604 736.696 151.946C740.755 155.288 747.439 158.034 756.75 160.182L788.023 166.867C805.371 170.607 818.263 176.535 826.698 184.652C835.213 192.769 839.51 203.393 839.589 216.523C839.51 228.061 836.128 238.247 829.443 247.08C822.838 255.834 813.647 262.678 801.87 267.611C790.092 272.545 776.564 275.012 761.285 275.012C738.845 275.012 720.781 270.317 707.093 260.927C693.406 251.457 685.249 238.287 682.623 221.417L724.76 217.358C726.669 225.634 730.728 231.881 736.935 236.099C743.142 240.316 751.219 242.425 761.166 242.425C771.432 242.425 779.668 240.316 785.875 236.099C792.161 231.881 795.305 226.669 795.305 220.462C795.305 215.21 793.275 210.873 789.217 207.451C785.238 204.029 779.031 201.403 770.596 199.573L739.322 193.008C721.736 189.347 708.725 183.18 700.29 174.506C691.854 165.753 687.677 154.691 687.756 141.322C687.677 130.022 690.74 120.234 696.947 111.958C703.234 103.603 711.948 97.1571 723.088 92.6212C734.309 88.0057 747.24 85.698 761.882 85.698C783.368 85.698 800.278 90.2737 812.613 99.425C825.027 108.576 832.706 120.951 835.65 136.548Z' },
];

// --- the film's motion ---
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
const seg = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const eio = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const eob = (p: number, s = 1.70158) => 1 + (s + 1) * Math.pow(p - 1, 3) + s * Math.pow(p - 1, 2);

const XS = [128.5, 179, 430, 625, 761, 908.684];
const HOP_H = [120, 150, 95, 120, 165];
const T0 = 0.95, D = 0.36, TEND = T0 + 5 * D;
const LAND = [1, 2, 3, 4].map((j) => T0 + j * D);

function dotAt(t: number) {
  const g = seg(t, T0, TEND);
  let x: number, arc = 0, vy = 0;
  if (t <= T0) x = XS[0];
  else if (t >= TEND) x = XS[5];
  else {
    const k = Math.min(4, Math.floor((t - T0) / D));
    const p = clamp01((t - T0 - k * D) / D);
    x = lerp(XS[k], XS[k + 1], p * 0.8 + eio(p) * 0.2);
    arc = HOP_H[k] * 4 * p * (1 - p);
    vy = (HOP_H[k] * 4 * (1 - 2 * p)) / D;
  }
  return { x, arc, vy, base: lerp(278.7, 271.43, g), r: lerp(32, 37.6079, g) };
}

/** Where the film's own time stops mattering: the dot has settled and the last letter is up. */
const FILM_END = 3.3;
/** The film runs a little faster on the phone, so opening the app never feels slow. */
const SPEED = 1.2;
export const SPLASH_SECONDS = FILM_END / SPEED;

/** A scale then a shift as an SVG matrix string. */
const mat = (a: number, d: number, e: number, f: number) => `matrix(${a} 0 0 ${d} ${e} ${f})`;

function mix(a: string, b: string, p: number) {
  const h = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const c = [0, 1, 2].map((i) => Math.round(lerp(h(a, i), h(b, i), p)));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

export function SplashLogo({ ink, dot = '#9CB397', dotEnd = '#859B7A', onDone }: { ink: string; dot?: string; dotEnd?: string; onDone?: () => void }) {
  const [t, setT] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    let raf = 0;
    let finished = false;
    const start = Date.now();
    const tick = () => {
      const now = ((Date.now() - start) / 1000) * SPEED;
      setT(Math.min(now, FILM_END));
      if (now >= FILM_END) {
        if (!finished) {
          finished = true;
          done.current?.();
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const { width } = useWindowDimensions();
  const w = Math.min(width, 560);
  const h = (w * 1080) / 1920;

  // camera: from the monogram, close and centred, out to the whole word
  const c = eio(seg(t, 0.9, 2.9));
  const cx = lerp(80, 473.5, c), cy = lerp(160, 138, c);
  const s = lerp(2.3, 1.3, c) * (1 + 0.012 * seg(t, 0, 1)) * (1 + 0.022 * eio(seg(t, 2.6, 4.2)));
  const cam = mat(s, s, 960 - s * cx, 540 - s * cy);

  // the l reshapes from the monogram's into the wordmark's
  const m = eio(seg(t, 1.0, 2.3));
  const lD = lPath(A.map((v, i) => lerp(v, L_WORD[i], m)));

  // the dot: crouch, four hops, a last big hop home
  const d = dotAt(t);
  const crouch = Math.sin(Math.PI * seg(t, 0.55, 0.97));
  let contact = 0;
  for (const L of LAND) contact = Math.max(contact, 1 - Math.abs(t - L) / 0.06);
  contact = clamp01(contact);
  const fin = seg(t, TEND - 0.02, TEND + 0.5);
  const settle = fin > 0 && fin < 1 ? Math.sin(Math.PI * 3 * fin) * Math.pow(1 - fin, 2) : 0;
  const stretch = Math.min(0.14, Math.abs(d.vy) / 11000);
  const breathe = 1 + 0.01 * Math.sin((2 * Math.PI * t) / 3);
  const squash = 0.1 * crouch + 0.14 * contact + 0.16 * settle;
  const sx = (1 + squash - stretch * 0.6) * breathe;
  const sy = (1 - squash + stretch) * breathe;
  const y = d.base - d.arc;
  const dotM = mat(sx, sy, d.x, y - sy * d.r);
  const fill = mix(dot, dotEnd, eio(seg(t, 2.4, 3.0)));

  // a soft shadow on the baseline that shrinks as the dot rises
  const lift = clamp01(d.arc / 165);
  const shadowOp = lerp(0.8, 0.3, lift) * seg(t, 0.4, 0.9) * (1 - seg(t, TEND, TEND + 0.4)) * 0.3;

  // a light smear behind the dot while it flies fast
  const sp = Math.abs(dotAt(t + 0.01).x - dotAt(t - 0.01).x) / 0.02;
  const trail = [0, 1].map((k) => {
    const e = dotAt(t - 0.03 * (k + 1));
    return { cx: e.x, cy: e.base - e.arc - e.r, r: e.r * 0.95, op: clamp01(sp / 1600) * (k ? 0.1 : 0.22) };
  });

  return (
    <View style={{ width: w, height: h }} accessibilityRole="image" accessibilityLabel="LAMIS">
      <Svg width={w} height={h} viewBox="0 0 1920 1080">
        <G transform={cam}>
          <Ellipse cx={d.x} cy={d.base + 4} rx={d.r * lerp(1.05, 0.55, lift)} ry={6} fill={dot} opacity={shadowOp} />
          {LETTERS.map((L, i) => {
            const at = LAND[i];
            const p = seg(t, at, at + 0.42);
            const e = p > 0 ? eob(p, 1.8) : 0;
            const lsy = lerp(0.05, 1, e), lsx = lerp(0.75, 1, e);
            const cxL = (L.x0 + L.x1) / 2;
            return (
              <G key={L.id} opacity={clamp01(p * 5)} transform={mat(lsx, lsy, cxL - lsx * cxL, 271.43 - lsy * 271.43)}>
                <Path d={L.d} fill={ink} />
              </G>
            );
          })}
          <Path d={lD} fill={ink} />
          {trail.map((e, k) => (
            <Circle key={k} cx={e.cx} cy={e.cy} r={e.r} fill={fill} opacity={e.op} />
          ))}
          <G transform={dotM}>
            <Circle cx={0} cy={0} r={d.r} fill={fill} />
          </G>
        </G>
      </Svg>
    </View>
  );
}
