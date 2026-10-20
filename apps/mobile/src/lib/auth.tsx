import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { ApiError, get, loadToken, saveToken, setToken, setUnauthorizedHandler, type Me } from './api';

type SignInOptions = {
  /** true right after registering: show the onboarding steps (confirm email, set up profile) once */
  fresh?: boolean;
  /** dev only: the API echoes the email code so a phone can finish sign-up without a mail server */
  devCode?: string;
};

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
  signIn: (token: string, opts?: SignInOptions) => Promise<void>;
  logout: () => void;
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
    setToken(null);
    void saveToken(null);
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
    async (token: string, opts?: SignInOptions) => {
      setNotice(null);
      setDevCode(opts?.devCode ?? null);
      setOnboarding(!!opts?.fresh);
      setToken(token);
      await saveToken(token);
      await reload();
    },
    [reload],
  );

  const finishOnboarding = useCallback(() => setOnboarding(false), []);

  // restore a saved session on launch
  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session expired. Please log in again.'));
    (async () => {
      const t = await loadToken();
      if (t) {
        setToken(t);
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
