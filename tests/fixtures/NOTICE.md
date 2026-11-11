# Recorded guitar test fixture

`guitar-plucks.wav` contains six edited plucks (G3, A3, B3, C4, D4, E4) from the [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MISguitar.html). Brian Penkrot played a Raimundo 118 acoustic guitar, recorded December 11, 2011 in an anechoic chamber with an Earthworks QTC40 microphone about five feet away.

The [collection's usage statement](https://theremin.music.uiowa.edu/MIS.html) permits downloading and using the samples for any project without restrictions. The recordings are not CREPE model assets and are not included in the deployed app.

Run `node scripts/vendor-guitar-fixture.mjs` to reproduce the fixture. Source URLs, original file hashes, detected source starts, and the generated WAV hash are in `guitar-plucks.json`. The script selects the first 550 ms of each source note, resamples 96 kHz mono to 48 kHz, normalizes peak level, and writes PCM16. Full source downloads stay in ignored `.cache/guitar-reference/`.

The browser test further trims and fades these plucks into annotated phrases with known attack/end times and rests. This exercises real recorded guitar through Chrome's microphone processing, AudioWorklet, and actual CREPE inference. It is an edited test sequence, not an unmodified live performance or a physical speaker-feedback test. Its detection scores apply to this fixture only.

# Recorded piano test fixture

`piano-notes.wav` holds twelve 1.5 s piano notes (D2, G2, A3, B3, C4, D♭4, D4, E4, G♭4, G4, G♭5, A5) from the [University of Iowa Musical Instrument Samples](https://theremin.music.uiowa.edu/MISpiano.html): a Steinway & Sons model B played mf, recorded in 2001 (same usage statement as above: any project, without restrictions). They cover the Gymnopédie left-hand chords and bass, its first melody notes, and the neighbouring pitches used as wrong notes. Tests mix them into takes with known timing.

Run `node scripts/vendor-piano-fixture.mjs` to reproduce it: it downloads the AIFF files into ignored `.cache/piano-reference/`, finds each hammer attack, low-passes at 10 kHz, resamples to 24 kHz mono and applies one gain to all notes so their recorded loudness relationships stay. URLs, source hashes and onsets are in `piano-notes.json`.

# Gymnopédie No. 1 MIDI

`gymnopedie-1.mid` is the Mutopia Project's MIDI rendering of its public-domain LilyPond edition (piece 37, typeset by Evin Robertson; "Placed in the public domain by the typesetter"). It is the independent reference the piece file is compared with in `tests/piece-notation.test.ts`. MIDI cannot hold a sustained melody note while the accompaniment restrikes the same key, so lengths are compared only where no such unison overlaps.
