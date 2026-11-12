import type { TextStyle } from 'react-native';

/**
 * The writing sizes the newer screens use (the map's hints and filters, the results page...), so they read like the rest of the
 * app: the same numbers the older screens write out by hand (a title 24, a card title 17, body 14, a button or label 13, a caption
 * 12). Like every size here they are drawn through the app's scale (lib/scale), which follows the person's Text size choice and
 * the phone's own Large Text setting.
 *
 * `type.body` is a whole style (size, line height, weight) to spread into a text: `style={[type.body, { color: c.muted }]}`.
 * `FS` and `LH` are the bare numbers, for texts that keep their own weight.
 */
export const type = {
  appTitle: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  cardTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  button: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
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
