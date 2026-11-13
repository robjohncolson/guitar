# Piano samples

The MP3 files in this folder are edited recordings from the [University of Iowa Electronic Music Studios Musical Instrument Samples](https://theremin.music.uiowa.edu/MISpiano.html): a Steinway & Sons model B played mf, recorded in 2001. They are the sampled piano the Pieces page plays back; `manifest.json` lists each note's MIDI number, file, playback `gain` and measured `cents` detune (positive = sharp).

## Edits

For every minor third from A0 to C8 (A, C, E♭, G♭ in each octave) the upstream AIFF recording (`Piano.mf.<Name>.aiff`, 44.1 kHz) was:

- trimmed to start 2 ms before the hammer attack, which is found at sample precision, dropping the leading silence;
- reduced to mono, resampled to 44.1 kHz if needed, and cut to at most 6 s, earlier where the note has decayed to 60 dB below its peak or into the recording's own noise floor, with a 250 ms raised-cosine fade-out;
- scaled by one common factor for the whole set so no sample exceeds 0.95, then encoded as MP3 (libmp3lame, constant bitrate chosen to keep the set under 2.6 MB);
- measured for detune (fundamental fitted from partials 1-12, allowing for string inharmonicity) and for attack loudness, defined as the peak of the 5 ms RMS frames (non-overlapping, 20 frames) over the first 100 ms from the trimmed onset; `gain` is the set's median attack level divided by the note's, clamped to plus or minus 6 dB (0.501 to 1.995), so notes beyond that range keep the recordings' natural balance (B0, C7, E♭7 are lifted by the maximum and G♭5 is lowered by it).

Not included: the upstream collection has no A0 recording, so B0 (MIDI 23) stands in for the bottom of the range and is listed under its own pitch. The A7 and C8 recordings measure 57 and 55 cents flat against equal temperament, so they are left out; the highest note is G♭7. The vendor script reports both decisions.

Reproduce with `npm run vendor:piano` (`node scripts/vendor-piano-samples.mjs`; requires ffmpeg on PATH). Source downloads are cached in the git-ignored `.cache/piano-reference/`. `npm run check:piano` decodes the shipped files and verifies pitch (within 10 cents of the manifest), clipping, onset, gains within the clamp, attack levels within 3 dB of the median after gain (for unclamped notes), size and length.

## Terms

Source: <https://theremin.music.uiowa.edu/MIS.html>, read 2026-11-13. Its usage statement says:

> Since 1997, these recordings have been freely available on this website and may be downloaded and used for any projects, without restrictions.

The statement does not require attribution; this notice credits the University of Iowa Electronic Music Studios and Lawrence Fritts, the collection's creator, as a courtesy.
