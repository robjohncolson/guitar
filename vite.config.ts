import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export default defineConfig({
  server: { host: '127.0.0.1' },
  build: { target: 'es2022', rolldownOptions:{input:{trainer:'index.html',play:'play.html'}} },
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
  }],
});
