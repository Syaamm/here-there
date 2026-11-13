/**
 * The only button and pill sizes in the app. Every button of a kind is drawn at the same size on every screen:
 * - large: the main action of a screen or form (Save changes, Sign out, Sign in)
 * - small: a secondary action, or a button next to others (Continue, Publish, Change photo)
 * - pill: filters, choices and toggles (interests, categories, days)
 * Text on all of them is the Button style (lib/type): 16 / 500.
 */
export const BTN = {
  large: 54,
  small: 44,
  pill: 40,
  radiusLarge: 32,
  radiusSmall: 22,
  radiusPill: 20,
  text: { fontSize: 16, fontWeight: '500' as const },
};
