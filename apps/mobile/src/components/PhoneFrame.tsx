import type { ReactNode } from 'react';

/** On phones the app simply fills the screen. (The browser version is PhoneFrame.web.tsx.) */
export function PhoneFrame({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
