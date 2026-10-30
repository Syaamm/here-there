// Serves the admin console at http://localhost:8082/admin on the same port as the web preview.
//
// Normally (development) the admin runs live inside this server: edit a file in apps/admin and the page in the browser updates
// by itself, so nothing needs to be started or opened on port 5173. If that cannot start, or ADMIN_STATIC=1 is set, the last
// build in apps/admin/dist is served instead (build it with `npm run admin:build` from the repo root).
const { getDefaultConfig } = require('expo/metro-config');
const fs = require('fs');
const path = require('path');

const config = getDefaultConfig(__dirname);
const adminDir = path.resolve(__dirname, '../admin');
const adminDist = path.join(adminDir, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2' };

// the admin's own live-update server, started the first time someone opens /admin (not when the phone app is all you use)
let live = null;
function startLive() {
  if (process.env.ADMIN_STATIC === '1') return Promise.resolve(null);
  return (live ??= import('vite')
    .then((vite) =>
      vite.createServer({
        root: adminDir,
        configFile: path.join(adminDir, 'vite.config.ts'),
        appType: 'spa',
        clearScreen: false,
        // middleware mode: no port of its own for pages. Only the small live-update socket needs one (it cannot share Metro's).
        server: { middlewareMode: true, hmr: { port: 24678 } },
      }),
    )
    .then((server) => {
      process.once('exit', () => void server.close());
      console.log('Admin console: http://localhost:8082/admin/ (live, edits show at once)');
      return server;
    })
    .catch((e) => {
      console.warn(`Admin console: could not start live mode (${e && e.message}); serving the last build instead.`);
      return null;
    }));
}

function serveBuilt(url, res) {
  let file = path.join(adminDist, decodeURIComponent(url.slice('/admin/'.length)));
  if (!file.startsWith(adminDist)) {
    res.writeHead(403);
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(adminDist, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('Admin not built. Run: npm run admin:build');
  }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

config.server = {
  ...config.server,
  enhanceMiddleware: (metroMiddleware) => (req, res, next) => {
    const url = (req.url ?? '').split('?')[0];
    if (url !== '/admin' && !url.startsWith('/admin/')) return metroMiddleware(req, res, next);
    if (url === '/admin') {
      res.writeHead(302, { Location: '/admin/' });
      return res.end();
    }
    startLive().then((server) => (server ? server.middlewares(req, res, next) : serveBuilt(url, res)));
  },
};

module.exports = config;
