import { build } from 'esbuild';
await build({ entryPoints: ['scripts/migrate.ts', 'scripts/init-admin.ts', 'scripts/cleanup.ts'], outdir: 'dist', bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['pg'], outExtension: { '.js': '.mjs' } });
