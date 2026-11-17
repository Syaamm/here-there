import QRCode from 'qrcode';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errMsg, ErrorBanner, Icon, Page, setUrlParam, urlParam } from '../ui';

/** The setup QR code, drawn in the browser so the secret never leaves it. */
function SetupQr({ uri }: { uri: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(uri, { width: 200, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#102f29', light: '#ffffff' } }).then((d) => live && setSrc(d), () => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [uri]);
  return src ? <img className="tf-qr" src={src} width={160} height={160} alt="Setup QR code" /> : <span className="spinner" role="status" aria-label="Loading" />;
}

type Status = { enabled: boolean; required: boolean; setupNeeded?: boolean; canSkip?: boolean; recoveryCodesLeft: number };

/**
 * Two-step sign-in: the person's own on / off choice. Off: signing in asks only for the password. On: it also asks for a code
 * from an authenticator app, every time. Turning it on is three steps (get an app, scan, enter a code), then the recovery codes
 * are shown once. Turning it off asks for the password and a code. `forced`: shown alone before the console opens, only where
 * the server requires two-step sign-in for staff.
 */
export function SecurityPage({ status, onChanged, forced }: { status: Status; onChanged: () => void; forced?: boolean }) {
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState('');
  const [turningOff, setTurningOff] = useState(false); // asked to turn it off: the password and a code come first
  const locked = status.enabled && status.required; // where the server requires it for staff, it cannot be turned off here

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
  const cancelSetup = () => (setSetup(null), setCode(''), setError(null));
  const enable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      const r = await api<{ recoveryCodes: string[] }>('POST', '/v1/me/mfa/enable', { code });
      setCodes(r.recoveryCodes);
      setSetup(null);
      setCode('');
      onChanged();
    });
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    return run(async () => {
      await api('DELETE', '/v1/me/mfa', { password, code });
      setPassword('');
      setCode('');
      setTurningOff(false);
      onChanged();
    });
  };
  const copy = (what: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => (setCopied(what), setTimeout(() => setCopied(''), 1800)));
  };

  // arriving from the Settings card's "Turn on" button: the setup starts at once (once)
  const auto = useRef(false);
  useEffect(() => {
    if (auto.current || forced || status.enabled || urlParam('setup') !== '1') return;
    auto.current = true;
    setUrlParam('setup', null);
    void start();
  }, [status.enabled, forced]);

  const spaced = (k: string) => k.replace(/\s/g, '').replace(/(.{4})/g, '$1 ').trim();

  const body = codes ? (
    <div className="tf-card">
      <div className="tf-pad">
        <h2 className="tf-h">Save your recovery codes</h2>
        <p className="tf-p">Each code works once. They get you in if you lose your phone. This is the only time they are shown.</p>
        <div className="tf-codes mono" aria-label="Recovery codes">
          {codes.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      </div>
      <div className="tf-foot">
        <span className="tf-note">
          <Icon name="alert" />
          Keep them somewhere safe, not on the same phone.
        </span>
        <div className="tf-actions">
          <button className="btn" type="button" onClick={() => copy('codes', codes.join('\n'))}>
            <Icon name="copy" /> {copied === 'codes' ? 'Copied' : 'Copy codes'}
          </button>
          <button className="btn primary" onClick={() => (setCodes(null), onChanged())}>
            I have saved them
          </button>
        </div>
      </div>
    </div>
  ) : status.enabled ? (
    <form className="tf-card" onSubmit={disable}>
      <div className="tf-pad">
        <h2 className="tf-h">Two-step sign-in is on</h2>
        <p className="tf-p">
          Signing in asks for your password and a code from your authenticator app. You have {status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left.
        </p>
        {locked && <p className="tf-p">Required for staff. An admin can reset it.</p>}
        {turningOff && !locked && (
          <div className="tf-off">
            <p className="tf-p">To turn it off, enter your password and a current code.</p>
            <div className="form-grid">
              <label>
                Password
                <input type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
              </label>
              <label>
                Code
                <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
              </label>
            </div>
          </div>
        )}
      </div>
      {!locked && (
        <div className="tf-foot">
          <span className="tf-note">{turningOff ? 'After this, signing in only asks for your password.' : 'You can turn it off any time.'}</span>
          <div className="tf-actions">
            {turningOff ? (
              <>
                <button type="button" className="btn" disabled={busy} onClick={() => (setTurningOff(false), setPassword(''), setCode(''), setError(null))}>
                  Keep it on
                </button>
                <button className="btn danger" disabled={busy}>
                  Turn off
                </button>
              </>
            ) : (
              <button type="button" className="btn danger" onClick={() => setTurningOff(true)}>
                Turn off
              </button>
            )}
          </div>
        </div>
      )}
    </form>
  ) : setup ? (
    <form className="tf-card" onSubmit={enable}>
      <ol className="tf-steps">
        <li className="tf-step">
          <span className="tf-num">1</span>
          <div>
            <h2 className="tf-h">Get an authenticator app</h2>
            <p className="tf-p">Any app that makes sign-in codes works, like Google Authenticator, Microsoft Authenticator or 1Password. Already have one? Skip to step 2.</p>
          </div>
        </li>
        <li className="tf-step">
          <span className="tf-num">2</span>
          <div>
            <h2 className="tf-h">Add your account to the app</h2>
            <p className="tf-p">In the app, choose to add an account, then scan this code.</p>
            <div className="tf-scan">
              <div className="tf-qrbox">
                <SetupQr uri={setup.otpauthUri} />
              </div>
              <div className="tf-key">
                <strong>Can’t scan? Enter this key instead</strong>
                <code className="mono">{spaced(setup.secret)}</code>
                <button type="button" className="btn small" onClick={() => copy('key', setup.secret)}>
                  <Icon name="copy" /> {copied === 'key' ? 'Copied' : 'Copy key'}
                </button>
              </div>
            </div>
            <p className="tf-p small">Setting up on this phone?</p>
            <a className="btn small" href={setup.otpauthUri}>
              Open in authenticator app <Icon name="arrow" />
            </a>
          </div>
        </li>
        <li className="tf-step">
          <span className="tf-num">3</span>
          <div>
            <h2 className="tf-h">Enter the code from the app</h2>
            <p className="tf-p">This confirms everything is linked up.</p>
            <label className="tf-code">
              6-digit code
              <input className="code-input" inputMode="numeric" autoComplete="one-time-code" required autoFocus pattern="\d{6}" maxLength={6} placeholder="123456" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
            </label>
            <p className="tf-p small">The code changes every 30 seconds. Use the one showing now.</p>
          </div>
        </li>
      </ol>
      <div className="tf-foot">
        <span className="tf-note">
          <Icon name="alert" />
          Next, you’ll save recovery codes. They get you in if you lose your phone.
        </span>
        <div className="tf-actions">
          <button type="button" className="btn" disabled={busy} onClick={cancelSetup}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy || code.length !== 6}>
            {busy ? 'Checking…' : 'Verify and turn on'}
          </button>
        </div>
      </div>
    </form>
  ) : (
    <div className="tf-card">
      <div className="tf-pad">
        <h2 className="tf-h">Two-step sign-in is off</h2>
        <p className="tf-p">Right now, signing in only asks for your password. Turn it on to also ask for a code from an authenticator app on your phone.</p>
      </div>
      <div className="tf-foot">
        <span className="tf-note">It takes about a minute to set up.</span>
        <div className="tf-actions">
          {forced && status.canSkip && (
            <button className="btn" disabled={busy} onClick={() => run(async () => (await api('POST', '/v1/me/mfa/skip'), onChanged()))}>
              Later
            </button>
          )}
          <button className="btn primary" disabled={busy} onClick={start}>
            Turn on
          </button>
        </div>
      </div>
    </div>
  );

  if (forced)
    return (
      <div className="stack">
        <ErrorBanner message={error} />
        {body}
      </div>
    );

  return (
    <Page title="Two-step sign-in">
      <ErrorBanner message={error} />
      {body}
    </Page>
  );
}
