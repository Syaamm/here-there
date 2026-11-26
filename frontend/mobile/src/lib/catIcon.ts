import type Ionicons from '@expo/vector-icons/Ionicons';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * The icon drawn for a category that has no photo. Categories are managed by the admins and carry an emoji in their data; the app
 * never draws that emoji, it draws the matching icon of the app's own set (and a plain tag for one it does not know).
 */
const BY_EMOJI: Record<string, IconName> = {
  '☕': 'cafe-outline',
  '🍸': 'wine-outline',
  '🍷': 'wine-outline',
  '🍺': 'beer-outline',
  '🍽': 'restaurant-outline',
  '🍕': 'pizza-outline',
  '🏃': 'walk-outline',
  '⚽': 'football-outline',
  '🏀': 'basketball-outline',
  '🚴': 'bicycle-outline',
  '🎨': 'color-palette-outline',
  '🎭': 'ticket-outline',
  '🎵': 'musical-notes-outline',
  '🎶': 'musical-notes-outline',
  '🎮': 'game-controller-outline',
  '📚': 'book-outline',
  '🧗': 'trail-sign-outline',
  '🌿': 'leaf-outline',
  '🌲': 'leaf-outline',
  '🏖': 'sunny-outline',
  '🏔': 'trail-sign-outline',
  '📷': 'camera-outline',
  '✈': 'airplane-outline',
  '🏛': 'business-outline',
  '🧘': 'body-outline',
  '🐶': 'paw-outline',
};

const BY_KEY: Record<string, IconName> = {
  coffee: 'cafe-outline',
  drinks: 'wine-outline',
  food: 'restaurant-outline',
  sports: 'walk-outline',
  culture: 'color-palette-outline',
  adventure: 'trail-sign-outline',
  nature: 'leaf-outline',
  beach: 'sunny-outline',
  photography: 'camera-outline',
};

/** `key` is the category's own key when the caller has it; `emoji` is what its data carries (the part before the variation selector decides). */
export function catIcon(emoji?: string | null, key?: string): IconName {
  const k = (key ?? '').replace(/^there:/, '');
  if (BY_KEY[k]) return BY_KEY[k];
  const first = Array.from((emoji ?? '').replace(/️/g, ''))[0] ?? '';
  return BY_EMOJI[first] ?? 'pricetag-outline';
}
