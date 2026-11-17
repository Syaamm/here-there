import { can, type Session } from '../api';
import { Chip, Icon, Page } from '../ui';
import { CategoriesPanel } from './Categories';
import { LimitCard } from './Limit';

/**
 * Settings opens here. Planning: one card for Here (activities) on the left and one for There (trips) on the right, each holding
 * that side's planning window and its categories. Security: two-step sign-in, a plain on / off choice (its own page).
 */
export function SettingsHome({ me, security, mfaOn, go }: { me: Session; security: boolean; mfaOn: boolean | null; go: (tab: string, focus?: string) => void }) {
  const planning = can.admin(me.role);
  return (
    <Page fill title="Settings">
      {planning && (
        <section className="set-planning" aria-label="Planning">
          <div className="set-grid">
            <CategoriesPanel kind="here" limit={<LimitCard me={me} side="here" />} />
            <CategoriesPanel kind="there" limit={<LimitCard me={me} side="there" />} />
          </div>
        </section>
      )}
      {security && (
        <section aria-label="Security">
          <div className="set-security">
            <span className="set-security-icon">
              <Icon name="shield" />
            </span>
            <div className="set-security-text">
              <span className="set-security-title">
                Two-step sign-in
                {mfaOn !== null && <Chip value={mfaOn ? 'On' : 'Off'} tone={mfaOn ? 'ok' : 'plain'} />}
              </span>
              <p>Ask for a code from your phone as well as your password. You’ll also get recovery codes in case you lose your phone.</p>
            </div>
            <button type="button" className={mfaOn ? 'btn' : 'btn primary'} onClick={() => go('security', mfaOn ? undefined : 'setup')}>
              {mfaOn ? 'Manage' : 'Turn on'}
            </button>
          </div>
        </section>
      )}
    </Page>
  );
}
