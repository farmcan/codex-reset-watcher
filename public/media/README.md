# Cat whip interaction assets

`cat-whip.mp4` is the user-supplied clip, downloaded on 2026-11-13 and kept
unchanged as a project-owned static asset. Runtime never requests the signed URL.

- H.264, 960×960, 24fps, duration 4.041667 seconds; no audio track.
- SHA-256: `3a257b8064fa66313e786b8f1a62c15860ac679aa027a1ccc954ae5fa6115b4e`.
- Playback rate is computed from loaded metadata: `duration / 0.75`.
- The complete clip fits the original 960×905 image box with `object-fit: fill`.
  This slightly adjusts the vertical aspect, retains all text and the pink icon,
  and leaves the original image, logo dimensions and layout intact.
- The supplied clip has Chinese text. The English page keeps its original image
  with the shared counter, +1 feedback and sound; it does not substitute Chinese
  video for the English brand image.

`cat-whip.wav` reuses Joseph SARDIN / BigSoundBank's **Complete whip #1**,
licensed CC0-1.0. Source and license checked again on 2026-11-13:

- Source: https://bigsoundbank.com/fouet-complet-1-s2961.html
- License: https://bigsoundbank.com/licenses.html
- Original MP3 SHA-256: `0ed63ec0a8863b82622f23297b45b672bc5e5346a52d0c82d411c525196a9598`.
- Reused the existing reviewed 48kHz mono 0.55s excerpt, with 3ms attack/20ms
  release and peak amplitude 0.55. Added 110ms silence so the crack peak falls
  at ~0.37s, matching the strike at accelerated video speed.
- One shared audio element per page; no overlapping sound during active rounds.
  Sound starts only after a click, and the existing sound switch mutes it.
