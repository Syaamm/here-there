import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * The website: the web version of the app at `/` and the admin console at `/admin/`, served by the API itself when it has been
 * built (`npm run build:web`, which writes build/site at the repository root). Then one program and one address do everything,
 * so putting the code on a server and starting the API is all that is needed for the admin console to be live. Without a
 * build (development, tests) nothing here is active and the API answers only the API.
 *
 * `SITE_DIR` points at another folder. The API's own addresses (/v1, the shared-link pages /a and /t, /.well-known) always
 * go to the API first.
 */
export function siteDir(): string | null {
  const dir = path.resolve(process.env.SITE_DIR ?? path.join(__dirname, '..', '..', '..', '..', '..', 'build', 'site'));
  return existsSync(path.join(dir, 'index.html')) ? dir : null;
}

const API_PATHS = /^\/(v1|a|t|\.well-known)(\/|$)/;
const ADMIN_PATH = /^\/admin(\/|$)/;
const YEAR = 365 * 86_400;

export function siteHandlers(): RequestHandler[] | null {
  const dir = siteDir();
  if (!dir) return null;

  const files = express.static(dir, {
    index: ['index.html'],
    fallthrough: true,
    setHeaders(res, file) {
      const name = path.basename(file);
      // the pages and the service worker must always be fetched fresh; the files with a fingerprint in their name never change
      if (name === 'index.html' || name === 'sw.js' || name === 'metadata.json') res.setHeader('Cache-Control', 'no-cache');
      else if (/[\\/](_expo[\\/]static|assets)[\\/]/.test(file)) res.setHeader('Cache-Control', `public, max-age=${YEAR}, immutable`);
    },
  });

  const serveFiles = (req: Request, res: Response, next: NextFunction) => (API_PATHS.test(req.path) ? next() : files(req, res, next));

  // an address that is a screen of the app (or of the console) rather than a file: send the page, and the app finds its screen
  const pages = (req: Request, res: Response, next: NextFunction) => {
    if ((req.method !== 'GET' && req.method !== 'HEAD') || API_PATHS.test(req.path) || path.extname(req.path) || !req.accepts('html')) return next();
    res.set('Cache-Control', 'no-cache').sendFile(path.join(dir, ADMIN_PATH.test(req.path) ? 'admin' : '', 'index.html'));
  };

  return [serveFiles, pages];
}
