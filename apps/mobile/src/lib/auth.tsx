import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { clearLoadCache } from './hooks';
import { ApiError, get, getRefreshToken, loadRefreshToken, loadToken, post, saveRefreshToken, saveToken, setRefreshToken, setToken, setUnauthorizedHandler, type Me } from './api';

type SignInOptions = {
  /** true right after registering: show the onboarding steps (confirm email, set up profile) once */
  fresh?: boolean;
  /** dev only: the API echoes the email code so a phone can finish sign-up without a mail server */
  devCode?: string;
};

export type Tokens = { token: string; refreshToken?: string };

type AuthState = {
  me: Me | null;
  /** true for the "Explore demo" session: read-only, no account */
  isGuest: boolean;
  ready: boolean;
  notice: string | null;
  onboarding: boolean;
  devCode: string | null;
  setDevCode: (c: string | null) => void;
  finishOnboarding: () => void;
  reload: () => Promise<void>;
  /** `tokens` is the answer of a sign-in: the short-lived token and the refresh token (a guest has no refresh token) */
  signIn: (tokens: Tokens | string, opts?: SignInOptions) => Promise<void>;
  logout: (why?: string) => void;
};
const Ctx = createContext<AuthState>({
  me: null,
  isGuest: false,
  ready: false,
  notice: null,
  onboarding: false,
  devCode: null,
  setDevCode: () => {},
  finishOnboarding: () => {},
  reload: async () => {},
  signIn: async () => {},
  logout: () => {},
});
export const useMe = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [onboarding, setOnboarding] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const logout = useCallback((why?: string) => {
    clearLoadCache(); // nothing the last person saw is kept for the next one
    // a sign-out the person chose also ends this sign-in on the server (best effort: with no connection it simply ends here)
    if (typeof why !== 'string') void post('/v1/auth/logout', { refreshToken: getRefreshToken() ?? undefined }).catch(() => undefined);
    setToken(null);
    setRefreshToken(null);
    void saveToken(null);
    void saveRefreshToken(null);
    setMe(null);
    setOnboarding(false);
    setDevCode(null);
    setNotice(typeof why === 'string' ? why : null);
  }, []);

  const reload = useCallback(async () => {
    try {
      setMe(await get<Me>('/v1/me'));
    } catch (e) {
      // End the session only when the server rejects it. A dropped connection keeps the last known account.
      if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') logout('Your account has been suspended. If you think this is a mistake, please contact support.');
      else if (e instanceof ApiError && e.status === 403) logout();
    }
  }, [logout]);

  const signIn = useCallback(
    async (tokens: Tokens | string, opts?: SignInOptions) => {
      const { token, refreshToken } = typeof tokens === 'string' ? { token: tokens, refreshToken: undefined } : tokens;
      setNotice(null);
      setDevCode(opts?.devCode ?? null);
      setOnboarding(!!opts?.fresh);
      setToken(token);
      setRefreshToken(refreshToken ?? null);
      await Promise.all([saveToken(token), saveRefreshToken(refreshToken ?? null)]);
      await reload();
    },
    [reload],
  );

  const finishOnboarding = useCallback(() => setOnboarding(false), []);

  // restore a saved session on launch
  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session expired. Please log in again.'));
    (async () => {
      const [t, r] = await Promise.all([loadToken(), loadRefreshToken()]);
      if (t) {
        setToken(t);
        setRefreshToken(r);
        await reload();
      }
      setReady(true);
    })();
  }, [logout, reload]);

  // identity verification, roles and suspension change on the server, so re-read when the app returns to the foreground
  const signedIn = !!me;
  useEffect(() => {
    if (!signedIn) return;
    const sub = AppState.addEventListener('change', (s) => s === 'active' && void reload());
    const t = setInterval(() => AppState.currentState === 'active' && void reload(), 30_000);
    return () => {
      sub.remove();
      clearInterval(t);
    };
  }, [signedIn, reload]);

  return <Ctx.Provider value={{ me, isGuest: me?.role === 'guest', ready, notice, onboarding, devCode, setDevCode, finishOnboarding, reload, signIn, logout }}>{children}</Ctx.Provider>;
}
