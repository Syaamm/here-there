import { account } from './account';
import { auth } from './auth';
import { common } from './common';
import { create } from './create';
import { details } from './details';
import { errors } from './errors';
import { home } from './home';
import { inbox } from './inbox';
import { shell } from './shell';

/** All Italian texts, merged. Each area has its own file so they can be worked on separately. */
export const it: Record<string, string> = { ...common, ...shell, ...auth, ...home, ...create, ...inbox, ...details, ...account, ...errors };
