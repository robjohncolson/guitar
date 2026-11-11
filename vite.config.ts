/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  // Relative asset URLs: the same build works at a domain root (Vercel) and under a subpath (GitHub Pages /guitar/).
  base: './',
  server: { host: '127.0.0.1' },
  build: {
    target: 'es2022',
    rolldownOptions: { input: { trainer: 'index.html', play: 'play.html', piece: 'piece.html' } },
    // Ships the licences of every bundled dependency (TensorFlow.js and its MIT-licensed parts) with the site.
    license: { fileName: 'third-party-licenses.md' },
  },
  // Audio-analysis tests do real DSP; leave headroom for slower CI runners.
  test: { testTimeout: 30000 },
  plugins: [{
    name: 'verify-local-crepe-assets',
    apply: 'build',
    buildStart() {
      const base = new URL('./public/models/crepe-tiny/', import.meta.url);
      const model = JSON.parse(readFileSync(new URL('model.json',base),'utf8'));
      const hashes = JSON.parse(readFileSync(new URL('SHA256SUMS.json',base),'utf8'));
      const paths: string[] = ['model.json', ...model.weightsManifest.flatMap((group: {paths:string[]}) => group.paths)];
      if (paths.length < 2) throw new Error('CREPE weight manifest is empty. Run npm run vendor:crepe.');
      for (const path of paths) {
        if (!/^[\w.-]+$/.test(path)) throw new Error(`Invalid CREPE asset path: ${path}`);
        const bytes = readFileSync(new URL(path,base));
        if (createHash('sha256').update(bytes).digest('hex') !== hashes[path]) throw new Error(`CREPE asset failed integrity check: ${path}. Run npm run vendor:crepe.`);
      }
    },
  }, {
    // Private piece packs (often copyrighted) must never reach a published build, whatever the mode or environment.
    // The dev-only glob in src/piece/main.ts is still read during a build and then dropped as dead code, so check what is
    // actually emitted: no code from packs/local/, and no piece text marked "redistributable: no".
    name: 'keep-private-packs-out',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue;
        const leaked = Object.entries(file.modules).find(([id, m]) => m.renderedLength > 0 && id.replace(/\\/g, '/').includes('/src/piece/packs/local/'));
        if (leaked) this.error(`Refusing to publish the private piece pack ${leaked[0]} (in ${file.fileName}).`);
        if (/redistributable:\s*no\b/i.test(file.code)) this.error(`${file.fileName} contains a piece marked "redistributable: no".`);
      }
    },
  }],
});
