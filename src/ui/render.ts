export function shell(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main>
      <header><div><span class="eyebrow">GUITAR · TWO-BEAT REPEATER</span><h1>Practice Partner</h1><p class="intro">Your note. Two beats later.</p></div><button id="enable" class="primary">Enable audio & mic</button></header>
      <div class="status"><span id="mic">Mic off</span><span id="model">CREPE loading</span><span id="latency"></span></div>
      <section class="pulse-panel" aria-label="Tempo and pulse">
        <div class="tempo"><label for="bpm">BPM</label><input id="bpm" type="number" min="40" max="240" step="1" value="100" inputmode="numeric" aria-describedby="tempo-help"><span id="tempo-help">Enter tempo or tap Space</span></div>
        <div class="delay"><strong>2<span>beats</span></strong><span id="delay-seconds">1.20 seconds later</span></div>
        <div class="beats">${[1,2,3,4].map(n => `<div class="beat"><span>${n}</span><small>—</small></div>`).join('')}</div>
      </section>
      <p id="hint" class="hint" role="status">Set your BPM, enable audio, and play a note.</p>
      <section class="listening" aria-label="Repeater activity">
        <div><span class="eyebrow">YOU PLAYED</span><div id="note" class="note">—</div><span id="pitch-detail" class="muted">One note at a time</span></div>
        <div><span class="eyebrow">REPEAT</span><div id="echo-note" class="note cool">—</div><span id="queue" class="muted">Ready for your first note</span></div>
      </section>
      <div class="toggles"><button id="companion-mute">Repeater on · M</button><button id="click-mute">Click on · C</button><button id="output">Speakers · H</button><button id="panic">Silence · Esc</button></div>
      <details><summary>Listening settings</summary><label>Voiced threshold <input id="threshold" type="range" min="0.3" max="0.8" step="0.01" value="0.5"><output id="threshold-value">0.50</output></label><label>Repeat volume <input id="volume" type="range" min="0" max="0.5" step="0.01" value="0.22"><output id="volume-value">44%</output></label><p class="muted">Speakers uses echo cancellation. If the mic picks up the repeats, try headphones and press H.</p></details>
      <footer><span><kbd>Space</kbd> tap tempo</span><span><kbd>Shift Space</kbd> restart pulse</span><span><kbd>M / C</kbd> repeater / click</span><span><kbd>H</kbd> output mode</span><span><kbd>Esc</kbd> silence & clear repeats</span></footer>
    </main>`;
}
export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
