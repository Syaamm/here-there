import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { clearLoadCache } from './hooks';
import { ApiError, get, getRefreshToken, loadRefreshToken, loadToken, post, saveRefreshToken, saveToken, setRefreshToken, setToken, setUnauthorizedHandler, type Me } from './api';
import { success, tap } from './haptics';

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
  /** takes the notice off the login page (it has been read) */
  clearNotice: () => void;
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
  clearNotice: () => {},
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
    if (typeof why !== 'string') {
      void post('/v1/auth/logout', { refreshToken: getRefreshToken() ?? undefined }).catch(() => undefined);
      tap('Medium'); // signed out: a firm tap
    }
    setToken(null);
    setRefreshToken(null);
    void saveToken(null);
    void saveRefreshToken(null);
    setMe(null);
    setOnboarding(false);
    setDevCode(null);
    setNotice(typeof why === 'string' ? why : null);
  }, []);

  const lastFail = useRef('');
  const meRef = useRef<Me | null>(null);
  meRef.current = me;
  /** 'ok': the account is loaded. 'ended': the server says this sign-in is over (already handled). 'offline': no answer, nothing is known. */
  const load = useCallback(async (): Promise<'ok' | 'ended' | 'offline'> => {
    try {
      setMe(await get<Me>('/v1/me'));
      return 'ok';
    } catch (e) {
      // End the session only when the server rejects it. A dropped connection keeps the last known account.
      if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') {
        logout('Your account has been suspended. If you think this is a mistake, please contact support.');
        return 'ended';
      }
      if (e instanceof ApiError && e.status === 403) {
        logout(__DEV__ ? `Signed out: the server answered 403 ${e.code} to /v1/me` : undefined);
        return 'ended';
      }
      lastFail.current = e instanceof ApiError ? `${e.status || 'no answer'} ${e.code}: ${e.message}` : String(e);
      return e instanceof ApiError && e.status === 401 ? 'ended' : 'offline';
    }
  }, [logout]);
  const reload = useCallback(async () => {
    await load();
  }, [load]);

  const signIn = useCallback(
    async (tokens: Tokens | string, opts?: SignInOptions) => {
      const { token, refreshToken } = typeof tokens === 'string' ? { token: tokens, refreshToken: undefined } : tokens;
      setNotice(null);
      setDevCode(opts?.devCode ?? null);
      setOnboarding(!!opts?.fresh);
      setToken(token);
      setRefreshToken(refreshToken ?? null);
      // saved in the background: signing in never waits on the keychain for more than a moment
      await Promise.race([Promise.all([saveToken(token), saveRefreshToken(refreshToken ?? null)]), new Promise((done) => setTimeout(done, 3000))]);
      // signed in on the server, but the account could not be read: say why on the login page instead of staying silent
      const loaded = await load();
      if (loaded === 'ok') success(); // signed in
      if (loaded === 'offline') throw new Error(`Signed in, but your account could not be loaded (${lastFail.current}). Trying again...`);
    },
    [load],
  );

  const finishOnboarding = useCallback(() => setOnboarding(false), []);
  const clearNotice = useCallback(() => setNotice(null), []);

  // restore a saved session on launch
  useEffect(() => {
    setUnauthorizedHandler((detail) => logout('Your session expired. Please log in again.' + (detail ? ` [${detail}]` : '')));
    (async () => {
      const [t, r] = await Promise.all([loadToken(), loadRefreshToken()]);
      if (t) {
        setToken(t);
        setRefreshToken(r);
        // A phone that has just opened (or woken up) often has no network for a moment. That is not a sign-out: ask again a few times
        // before showing anything, so a good sign-in is never answered with the login page.
        for (let i = 0; i < 4 && (await load()) === 'offline'; i++) await new Promise((done) => setTimeout(done, 1500 * (i + 1)));
      }
      setReady(true);
    })();
  }, [logout, load]);

  // still holding a saved sign-in but the account could not be loaded (no network yet): keep asking until it can, so the person is signed in as soon as the connection is back
  useEffect(() => {
    if (!ready || me || !getRefreshToken()) return;
    // asks again after 5 s, then 10, 20, up to a minute, so a phone that stays offline is not woken every 5 seconds; coming back to the app asks at once
    let wait = 5000;
    let t: ReturnType<typeof setTimeout> | null = null;
    let gone = false;
    const again = () => {
      t = setTimeout(async () => {
        if (gone) return;
        if (AppState.currentState === 'active') await load();
        wait = Math.min(wait * 2, 60_000);
        if (!gone) again();
      }, wait);
    };
    again();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      wait = 5000;
      if (t) clearTimeout(t);
      void load().finally(() => !gone && again());
    });
    return () => {
      gone = true;
      if (t) clearTimeout(t);
      sub.remove();
    };
  }, [ready, me, load]);

  // identity verification, roles and suspension change on the server, so re-read when the app returns to the foreground
  const signedIn = !!me;
  useEffect(() => {
    if (!signedIn) return;
    // every 30 s while the account keeps coming back the same, then slower (1 min, 2 min at most); any change, or coming back to the app, starts again at 30 s
    let wait = 30_000;
    let last = JSON.stringify(meRef.current);
    let t: ReturnType<typeof setTimeout> | null = null;
    let gone = false;
    const again = () => {
      t = setTimeout(async () => {
        if (gone) return;
        if (AppState.currentState === 'active') {
          await reload();
          await new Promise((done) => setTimeout(done, 150)); // let the new account reach the screen before comparing
          const now = JSON.stringify(meRef.current);
          wait = now === last ? Math.min(wait * 2, 120_000) : 30_000;
          last = now;
        }
        if (!gone) again();
      }, wait);
    };
    again();
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      wait = 30_000;
      if (t) clearTimeout(t);
      void reload().finally(() => {
        last = JSON.stringify(meRef.current);
        if (!gone) again();
      });
    });
    return () => {
      gone = true;
      if (t) clearTimeout(t);
      sub.remove();
    };
  }, [signedIn, reload]);

  return <Ctx.Provider value={{ me, isGuest: me?.role === 'guest', ready, notice, clearNotice, onboarding, devCode, setDevCode, finishOnboarding, reload, signIn, logout }}>{children}</Ctx.Provider>;
}
