import { linkTarget, rememberLink } from '@/lib/shareLink';

/**
 * Every address that opens the app from outside passes here first. A shared link (https://<site>/a/<id> or /t/<id>, or
 * herethere://a/<id>) is turned into the screen it means. It is also remembered, so a person who is signed out, and is
 * taken to the welcome page, is brought to it after signing in.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }) {
  try {
    const target = linkTarget(path);
    if (target) {
      rememberLink(target);
      return target;
    }
    return path;
  } catch {
    return path; // never crash the launch over a link
  }
}
