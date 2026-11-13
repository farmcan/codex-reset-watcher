// Visual playback is independent of scoring: active rounds absorb extra taps.
export function createCatWhip(button) {
  const video = button?.querySelector('video');
  const audio = document.querySelector('#whip-audio');
  if (!button) return () => {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let failed = false;
  let playback = 0;
  let timeout;

  function reset() {
    active = false;
    playback++;
    clearTimeout(timeout);
    button.classList.remove('is-whipping');
    video?.pause();
    audio?.pause();
  }
  function setRate() {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    try {
      video.playbackRate = video.duration / 0.75;
    } catch {
      failed = true;
      reset();
    }
  }
  if (video) video.muted = true;
  video?.addEventListener('loadedmetadata', setRate);
  video?.addEventListener('durationchange', setRate);
  video?.addEventListener('ended', reset);
  video?.addEventListener('error', () => { failed = true; reset(); });
  video?.addEventListener('playing', () => {
    if (!active) return;
    button.classList.add('is-whipping');
    // A stalled/aborted stream must never strand the logo on a video frame.
    clearTimeout(timeout);
    timeout = setTimeout(reset, 1500);
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  setRate();

  return function play() {
    if (active || document.hidden) return;
    active = true;
    const round = ++playback;
    // Audio failures must not prevent the visual or scoring action.
    try {
      if (audio && !audio.muted) {
        audio.currentTime = 0;
        audio.play().catch(() => {});
      }
    } catch { /* Optional audio can be unavailable on this device. */ }
    try {
      if (!video || failed || reducedMotion.matches) {
        timeout = setTimeout(reset, 750);
        return;
      }
      // Only a NEW round seeks. No restarts or queued rounds during rapid taps.
      video.currentTime = 0;
      setRate();
      if (!active) return;
      timeout = setTimeout(reset, 2000);
      video.play().catch(() => { if (round === playback) reset(); });
    } catch { reset(); }
  };
}
