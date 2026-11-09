import QRCode from 'qrcode';
import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { errMsg, ErrorBanner, Icon, Page } from '../ui';

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
  return src ? <img src={src} width={200} height={200} alt="Setup QR code" style={{ borderRadius: 10, border: '1px solid var(--line)' }} /> : <span className="spinner" role="status" aria-label="Loading" />;
}

type Status = { enabled: boolean; required: boolean; setupNeeded?: boolean; canSkip?: boolean; recoveryCodesLeft: number };

/** Two-step sign-in: set up, recovery codes, turn off. `forced`: shown alone before the console opens. */
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

  const on = (
    <div className="row">
      <span className="dot on" />
      <strong>Two-step sign-in on</strong>
    </div>
  );

  const body = codes ? (
    <div className="stack">
      {on}
      <strong>Recovery codes (shown once)</strong>
      <div className="box mono" aria-label="Recovery codes" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '6px 16px' }}>
        {codes.map((c) => (
          <span key={c}>{c}</span>
        ))}
      </div>
      <div className="row wrap">
        <button className="btn" type="button" onClick={() => copy(codes.join('\n'))}>
          <Icon name="copy" /> {copied ? 'Copied' : 'Copy'}
        </button>
        <button className="btn primary" onClick={() => (setCodes(null), onChanged())}>
          Saved
        </button>
      </div>
    </div>
  ) : status.enabled ? (
    <form className="stack" onSubmit={disable}>
      {on}
      <p className="muted">{status.recoveryCodesLeft} recovery {status.recoveryCodesLeft === 1 ? 'code' : 'codes'} left</p>
      {status.required ? (
        <p className="muted small">Required for staff. An admin can reset it.</p>
      ) : (
        <>
          <div className="form-grid">
            <label>
              Password
              <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            <label>
              Code
              <input inputMode="numeric" autoComplete="one-time-code" required value={code} onChange={(e) => setCode(e.target.value)} />
            </label>
          </div>
          <div>
            <button className="btn danger" disabled={busy}>
              Turn off
            </button>
          </div>
        </>
      )}
    </form>
  ) : setup ? (
    <form className="stack" onSubmit={enable}>
      <strong>Scan with your authenticator app</strong>
      <SetupQr uri={setup.otpauthUri} />
      <div className="box">
        <span className="label">Setup key</span>
        <div className="row between">
          <code className="mono">{setup.secret}</code>
          <button type="button" className="btn small" onClick={() => copy(setup.secret)}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <a className="link small" href={setup.otpauthUri}>
        Open on this device
      </a>
      <label>
        6-digit code
        <input className="code-input" inputMode="numeric" autoComplete="one-time-code" required autoFocus pattern="\d{6}" maxLength={6} placeholder="000000" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
      </label>
      <button className="btn primary" disabled={busy || code.length !== 6}>
        Turn on
      </button>
    </form>
  ) : (
    <div className="stack">
      <div className="row">
        <span className="dot" />
        <strong>{forced ? 'Set up two-step sign-in' : 'Two-step sign-in off'}</strong>
      </div>
      <div className="row wrap">
        <button className="btn primary" onClick={start} disabled={busy}>
          Set up
        </button>
        {forced && status.canSkip && (
          <button className="btn" disabled={busy} onClick={() => run(async () => (await api('POST', '/v1/me/mfa/skip'), onChanged()))}>
            Later
          </button>
        )}
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
    <Page title="Security">
      <ErrorBanner message={error} />
      <div className="card" style={{ maxWidth: 520 }}>
        {body}
      </div>
    </Page>
  );
}
