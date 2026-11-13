# Cat whip interaction assets

All four user-supplied videos were downloaded unchanged on 2026-11-13 and are
tracked directly in Git. Together they are 5,702,632 bytes (about 5.44 MiB);
no Git LFS, generation API, API key or expiring runtime URL is needed.

| Asset | Use |
| --- | --- |
| `cat-whip-zh-01.mp4` | Chinese 01, archived alternative |
| `cat-whip-zh-02.mp4` | **Active Chinese 02, user-selected** |
| `cat-whip-zh-03.mp4` | Chinese 03, archived alternative |
| `cat-whip-en.mp4` | **Active English version** |

Exact sizes, SHA-256, durations and dimensions are in `manifest.json`. Both active
videos are H.264, 960×960, 24fps, 4.041667 seconds and have no audio track. Only the
active locale's video is loaded by the page. Metadata determines playback speed:
`video.playbackRate = video.duration / 0.75`.

The original image remains underneath and owns the logo's layout: Chinese
960×905, English 960×960. Video uses `object-fit: contain` on a white background.
The Chinese square clip has thin side letterboxes in the original rectangular
frame; English fills its square frame. Neither is stretched or cropped. This
corrects the initial release's `object-fit: fill`, which compressed the Chinese
video vertically and was rejected by the user. The original top text and pink
icon are retained.

`cat-whip.wav` is a short, sharper **Whip crack #1** by Joseph SARDIN / BigSoundBank,
CC0-1.0, source/license checked on 2026-11-13:

- Source: https://bigsoundbank.com/fouet-1-s2949.html
- License: https://bigsoundbank.com/licenses.html
- Reuses the existing reviewed 48kHz mono 0.25s excerpt; applies a 180Hz highpass,
  +4dB treble at 3.2kHz, 1.5× gain and 0.85 limiter, then 315ms leading silence.
- Crack peak is at ~0.37s, matching the strike in the accelerated clip. The
  actual crack remains short; total duration including leading silence is 0.565s.
- One shared audio element per page, played only after a click and once per
  active round. Extra taps never stack sounds. The sound switch mutes it.
- Replaces the initial softer 0.55s full-whip excerpt after user feedback.
