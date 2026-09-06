export function shell(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main>
      <header><div><span class="eyebrow">GUITAR · REPEAT & REMEMBER</span><h1>Practice Partner</h1><p class="intro">Your note. Two beats later. A phrase to play against.</p></div><button id="enable" class="primary">Enable audio & mic</button></header>
      <div class="status"><span id="mic">Mic off</span><span id="model">CREPE loading</span><span id="latency"></span></div>
      <section class="pulse-panel" aria-label="Tempo and pulse">
        <div class="tempo"><label for="bpm">BPM</label><input id="bpm" type="number" min="40" max="240" step="1" value="100" inputmode="numeric" aria-describedby="tempo-help"><span id="tempo-help">Enter tempo or tap Space</span></div>
        <div class="delay"><strong id="delay-value">2<span>beats</span></strong><span id="delay-seconds">1.20 seconds later</span></div>
        <div class="beats">${[1,2,3,4].map(n => `<div class="beat"><span>${n}</span><small>—</small></div>`).join('')}</div>
      </section>
      <section class="memory-panel" aria-label="Phrase memory">
        <div class="memory-length" role="group" aria-label="Memory length"><span class="eyebrow">MEMORY</span>${[1,2,4].map(bars => `<button data-memory-bars="${bars}" aria-pressed="${bars === 2}">${bars} ${bars === 1 ? 'bar' : 'bars'}</button>`).join('')}</div>
        <button id="remember" disabled>Remember · L</button>
        <span id="memory-status" class="muted" role="status">Play 2 bars, then Remember.</span>
      </section>
      <p id="hint" class="hint" role="status">Set your BPM, enable audio, and play a note.</p>
      <section class="listening" aria-label="Repeater activity">
        <div><span class="eyebrow">YOU PLAYED</span><div id="note" class="note">—</div><span id="pitch-detail" class="muted">One note at a time</span></div>
        <div><span id="repeat-label" class="eyebrow">REPEAT</span><div id="echo-note" class="note cool">—</div><span id="queue" class="muted">Ready for your first note</span></div>
      </section>
      <div class="toggles"><button id="companion-mute">Repeater on · M</button><button id="click-mute">Click on · C</button><button id="responsive" aria-pressed="true" title="The loop softens while you play and returns in your pauses.">Responsive on</button><button id="output">Speakers · H</button><button id="panic">Silence · Esc</button></div>
      <details><summary>Listening settings</summary><label>Voiced threshold <input id="threshold" type="range" min="0.3" max="0.8" step="0.01" value="0.5"><output id="threshold-value">0.50</output></label><label>Repeat volume <input id="volume" type="range" min="0" max="0.5" step="0.01" value="0.22"><output id="volume-value">44%</output></label><p class="muted">Speakers uses echo cancellation. If the mic picks up the repeats, try headphones and press H.</p></details>
      <footer><span><kbd>Space</kbd> tap tempo</span><span><kbd>L</kbd> remember / clear</span><span><kbd>Shift Space</kbd> restart pulse</span><span><kbd>M / C</kbd> notes / click</span><span><kbd>H</kbd> output mode</span><span><kbd>Esc</kbd> silence & clear</span></footer>
    </main>`;
}
export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
