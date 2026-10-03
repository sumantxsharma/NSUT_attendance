// Builds the app in Vercel's Build Output API v3 layout (.vercel/output):
//   static/            the React app, served from Vercel's CDN
//   functions/api.func the Express API bundled into one Node.js function
// Also applies pending database migrations when DATABASE_URL is set (skip with MIGRATE_ON_BUILD=false).
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, '.vercel', 'output');
const fn = path.join(out, 'functions', 'api.func');
const run = (cmd) => execSync(cmd, { cwd: root, stdio: 'inherit' });

fs.rmSync(out, { recursive: true, force: true });

if (process.env.DATABASE_URL && process.env.MIGRATE_ON_BUILD !== 'false') run('npx tsx apps/api/src/db/migrate.ts');

run('npm run build -w @nsut/web');
fs.cpSync(path.join(root, 'apps/web/dist'), path.join(out, 'static'), { recursive: true });

await build({
  entryPoints: [path.join(root, 'apps/api/src/vercel.ts')],
  outfile: path.join(fn, 'index.js'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  // CommonJS so pdfkit's `__dirname + '/data/*.afm'` font reads resolve inside the function directory.
  format: 'cjs',
  external: ['pg-native'],
  define: { 'import.meta.url': '__import_meta_url' },
  banner: { js: "const __import_meta_url = require('url').pathToFileURL(__filename).href;" },
  footer: { js: 'module.exports = module.exports.default;' },
  alias: { '@nsut/shared': path.join(root, 'packages/shared/src/index.ts') },
  logLevel: 'info',
});
fs.cpSync(path.join(root, 'node_modules/pdfkit/js/data'), path.join(fn, 'data'), { recursive: true });
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.js', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 30 }, null, 2),
);

fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/(api(?:/.*)?|health)$', dest: '/api' },
        { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '/(.*)', dest: '/index.html', headers: { 'Cache-Control': 'no-cache' } },
      ],
    },
    null,
    2,
  ),
);
console.log('Vercel build output written to .vercel/output');
