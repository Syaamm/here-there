import { useState, type FormEvent } from 'react';
import { post, saveSession, setRefreshToken, setToken, type Session } from '../api';
import { AuthShell } from '../AuthShell';
import { errMsg, ErrorBanner, Icon } from '../ui';

const MIN = 10; // the same minimum the server asks for

/** A password box with its own show / hide eye. */
function PasswordField({ label, value, onChange, autoComplete, autoFocus }: { label: string; value: string; onChange: (v: string) => void; autoComplete: string; autoFocus?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <label className="lg-field">
      {label}
      <span className="lg-pass">
        <input type={show ? 'text' : 'password'} autoComplete={autoComplete} required autoFocus={autoFocus} value={value} onChange={(e) => onChange(e.target.value)} />
        <button type="button" className="lg-eye" onClick={() => setShow(!show)} aria-label={show ? 'Hide password' : 'Show password'} aria-pressed={show}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {show ? (
              <>
                <path d="M3 3l18 18" />
                <path d="M10.6 6.2A9.9 9.9 0 0 1 12 6c5 0 8.5 4.2 9.5 6a11 11 0 0 1-2.6 3.1M6.3 7.6A11 11 0 0 0 2.5 12c1 1.8 4.5 6 9.5 6 1.5 0 2.8-.4 4-1M9.9 9.9a3 3 0 0 0 4.2 4.2" />
              </>
            ) : (
              <>
                <path d="M2.5 12S6 6 12 6s9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
                <circle cx="12" cy="12" r="3" />
              </>
            )}
          </svg>
        </button>
      </span>
    </label>
  );
}

/**
 * Shown once, the first time someone signs in to an account an administrator made for them: the administrator gave them a
 * temporary password, and nothing in the console opens until they have chosen their own. The server clears the flag with the
 * first password change, so it is never asked again (not at the next sign-in, not after two-step setup).
 */
export function ChoosePassword({ session, onDone, onSignOut }: { session: Session; onDone: (s: Session) => void; onSignOut: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const problem = next && next.length < MIN ? `Use at least ${MIN} characters.` : next && next === current ? 'Choose a password different from the temporary one.' : again && again !== next ? 'The two new passwords are not the same.' : null;
  const ready = !!current && next.length >= MIN && next !== current && next === again;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    try {
      // the server signs this device in again with the new password (every other sign-in ends)
      const r = await post<{ token: string; refreshToken: string }>('/v1/me/password', { currentPassword: current, newPassword: next });
      const s: Session = { ...session, token: r.token, refreshToken: r.refreshToken };
      setToken(s.token);
      setRefreshToken(s.refreshToken ?? null);
      saveSession(s);
      onDone(s);
    } catch (err) {
      setError(errMsg(err));
      setBusy(false);
    }
  };

  return (
    <AuthShell headline="Make this account yours." sub="Your administrator gave you a temporary password. Choose your own now; you will not be asked again.">
      <form className="lg-card" onSubmit={submit}>
        <p className="lg-card-eyebrow">First sign-in</p>
        <h1 className="lg-title">Choose your password</h1>
        <p className="lg-sub">Type the temporary password you were given, then a new one only you know.</p>
        <ErrorBanner message={error} />
        <div className="lg-form">
          <PasswordField label="Temporary password" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
          <PasswordField label="New password" value={next} onChange={setNext} autoComplete="new-password" />
          <PasswordField label="New password again" value={again} onChange={setAgain} autoComplete="new-password" />
        </div>
        <p className="lg-note" role={problem ? 'alert' : undefined}>
          {problem ?? `At least ${MIN} characters. A phrase of a few words works well.`}
        </p>
        <button className="lg-btn" disabled={busy || !ready}>
          {busy ? 'Saving…' : 'Save and continue'}
          {!busy && <Icon name="arrow" />}
        </button>
        <button type="button" className="lg-link" onClick={onSignOut}>
          Sign out
        </button>
      </form>
    </AuthShell>
  );
}
