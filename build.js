// Bundles the renderer (CodeMirror + markdown-it) into dist/renderer.js
const esbuild = require('esbuild');

const opts = {
  entryPoints: ['src/renderer.js'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  sourcemap: true,
  logLevel: 'info',
};

const watch = process.argv.includes('--watch');

(async () => {
  if (watch) {
    const ctx = await esbuild.context(opts);
    await ctx.watch();
    console.log('watching src/renderer.js ...');
  } else {
    await esbuild.build(opts);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
