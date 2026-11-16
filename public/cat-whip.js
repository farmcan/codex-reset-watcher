// Visual playback is independent of scoring: active rounds absorb extra taps.
export function createCatWhip(button) {
  const video = button?.querySelector('video');
  const image = button?.querySelector('img');
  const audio = document.querySelector('#whip-audio');
  if (!button) return () => {};
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let active = false;
  let failed = false;
  let playback = 0;
  let timeout;
  let pendingFrame;

  function reset() {
    active = false;
    playback++;
    clearTimeout(timeout);
    if (pendingFrame !== undefined) video?.cancelVideoFrameCallback?.(pendingFrame);
    pendingFrame = undefined;
    button.classList.remove('is-whipping');
    video?.pause();
    audio?.pause();
  }
  function alignToReference() {
    if (!video?.videoWidth || !image) return;
    const width = image.naturalWidth || Number(image.getAttribute('width'));
    const height = image.naturalHeight || Number(image.getAttribute('height'));
    if (!width || !height) return;
    // Generation covered the reference image into a square, cropping its sides.
    // Invert that mapping. The unchanged reference fills the missing strips.
    const scale = Math.max(video.videoWidth / width, video.videoHeight / height);
    const overlayWidth = video.videoWidth / scale / width * 100;
    const overlayHeight = video.videoHeight / scale / height * 100;
    video.style.width = `${overlayWidth}%`;
    video.style.height = `${overlayHeight}%`;
    video.style.left = `${(100 - overlayWidth) / 2}%`;
    video.style.top = `${(100 - overlayHeight) / 2}%`;
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
  video?.addEventListener('loadedmetadata', alignToReference);
  image?.addEventListener('load', alignToReference);
  video?.addEventListener('loadedmetadata', setRate);
  video?.addEventListener('durationchange', setRate);
  video?.addEventListener('ended', reset);
  video?.addEventListener('error', () => { failed = true; reset(); });
  video?.addEventListener('playing', () => {
    if (!active) return;
    if (!button.classList.contains('is-whipping') && pendingFrame === undefined) {
      const round = playback;
      const reveal = () => {
        pendingFrame = undefined;
        if (active && round === playback) button.classList.add('is-whipping');
      };
      // Reveal an actually presented frame, never a stale decoder surface.
      if (video.requestVideoFrameCallback) pendingFrame = video.requestVideoFrameCallback(reveal);
      else reveal();
    }
    // A stalled/aborted stream must never strand the logo on a video frame.
    clearTimeout(timeout);
    timeout = setTimeout(reset, 1500);
  });
  reducedMotion.addEventListener('change', () => { if (reducedMotion.matches) reset(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) reset(); });
  setRate();
  alignToReference();

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
