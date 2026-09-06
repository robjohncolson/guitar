# Recorded guitar test fixture

`guitar-plucks.wav` contains six edited plucks (G3, A3, B3, C4, D4, E4) from the [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MISguitar.html). Brian Penkrot played a Raimundo 118 acoustic guitar, recorded December 11, 2011 in an anechoic chamber with an Earthworks QTC40 microphone about five feet away.

The [collection's usage statement](https://theremin.music.uiowa.edu/MIS.html) permits downloading and using the samples for any project without restrictions. The recordings are not CREPE model assets and are not included in the deployed app.

Run `node scripts/vendor-guitar-fixture.mjs` to reproduce the fixture. Source URLs, original file hashes, detected source starts, and the generated WAV hash are in `guitar-plucks.json`. The script selects the first 550 ms of each source note, resamples 96 kHz mono to 48 kHz, normalizes peak level, and writes PCM16. Full source downloads stay in ignored `.cache/guitar-reference/`.

The browser test further trims and fades these plucks into annotated phrases with known attack/end times and rests. This exercises real recorded guitar through Chrome's microphone processing, AudioWorklet, and actual CREPE inference. It is an edited test sequence, not an unmodified live performance or a physical speaker-feedback test. Its detection scores apply to this fixture only.
