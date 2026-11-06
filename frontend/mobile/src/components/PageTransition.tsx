import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The dock tabs used to rise and fade in when you arrived at one from another. That entrance is off (a page is simply there
 * the moment its tab opens). The old version is in git history if it is wanted back. Pages opened from other pages are still
 * slid in and out by the system stack.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  return <View style={{ flex: 1 }}>{children}</View>;
}
