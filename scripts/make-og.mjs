import { readFile, writeFile } from 'node:fs/promises';
import { chromeSession } from './chrome-session.mjs';

const brand = await readFile(new URL('../src/brand.ts', import.meta.url), 'utf8');
const literal = (name) => {
  const m = brand.match(new RegExp(`export const ${name} = '([^']*)';`));
  if (!m) throw new Error(`src/brand.ts: no string literal found for ${name}`);
  return m[1];
};
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const name = esc(literal('PRODUCT')),
  tagline = esc(literal('TAGLINE'));

const bars = [
  [60, 40, 150, '#8fb7de'],
  [150, 120, 120, '#c5d7a2'],
  [240, 10, 170, '#8fb7de'],
  [330, 70, 100, '#c5d7a2'],
  [420, 30, 140, '#8fb7de'],
  [510, 100, 130, '#c5d7a2'],
  [600, 0, 90, '#8fb7de'],
  [690, 60, 160, '#c5d7a2'],
  [780, 20, 110, '#8fb7de'],
  [870, 90, 150, '#c5d7a2'],
  [960, 50, 120, '#8fb7de'],
]
  .map(([x, y, h, c]) => `<i style="left:${x + 20}px;top:${y}px;height:${h}px;background:${c}"></i>`)
  .join('');
const keys = Array.from({ length: 14 }, (_, k) => `<b style="left:${k * 80}px"></b>`).join('');
const black = [0, 1, 3, 4, 5, 7, 8, 10, 11, 12].map((k) => `<u style="left:${k * 80 + 54}px"></u>`).join('');
const star =
  '<svg viewBox="0 0 24 24" width="56" height="56"><path fill="#e6c88a" d="M12 1.5l3 7 7.5.6-5.7 4.9 1.8 7.4L12 17.5 5.4 21.4l1.8-7.4L1.5 9.1 9 8.5z"/></svg>';
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#131715;font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif}
.notes{position:absolute;left:40px;top:0;width:1120px;height:210px}
.notes i{position:absolute;width:56px;border-radius:10px;opacity:.9}
.keys{position:absolute;left:40px;top:215px;width:1120px;height:60px;overflow:hidden;border-radius:0 0 10px 10px}
.keys b{position:absolute;top:0;width:76px;height:60px;background:#e8ece6;border-radius:0 0 6px 6px}
.keys u{position:absolute;top:0;width:44px;height:36px;background:#131715;border-radius:0 0 4px 4px}
h1{position:absolute;left:80px;top:310px;margin:0;font-size:128px;line-height:1;color:#f1f3ee;letter-spacing:-2px}
p{position:absolute;left:84px;top:460px;margin:0;font-size:40px;color:#b9c3bb}
.stars{position:absolute;left:80px;top:540px;display:flex;gap:14px}
</style><div class="notes">${bars}</div><div class="keys">${keys}${black}</div>
<h1>${name}</h1><p>${tagline}</p><div class="stars">${star}${star}${star}</div>`;

const session = await chromeSession();
try {
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: 1200,
    height: 630,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await session.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
  await session.until("document.readyState === 'complete'");
  const shot = await session.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 },
  });
  await writeFile(new URL('../public/og.png', import.meta.url), Buffer.from(shot.data, 'base64'));
} finally {
  await session.close();
}
