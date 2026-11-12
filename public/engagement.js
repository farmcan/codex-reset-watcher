const english = document.documentElement.lang.startsWith('en');
const text = (zh, en) => english ? en : zh;
const visits = document.querySelector('#visit-count');
const wishes = document.querySelector('#like-count');
const dailyVisitors = document.querySelector('#daily-visitors');
const button = document.querySelector('#like-button');
const soundButton = document.querySelector('#woodfish-sound');
const feedback = document.querySelector('#woodfish-feedback');
const note = document.querySelector('#engagement-note');
const fallback = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('snapshot');
const format = new Intl.NumberFormat(english ? 'en' : 'zh-CN');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let soundEnabled = false;
let audio;
let taps = 0;
let displayedWishes = 0;

function knock() {
  if (reduceMotion.matches) return;
  button.getAnimations().forEach(animation => animation.cancel());
  button.animate([{ transform: 'scale(1)' }, { transform: 'scale(.94) rotate(-2deg)' }, { transform: 'scale(1)' }], { duration: 200 });
  const float = document.createElement('span');
  float.className = 'wish-float';
  float.textContent = text('求重置 +1', 'Reset wish +1');
  float.setAttribute('aria-hidden', 'true');
  button.parentElement.querySelectorAll('.wish-float').forEach((item, index, all) => { if (index < all.length - 5) item.remove(); });
  button.parentElement.append(float);
  setTimeout(() => float.remove(), 850);
}

function playKnock() {
  if (!soundEnabled) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    audio.resume().catch(() => {});
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    const start = audio.currentTime;
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(720, start);
    oscillator.frequency.exponentialRampToValueAtTime(340, start + .075);
    gain.gain.setValueAtTime(.22, start);
    gain.gain.exponentialRampToValueAtTime(.001, start + .13);
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start(start);
    oscillator.stop(start + .14);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  } catch { /* Audio is optional; a tap still reaches the counter. */ }
}

soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  soundButton.setAttribute('aria-pressed', String(soundEnabled));
  soundButton.textContent = soundEnabled ? text('声音开', 'Sound on') : text('开声音', 'Sound off');
  if (soundEnabled) playKnock();
});

if (fallback) {
  soundButton.hidden = true;
  note.replaceChildren(Object.assign(document.createElement('a'), {
    href: `https://resetcat.pages.dev/${english ? 'en/' : ''}`,
    textContent: text('去实时站敲木鱼，求重置 ↗', 'Make a reset wish on the live site ↗')
  }));
} else {
  let visitor;
  let storedVisitor = true;
  try {
    visitor = localStorage.getItem('watcher-visitor-v1');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(visitor || '')) {
      visitor = crypto.randomUUID();
      localStorage.setItem('watcher-visitor-v1', visitor);
    }
  } catch {
    // A session-only anonymous ID also lets storage-blocked visitors tap.
    visitor = crypto.randomUUID();
    storedVisitor = false;
  }
  button.disabled = false;
  const defaultNote = note.textContent;
  async function request(action, eventId = crypto.randomUUID()) {
    const response = await fetch(`/api/engagement${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET', cache: 'no-store', keepalive: Boolean(action),
      headers: action ? { 'Content-Type': 'application/json' } : { 'X-Visitor-ID': visitor },
      ...(action ? { body: JSON.stringify({ visitor_id: visitor, event_id: eventId }) } : {})
    });
    if (!response.ok) throw new Error('engagement_unavailable');
    const data = await response.json();
    // Parallel taps may return out of order. Only show confirmed cumulative totals.
    displayedWishes = Math.max(displayedWishes, data.likes);
    wishes.textContent = format.format(displayedWishes);
    visits.textContent = format.format(data.visits);
    dailyVisitors.textContent = format.format(data.daily_visitors);
    return data;
  }
  button.addEventListener('click', async () => {
    taps++;
    knock();
    playKnock();
    feedback.textContent = text(`本页已敲 ${format.format(taps)} 下`, `${format.format(taps)} taps this visit`);
    const eventId = crypto.randomUUID();
    try {
      // A retry reuses the action ID, so one physical tap is never counted twice.
      await request('like', eventId).catch(() => request('like', eventId));
      note.textContent = defaultNote;
    } catch {
      note.textContent = text('这一敲暂未确认，稍后再试。', 'This tap is not confirmed. Try again later.');
    }
  });
  // Visible pages keep the session alive; returning after a 30-minute gap starts one.
  if (storedVisitor) {
    setInterval(() => { if (!document.hidden) request('visit').catch(() => {}); }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) request('visit').catch(() => {}); });
  }
  request(storedVisitor ? 'visit' : '').catch(() => {
    note.textContent = text('累计暂不可用，仍可敲木鱼重试。', 'Totals unavailable. Tap again to retry.');
  });
}
