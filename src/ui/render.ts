export function shell(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main>
      <header><div><span class="eyebrow">ACOUSTIC GUITAR · LOCAL SESSION</span><h1>Practice Partner</h1></div><button id="enable" class="primary">Enable audio</button></header>
      <div class="status"><span id="mic">Mic off</span><span id="model">Ear waiting</span><span id="latency"></span></div>
      <section class="pulse-panel" aria-label="Pulse"><div class="tempo"><strong id="bpm">—</strong><span>BPM / 4:4</span></div><div id="beats" class="beats">${[1,2,3,4].map(n => `<div class="beat" data-beat="${n-1}"><span>${n}</span><small>empty</small></div>`).join('')}</div></section>
      <p id="hint" class="hint" role="status">Tap Space 4 times to set the pulse</p>
      <section class="listening"><div><span class="eyebrow">LAST HEARD</span><div id="note" class="note">—</div><span id="pitch-detail" class="muted">One note at a time</span></div><div class="scale-panel"><span class="eyebrow">SCALE</span><div id="scale" class="scale">Listening for a key</div><progress id="scale-confidence" max="1" value="0" aria-label="Scale confidence"></progress><div class="scale-footer"><span id="onsets" class="muted">0 notes heard</span><button id="lock" disabled>Lock · L</button></div></div></section>
      <section class="controls" aria-label="Companion"><span class="eyebrow">COMPANION</span><div id="roles" class="roles">${['Hole-filler','Bass','Harmony','Call-response'].map((r,i) => `<button data-role="${i}" ${i === 0 ? 'class="selected"' : ''} disabled><small>${i+1}</small>${r}</button>`).join('')}</div><div class="toggles"><button id="density" disabled>Shy · D</button><button id="companion-mute" disabled>Companion on · M</button><button id="click-mute">Click on · C</button><button id="output" disabled>Speakers · H</button></div></section>
      <details><summary>Listening settings</summary><label>Voiced threshold <input id="threshold" type="range" min="0.3" max="0.8" step="0.01" value="0.5"><output id="threshold-value">0.50</output></label><label>Companion volume <input id="volume" type="range" min="0" max="0.5" step="0.01" value="0.22"><output id="volume-value">44%</output></label><p class="muted">One string at a time. Speakers uses echo cancellation; headphones gives a cleaner input.</p></details>
      <footer><span><kbd>Space</kbd> tap pulse</span><span><kbd>Shift Space</kbd> reset clock</span><span><kbd>1–4</kbd> role</span><span><kbd>D</kbd> density</span><span><kbd>L</kbd> lock</span><span><kbd>M / C</kbd> mutes</span><span><kbd>H</kbd> output</span><span><kbd>Esc</kbd> silence</span></footer>
    </main>`;
}
export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
