import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ApiError, get, loadToken, saveToken, setToken, setUnauthorizedHandler, type Me } from './api';

type AuthState = { me: Me | null; ready: boolean; notice: string | null; reload: () => Promise<void>; signIn: (token: string) => Promise<void>; logout: () => void };
const Ctx = createContext<AuthState>({ me: null, ready: false, notice: null, reload: async () => {}, signIn: async () => {}, logout: () => {} });
export const useMe = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback((why?: string) => {
    setToken(null);
    saveToken(null);
    setMe(null);
    setNotice(typeof why === 'string' ? why : null);
  }, []);

  const reload = useCallback(async () => {
    try {
      setMe(await get<Me>('/v1/me'));
    } catch (e) {
      // Only end the session when the server rejects it (expired token, suspended account).
      // A dropped connection keeps the last known account instead of signing the user out.
      if (e instanceof ApiError && e.code === 'ACCOUNT_SUSPENDED') logout('Your account has been suspended. If you think this is a mistake, please contact support.');
      else if (e instanceof ApiError && e.status === 403) logout();
    }
  }, [logout]);

  const signIn = useCallback(
    async (token: string) => {
      setNotice(null);
      setToken(token);
      saveToken(token);
      await reload();
    },
    [reload],
  );

  useEffect(() => {
    setUnauthorizedHandler(() => logout('Your session expired. Please log in again.'));
    (loadToken() ? reload() : Promise.resolve()).finally(() => setReady(true));
  }, [logout, reload]);

  // Keep the account fresh: identity verification, role and suspension change on the server
  // (staff decisions), so re-read it on a timer and whenever the user comes back to the tab.
  const signedIn = !!me;
  useEffect(() => {
    if (!signedIn) return;
    const refresh = () => document.visibilityState === 'visible' && void reload();
    const t = setInterval(refresh, 30_000);
    addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(t);
      removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [signedIn, reload]);

  return <Ctx.Provider value={{ me, ready, notice, reload, signIn, logout }}>{children}</Ctx.Provider>;
}
