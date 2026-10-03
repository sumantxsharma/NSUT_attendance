import { build } from 'esbuild';
// Bundle the API (and the TypeScript @nsut/shared workspace) into one ESM file.
// Third-party packages stay external and are installed in the runtime image.
await build({
  entryPoints: ['src/server.ts', 'src/db/migrate.ts', 'src/db/seed.ts', 'src/db/create-admin.ts'],
  outdir: 'dist',
  outbase: 'src',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  plugins: [{
    name: 'bundle-shared',
    setup(b) {
      b.onResolve({ filter: /^@nsut\/shared$/ }, () => ({ path: new URL('../../packages/shared/src/index.ts', import.meta.url).pathname }));
    },
  }],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: 'info',
});
