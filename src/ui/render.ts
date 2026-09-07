export function shell(): void {
  document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
    <main>
      <nav class="app-nav" aria-label="Guitar tools"><a href="/">Trainer</a><a href="/play.html?mode=partner">Partner</a><a href="/play.html?mode=looper">Looper</a></nav>
      <header><div><span class="eyebrow">GUITAR · LISTEN & REPLY</span><h1>Practice Partner</h1><p class="intro">Play a loop. I’ll answer on the offbeat.</p></div><button id="enable" class="primary">Start listening</button></header>
      <div class="status"><span id="mic">Mic off</span><span id="model">CREPE loading</span><span id="latency"></span></div>
      <section class="pulse-panel" aria-label="Tempo and listening">
        <div class="reply-choice"><label for="app-mode">Mode</label><select id="app-mode"><option value="partner">Partner</option><option value="looper">Looper</option></select><span class="mode-caption">Listen & reply / record</span></div>
        <div class="tempo"><label for="bpm">BPM</label><input id="bpm" type="number" min="40" max="240" step="1" value="100" inputmode="numeric" aria-describedby="tempo-help"><span id="tempo-help">Enter BPM · or tap Space</span></div>
        <div class="reply-choice partner-only"><label for="reply-mode">Reply</label><select id="reply-mode" aria-describedby="reply-mode-help"><option value="echo">Echo</option><option value="harmony" selected>Harmony</option></select><span id="reply-mode-help"></span></div>
        <div class="session-state"><span id="pulse" aria-hidden="true"></span><span id="phrase-status" role="status">Ready to listen</span></div>
        <button id="panic" disabled>Stop · Esc</button>
      </section>
      <p id="hint" class="hint" role="status">Enter BPM, start listening, and play a repeating idea.</p>
      <p id="reply-detail" class="muted partner-only">Notes and rests belong to the loop.</p>
      <section id="looper-panel" hidden aria-label="Four-bar audio loop">
        <div id="loop-progress" role="progressbar" aria-label="Four-bar loop progress" aria-valuemin="0" aria-valuemax="16" aria-valuenow="0"><span>1</span><span>2</span><span>3</span><span>4</span></div>
        <div id="loop-take" hidden><div class="loop-wave"><canvas id="loop-waveform" width="900" height="90" role="img" aria-label="Recorded four-bar waveform"></canvas><span id="loop-playhead" aria-hidden="true"></span></div>
          <p id="loop-take-detail" class="muted"></p><div class="loop-actions"><button id="loop-play">Play</button><button id="loop-undo">Undo replace</button><a id="loop-download" download="guitar-loop.wav">Download WAV</a><button id="loop-clear">Clear</button></div>
        </div>
      </section>
      <details id="settings"><summary>Listening settings</summary>
        <div class="toggles"><button id="listen-again" class="partner-only" disabled>Start fresh · L</button><button id="companion-mute">Replies on · M</button><button id="click-mute">Click off · C</button><button id="output">Speakers · H</button></div>
        <label><span id="volume-label">Reply volume</span> <input id="volume" type="range" min="0" max="0.5" step="0.01" value="0.22"><output id="volume-value">44%</output></label>
        <label class="partner-only"><input id="responsive" type="checkbox" checked> Soften replies while I play</label>
        <label class="partner-only">Voiced threshold <input id="threshold" type="range" min="0.3" max="0.8" step="0.01" value="0.5"><output id="threshold-value">0.50</output></label>
        <label id="loop-soften-label" hidden><input id="loop-soften" type="checkbox"> Soften the loop while I play · headphones</label>
        <p id="input-help" class="muted">Play individual plucks. Speakers uses echo cancellation. Headphones gives cleaner input.</p>
        <div class="last-notes partner-only"><span>You played <strong id="note">—</strong></span><span>Reply <strong id="reply">—</strong></span></div><p id="pitch-detail" class="muted partner-only">One note at a time</p>
      </details>
      <details id="listening-check" class="partner-only"><summary>Check what I heard</summary>
        <p id="capture-status">Record up to 20 seconds to compare your playing with what I heard.</p><button id="capture" disabled>Record a listening check</button>
        <canvas id="capture-plot" width="900" height="165" role="img" aria-label="Recorded waveform with detected note lengths and reply notes"></canvas>
        <p class="muted">Waveform above · green notes heard · brown notes masked · blue replies. Spaces between note bars show pauses; unfinished lengths remain uncertain.</p>
        <audio id="capture-audio" controls hidden></audio><div id="capture-downloads" hidden><a id="download-audio" download="guitar-listening.wav">Download audio</a><a id="download-trace" download="guitar-listening.json">Download note timings</a></div>
        <p class="muted">Recording starts only when you press the button. The clip stays in this page until you download it or leave.</p>
      </details>
      <footer><span><kbd>Space</kbd> tap tempo</span><span class="partner-only"><kbd>L</kbd> start fresh</span><span><kbd>M / C</kbd> mute / click</span><span><kbd>H</kbd> output mode</span><span><kbd>Esc</kbd> stop</span></footer>
    </main>`;
}
export const element = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
