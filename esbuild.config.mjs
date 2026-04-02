import * as esbuild from 'esbuild';

const isWatch = process.argv.includes('--watch');

const config = {
  entryPoints: ['extension/src/content-main.js'],
  outfile: 'extension/content.js',
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  sourcemap: 'linked',
  logLevel: 'info',
};

if (isWatch) {
  const ctx = await esbuild.context(config);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await esbuild.build(config);
}
