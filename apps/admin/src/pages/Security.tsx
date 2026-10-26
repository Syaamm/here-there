import { useState, type FormEvent } from 'react';
import { api } from '../api';
import { errMsg, ErrorBanner, Page } from '../ui';

type Status = { enabled: boolean; required: boolean; recoveryCodesLeft: number };

/**
 * Two-step sign-in: set it up with an authenticator app, see the recovery codes once, and (where allowed) turn it off.
 * `forced` is the page shown on its own, before anything else, when the account must have it on to use the console.
 */
export function SecurityPage({ status, onChanged, forced }: { status: Status; onChanged: () => void; forced?: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  const start = () => run(async () => setSetup(await api('POST', '/v1/me/mfa/setup')));
  const enable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/v1/me/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api('DELETE', '/v1/me/mfa', { password, code });
      setPassword('');
      setCode('');
      onChanged();
    });
  };

  const body = codes ? (
    <div className="card" style={{ maxWidth: 520, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Two-step sign-in is on</h2>
      <p className="muted">
        Keep these recovery codes somewhere safe, such as a password manager. Each works once if you lose your phone. <strong>They will not be shown again.</strong>
      </p>
      <ul style={{ columns: 2, listStyle: 'none', padding: 0, margin: 0, fontFamily: 'monospace', fontSize: '1rem', display: 'grid', gap: 6 }} aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <button className="btn primary" onClick={() => (setCodes(null), onChanged())}>
        I have saved them
      </button>
    </div>
  ) : status.enabled ? (
    <form className="card" onSubmit={disable} style={{ maxWidth: 520, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Two-step sign-in is on</h2>
      <p className="muted">{status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.</p>
      {status.required ? (
        <p className="muted">Staff accounts must keep this on. If you lose your phone and your recovery codes, an administrator can reset it for you.</p>
      ) : (
        <>
          <label>
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label>
            Code from your app (or a recovery code)
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <button className="btn danger" disabled={busy}>
            Turn off two-step sign-in
          </button>
        </>
      )}
    </form>
  ) : setup ? (
    <form className="card" onSubmit={enable} style={{ maxWidth: 520, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Add it to your authenticator app</h2>
      <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6 }}>
        <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
        <li>
          Choose "Enter a setup key" and type this key: <code style={{ fontSize: '1.05rem', letterSpacing: 1, wordBreak: 'break-all' }}>{setup.secret}</code>
        </li>
        <li>
          On a phone with the app installed you can also <a href={setup.otpauthUri}>open it directly</a>.
        </li>
        <li>Type the 6-digit code the app now shows:</li>
      </ol>
      <label>
        6-digit code
        <input inputMode="numeric" autoComplete="one-time-code" required autoFocus pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button className="btn primary" disabled={busy || code.length !== 6}>
        Turn on two-step sign-in
      </button>
    </form>
  ) : (
    <div className="card" style={{ maxWidth: 520, display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0, fontSize: '1.05rem' }}>{forced ? 'Set up two-step sign-in to continue' : 'Two-step sign-in is off'}</h2>
      <p className="muted">After your password you will also type a 6-digit code from an authenticator app. It protects the console, and everyone's data in it, if your password is ever stolen.</p>
      <button className="btn primary" onClick={start} disabled={busy}>
        Set it up
      </button>
    </div>
  );

  return (
    <Page title="Security" sub={forced ? 'This account needs two-step sign-in before it can use the console.' : 'Your own sign-in'}>
      <ErrorBanner message={error} />
      {body}
    </Page>
  );
}
