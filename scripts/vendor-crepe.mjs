import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const base = 'https://marl.github.io/crepe/model/';
const target = fileURLToPath(new URL('../public/models/crepe-tiny/', import.meta.url));
await mkdir(target, { recursive: true });
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
const modelData = await download(`${base}model.json`);
const model = JSON.parse(modelData);
if (!Array.isArray(model.weightsManifest)) throw new Error('Missing Layers weight manifest');
const hashes = {};
for (const shard of new Set(model.weightsManifest.flatMap(group => group.paths))) {
  if (!/^[\w.-]+$/.test(shard)) throw new Error(`Unexpected shard path: ${shard}`);
  const bytes = await download(new URL(shard, base));
  await writeFile(path.join(target, shard), bytes);
  hashes[shard] = createHash('sha256').update(bytes).digest('hex');
  console.log(`${shard}: ${bytes.length} bytes`);
}
await writeFile(path.join(target, 'model.json'), modelData);
hashes['model.json'] = createHash('sha256').update(modelData).digest('hex');
await writeFile(path.join(target, 'SHA256SUMS.json'), JSON.stringify(hashes, null, 2) + '\n');
const license = await download('https://raw.githubusercontent.com/marl/crepe/master/LICENSE');
await writeFile(path.join(target, '../CREPE-LICENSE'), license);
const tensorflowLicense = await download('https://raw.githubusercontent.com/tensorflow/tfjs/master/LICENSE');
await writeFile(path.join(target, '../TENSORFLOWJS-LICENSE'), tensorflowLicense);
console.log('Vendored official browser CREPE model and license. No runtime CDN required.');
