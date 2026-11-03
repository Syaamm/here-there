import type { ReactNode } from 'react';
import { Icon } from './ui';
import './Login.css';

/**
 * The split-screen frame of every screen before the console opens (sign-in, choosing a password, two-step setup): a deep green brand
 * panel on the left with a short promise, and the beige page with the actual form on the right. On a phone the panel shrinks
 * to a slim header with the wordmark.
 */
export function AuthShell({ headline, sub, children }: { headline: ReactNode; sub: string; children: ReactNode }) {
  return (
    <div className="lg-split">
      <aside className="lg-panel" aria-label="HERE and THERE admin console">
        <div className="lg-glow" aria-hidden="true" />
        <div className="lg-rings" aria-hidden="true" />
        <div className="lg-dots" aria-hidden="true" />
        <div className="lg-mark">
          HERE<span>.</span> / THERE<span>.</span>
        </div>
        <div className="lg-pitch">
          <p className="lg-eyebrow">Admin console</p>
          <h2 className="lg-headline">{headline}</h2>
          <p className="lg-lede">{sub}</p>
          <ul className="lg-points">
            {['Every action is recorded in the audit log', 'Two-step sign-in protects every account', 'You see only what your role covers'].map((t) => (
              <li key={t}>
                <span className="lg-tick" aria-hidden="true">
                  <Icon name="check" />
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>
        <p className="lg-foot">Staff only · HERE &amp; THERE</p>
      </aside>
      <main className="lg-right">{children}</main>
    </div>
  );
}
