import type { TextStyle } from 'react-native';

/**
 * The app's writing sizes, from the design's Typography page (Inter): the five styles every text uses.
 *
 *   App title   22 / 700      Card title  20 / 500      Body  16 / 400      Button  16 / 500      Caption  12 / 400
 *
 * (the weights of the type guide: Regular 400, Medium 500, Semibold 600, Bold 700). Like every size here they are drawn through the
 * app's scale (lib/scale): the phone's width, the person's Text size choice and the phone's own Large Text setting.
 *
 * `type.body` is a whole style (size, line height, weight) to spread into a text: `style={[type.body, { color: c.muted }]}`.
 * `FS` and `LH` are the bare numbers, for texts that keep their own weight.
 */
export const type = {
  appTitle: { fontSize: 22, lineHeight: 28, fontWeight: '700' },
  cardTitle: { fontSize: 20, lineHeight: 26, fontWeight: '500' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 22, fontWeight: '500' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '400' },
} as const satisfies Record<string, TextStyle>;

export type TypeStyle = keyof typeof type;

export const FS = {
  appTitle: type.appTitle.fontSize,
  cardTitle: type.cardTitle.fontSize,
  body: type.body.fontSize,
  button: type.button.fontSize,
  caption: type.caption.fontSize,
} as const;
export const LH = {
  appTitle: type.appTitle.lineHeight,
  cardTitle: type.cardTitle.lineHeight,
  body: type.body.lineHeight,
  button: type.button.lineHeight,
  caption: type.caption.lineHeight,
} as const;
