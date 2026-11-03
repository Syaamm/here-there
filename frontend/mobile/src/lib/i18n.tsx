import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { it } from './i18n/it';

/**
 * Languages of the app. English is the language the screens are written in, so an English text IS its own key:
 * `t('Edit profile')` shows "Edit profile" in English and "Modifica profilo" in Italian. A text with no translation
 * yet shows in English, never blank. Placeholders are written {name} and filled from the second argument:
 * `t('Hello {name}', { name })`. The Italian texts live in lib/i18n/it/<area>.ts, one file per part of the app.
 */
export type Lang = 'en' | 'it';
export const LANGS: [Lang, string][] = [
  ['en', 'English'],
  ['it', 'Italiano'],
];
const KEY = 'ht_lang';

const dicts: Record<Lang, Record<string, string>> = { en: {}, it };

let current: Lang = 'en';
export const currentLang = () => current;

/** The locale tag for dates, times and numbers: Italian formats for Italian, the phone's own formats for English. */
export const localeTag = (): string | undefined => (current === 'it' ? 'it-IT' : undefined);

/** The phone's language when we offer it, otherwise English. */
function phoneLang(): Lang {
  try {
    const code = getLocales()[0]?.languageCode ?? (typeof navigator !== 'undefined' ? navigator.language?.slice(0, 2) : undefined);
    return code === 'it' ? 'it' : 'en';
  } catch {
    return 'en';
  }
}

/** Translate outside a component (module code, utilities). Components should use useT() so they redraw on a language change. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = dicts[current][text] ?? text;
  if (vars) for (const k of Object.keys(vars)) out = out.split(`{${k}}`).join(String(vars[k]));
  return out;
}

/** "1 person" / "3 people": the one form or the other, by count. The count is available as {n}. */
export function tn(n: number, one: string, many: string): string {
  return t(n === 1 ? one : many, { n });
}

type Ctx = { lang: Lang; setLang: (l: Lang) => void };
const LangCtx = createContext<Ctx>({ lang: 'en', setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(phoneLang);
  current = lang; // set while rendering, before any child calls t()
  useEffect(() => {
    AsyncStorage.getItem(KEY)
      .then((v) => (v === 'en' || v === 'it') && setLangState(v))
      .catch(() => {});
  }, []);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    AsyncStorage.setItem(KEY, l).catch(() => {});
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <LangCtx.Provider value={value}>{children}</LangCtx.Provider>;
}

export const useLang = () => useContext(LangCtx);

/** The translate function for a component. Using it subscribes the component, so it redraws when the language changes. */
export function useT() {
  const { lang } = useContext(LangCtx);
  return useMemo(() => {
    current = lang;
    return { t, tn };
  }, [lang]);
}
