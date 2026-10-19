import { useState, type FormEvent } from 'react';
import { post } from '../api';
import { useMe } from '../auth';
import { ErrorBanner, useAction } from '../ui';

type Step = 'welcome' | 'login' | 'register';

/** Screen 01: welcome, first-party authentication, 18+ confirmation. */
export function Welcome() {
  const [step, setStep] = useState<Step>('welcome');
  const { notice } = useMe();
  if (step === 'welcome')
    return (
      <div className="welcome">
        <div className="welcome-hero" aria-hidden="true">
          <span>☕</span>
          <span>🍸</span>
          <span>🏃</span>
          <span>🎨</span>
        </div>
        <div className="welcome-body">
          <ErrorBanner message={notice} />
          <h1 className="logo">
            HERE<span>.</span>
          </h1>
          <p className="tagline">Be here. Be together.</p>
          <p className="muted-on-dark">Make something happen today.</p>
          <div className="stack">
            <button className="btn light block" onClick={() => setStep('register')}>
              Create an account
            </button>
            <button className="btn outline-light block" onClick={() => setStep('login')}>
              I already have an account
            </button>
          </div>
          <p className="fine">18+ only · Privacy first · We never share your live location</p>
        </div>
      </div>
    );
  return step === 'login' ? <Login onBack={() => setStep('welcome')} onSwitch={() => setStep('register')} /> : <Register onBack={() => setStep('welcome')} onSwitch={() => setStep('login')} />;
}

function Shell({ title, onBack, children }: { title: string; onBack: () => void; children: React.ReactNode }) {
  return (
    <div className="auth">
      <button className="link" onClick={onBack}>
        ‹ Back
      </button>
      <h1 className="logo dark">
        HERE<span>.</span>
      </h1>
      <h2>{title}</h2>
      {children}
    </div>
  );
}

function Login({ onBack, onSwitch }: { onBack: () => void; onSwitch: () => void }) {
  const { signIn, notice } = useMe();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const act = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await act.run(async () => signIn((await post<{ token: string }>('/v1/auth/login', { email, password })).token));
  };
  return (
    <Shell title="Welcome back" onBack={onBack}>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner message={act.error ?? notice} />
        <label>
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <button className="btn primary block" disabled={act.busy}>
          {act.busy ? 'Signing in…' : 'Log in'}
        </button>
        <button type="button" className="link" onClick={onSwitch}>
          New here? Create an account
        </button>
      </form>
    </Shell>
  );
}

function Register({ onBack, onSwitch }: { onBack: () => void; onSwitch: () => void }) {
  const { signIn } = useMe();
  const [f, setF] = useState({ displayName: '', email: '', password: '', homeCity: 'Milan', adult: false });
  const act = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    await act.run(async () =>
      signIn(
        (
          await post<{ token: string }>('/v1/auth/register', {
            displayName: f.displayName,
            email: f.email,
            password: f.password,
            homeCity: f.homeCity || undefined,
            adultConfirmed: f.adult,
          })
        ).token,
      ),
    );
  };
  return (
    <Shell title="Create your account" onBack={onBack}>
      <form className="stack" onSubmit={submit}>
        <ErrorBanner message={act.error} />
        <label>
          Display name
          <input required minLength={2} maxLength={40} autoComplete="nickname" value={f.displayName} onChange={set('displayName')} />
        </label>
        <label>
          Email
          <input type="email" required autoComplete="email" value={f.email} onChange={set('email')} />
        </label>
        <label>
          Password <span className="muted small">(at least 10 characters)</span>
          <input type="password" required minLength={10} autoComplete="new-password" value={f.password} onChange={set('password')} />
        </label>
        <label>
          Home city <span className="muted small">(city only, never an address)</span>
          <input maxLength={60} value={f.homeCity} onChange={set('homeCity')} />
        </label>
        <label className="check">
          <input type="checkbox" required checked={f.adult} onChange={set('adult')} />
          <span>I confirm that I am 18 or older.</span>
        </label>
        <button className="btn primary block" disabled={act.busy || !f.adult}>
          {act.busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="muted small">
          You can browse straight away. Before you host or join something in person you will verify your identity with a specialist provider. We never show your documents to anyone.
        </p>
        <button type="button" className="link" onClick={onSwitch}>
          Already have an account? Log in
        </button>
      </form>
    </Shell>
  );
}
