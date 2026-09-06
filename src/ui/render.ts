export function shell(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main>
      <header><div><span class="eyebrow">GUITAR · LISTEN & REPLY</span><h1>Practice Partner</h1><p class="intro">Play an idea. Hear it back three times.</p></div><button id="enable" class="primary">Enable audio & mic</button></header>
      <div class="status"><span id="mic">Mic off</span><span id="model">CREPE loading</span><span id="latency"></span></div>
      <section class="pulse-panel" aria-label="Tempo and pulse">
        <div class="tempo"><label for="bpm">BPM</label><input id="bpm" type="number" min="40" max="240" step="1" value="100" inputmode="numeric" aria-describedby="tempo-help"><span id="tempo-help">Enter tempo or tap Space</span></div>
        <div class="beats">${[1,2,3,4].map(n => `<div class="beat"><span>${n}</span><small>—</small></div>`).join('')}</div>
      </section>
      <section class="phrase-panel" aria-label="Phrase recognition">
        <div id="passes" aria-label="0 of 3 phrase repetitions">${[1,2,3].map(n => `<span class="pass" aria-hidden="true">${n}</span>`).join('')}</div>
        <span id="phrase-status" role="status">Listening for a short phrase</span>
        <button id="listen-again" disabled>Start fresh · L</button>
      </section>
      <p id="hint" class="hint" role="status">Set your BPM, enable audio, and repeat a short phrase.</p>
      <section class="listening" aria-label="Player and accompaniment">
        <div><span class="eyebrow">YOU PLAYED</span><div id="note" class="note">—</div><span id="pitch-detail" class="muted">One note at a time</span></div>
        <div><span class="eyebrow">REPLY</span><div id="reply" class="note cool">—</div><span id="reply-detail" class="muted">Listening for the next idea</span></div>
      </section>
      <div class="toggles"><button id="companion-mute">Replies on · M</button><button id="click-mute">Click off · C</button><button id="output">Speakers · H</button><button id="panic">Silence · Esc</button></div>
      <details><summary>Listening settings</summary><label>Voiced threshold <input id="threshold" type="range" min="0.3" max="0.8" step="0.01" value="0.5"><output id="threshold-value">0.50</output></label><label>Reply volume <input id="volume" type="range" min="0" max="0.5" step="0.01" value="0.22"><output id="volume-value">44%</output></label><label><input id="responsive" type="checkbox" checked> Soften replies while I play</label><p class="muted">Play individual notes. Speakers uses echo cancellation. For cleaner listening, use headphones and press H.</p></details>
      <footer><span><kbd>Space</kbd> tap tempo</span><span><kbd>L</kbd> start fresh</span><span><kbd>Shift Space</kbd> restart pulse</span><span><kbd>M / C</kbd> replies / click</span><span><kbd>H</kbd> output mode</span><span><kbd>Esc</kbd> silence</span></footer>
    </main>`;
}
export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
