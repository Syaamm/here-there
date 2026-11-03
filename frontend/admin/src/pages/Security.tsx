import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errMsg, ErrorBanner, Page } from '../ui';
import './Security.css';

/** The setup QR code, drawn here in the browser: the secret in it never goes to any outside service. It stays dark on white so apps can read it. */
function SetupQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { width: 224, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#12302b', light: '#ffffff' } }).then((d) => live && setSrc(d), () => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return (
    <div className="sc-qr">
      {src ? <img src={src} width={224} height={224} alt="QR code to scan with your authenticator app" /> : <span className="spinner" role="status" aria-label="Making the QR code" />}
    </div>
  );
}

type Status = { enabled: boolean; required: boolean; setupNeeded?: boolean; canSkip?: boolean; recoveryCodesLeft: number };

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
  const [copied, setCopied] = useState(false);

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
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1800)));
  };

  const body = codes ? (
    <div className="sc-card">
      <div className="sc-head">
        <span className="sc-status">
          <span className="sc-dot" aria-hidden="true" />
          Two-step sign-in is on
        </span>
      </div>
      <h2 className="sc-title">Save your recovery codes</h2>
      <p className="sc-lead">Keep these somewhere safe, such as a password manager. Each works once if you lose your phone.</p>
      <ul className="sc-codes" aria-label="Recovery codes">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <p className="sc-warn">
        <strong>They will not be shown again.</strong>
      </p>
      <div className="sc-actions">
        <button className="sc-btn ghost" type="button" onClick={() => copy(codes.join('\n'))}>
          {copied ? 'Copied' : 'Copy all'}
        </button>
        <button className="sc-btn" onClick={() => (setCodes(null), onChanged())}>
          I have saved them
        </button>
      </div>
    </div>
  ) : status.enabled ? (
    <form className="sc-card" onSubmit={disable}>
      <div className="sc-head">
        <span className="sc-status">
          <span className="sc-dot" aria-hidden="true" />
          Two-step sign-in is on
        </span>
      </div>
      <p className="sc-lead">
        {status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.
      </p>
      {status.required ? (
        <p className="sc-lead">Staff accounts must keep this on. If you lose your phone and your recovery codes, an administrator can reset it for you.</p>
      ) : (
        <>
          <label className="sc-field">
            Password
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <label className="sc-field">
            Code from your app (or a recovery code)
            <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
          </label>
          <div className="sc-actions">
            <button className="sc-btn danger" disabled={busy}>
              Turn off two-step sign-in
            </button>
          </div>
        </>
      )}
    </form>
  ) : setup ? (
    <form className="sc-card" onSubmit={enable}>
      <div className="sc-head">
        <h2 className="sc-title">Add it to your authenticator app</h2>
      </div>
      <ol className="sc-steps">
        <li className="sc-step">
          <span className="sc-num" aria-hidden="true">
            1
          </span>
          <div>
            <h3>Scan the QR code</h3>
            <p>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), choose “Scan a QR code”, and point it at this.</p>
            <SetupQr uri={setup.otpauthUri} />
            <div className="sc-key">
              <small>Cannot scan it? Setup key</small>
              <code>{setup.secret}</code>
              <button type="button" className="sc-copy" onClick={() => copy(setup.secret)}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <a className="sc-direct" href={setup.otpauthUri}>
              Open it directly on this device
            </a>
          </div>
        </li>
        <li className="sc-step">
          <span className="sc-num" aria-hidden="true">
            2
          </span>
          <div>
            <h3>Type the 6-digit code</h3>
            <p>The app now shows a code that changes every 30 seconds.</p>
            <input className="sc-input" aria-label="6-digit code" inputMode="numeric" autoComplete="one-time-code" required autoFocus pattern="\d{6}" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          </div>
        </li>
      </ol>
      <div className="sc-actions">
        <button className="sc-btn" disabled={busy || code.length !== 6}>
          Turn on two-step sign-in
        </button>
      </div>
    </form>
  ) : (
    <div className="sc-card">
      <div className="sc-head">
        <span className="sc-status">
          <span className="sc-dot off" aria-hidden="true" />
          Two-step sign-in is off
        </span>
      </div>
      <h2 className="sc-title">{forced ? 'Connect an authenticator app to continue' : 'Protect your account with a second step'}</h2>
      <p className="sc-lead">After your password you will also type a 6-digit code from an authenticator app. It protects the console, and everyone's data in it, if your password is ever stolen.</p>
      <div className="sc-actions">
        <button className="sc-btn" onClick={start} disabled={busy}>
          Set it up
        </button>
        {forced && status.canSkip && (
          <button className="sc-btn ghost" disabled={busy} onClick={() => run(async () => (await api('POST', '/v1/me/mfa/skip'), onChanged()))}>
            Set it up later
          </button>
        )}
      </div>
      {forced && status.canSkip && <p className="sc-small">Administrators can put this off. You will be asked again the next time you sign in.</p>}
    </div>
  );

  if (forced)
    return (
      <div className="sc-forced">
        <p className="lg-card-eyebrow">Two-step sign-in</p>
        <ErrorBanner message={error} />
        {body}
      </div>
    );

  return (
    <Page title="Security" sub={forced ? (status.canSkip ? 'Connect an authenticator app now, or set it up later.' : 'Your account needs two-step sign-in before it can use the console.') : 'Your own sign-in'}>
      <ErrorBanner message={error} />
      {body}
    </Page>
  );
}
