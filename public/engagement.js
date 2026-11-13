import { createCatWhip } from './cat-whip.js?v=20261113-2';

const english = document.documentElement.lang.startsWith('en');
const text = (zh, en) => english ? en : zh;
const visits = document.querySelector('#visit-count');
const wishes = document.querySelector('#like-count');
const dailyVisitors = document.querySelector('#daily-visitors');
const button = document.querySelector('#like-button');
const catButton = document.querySelector('#cat-button');
const whip = createCatWhip(catButton);
const soundButton = document.querySelector('#whip-sound');
const whipAudio = document.querySelector('#whip-audio');
const feedback = document.querySelector('#whip-feedback');
const note = document.querySelector('#engagement-note');
const fallback = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('snapshot');
const format = new Intl.NumberFormat(english ? 'en' : 'zh-CN');
let soundEnabled = true;
let taps = 0;
let displayedWishes = 0;

function catFeedback() {
  const float = document.createElement('span');
  float.className = 'wish-float cat-plus';
  float.textContent = '+1';
  float.setAttribute('aria-hidden', 'true');
  // Bound visible particles without delaying or dropping any scoring action.
  catButton.querySelectorAll('.cat-plus').forEach((item, index, all) => { if (index < all.length - 11) item.remove(); });
  catButton.append(float);
  setTimeout(() => float.remove(), 550);
  whip();
}

soundButton.addEventListener('click', () => {
  soundEnabled = !soundEnabled;
  whipAudio.muted = !soundEnabled;
  soundButton.setAttribute('aria-pressed', String(soundEnabled));
  soundButton.textContent = soundEnabled ? text('声音开', 'Sound on') : text('开声音', 'Sound off');
});

if (fallback) {
  soundButton.hidden = true;
  note.replaceChildren(Object.assign(document.createElement('a'), {
    href: `https://resetcat.pages.dev/${english ? 'en/' : ''}`,
    textContent: text('去实时站甩鞭，求重置 ↗', 'Make a reset wish on the live site ↗')
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
  if (catButton) catButton.disabled = false;
  const defaultNote = note.textContent;
  async function request(action, eventId = crypto.randomUUID(), initial = false) {
    const response = await fetch(`/api/engagement${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET', cache: 'no-store', keepalive: Boolean(action),
      headers: action ? { 'Content-Type': 'application/json' } : { 'X-Visitor-ID': visitor },
      ...(action ? { body: JSON.stringify({ visitor_id: visitor, event_id: eventId }) } : {})
    });
    if (!response.ok) throw new Error('engagement_unavailable');
    const data = await response.json();
    // Fetch the baseline before sending local taps. Responses can arrive out of
    // order; none may erase optimistic +1s already shown for this visit.
    displayedWishes = initial ? data.likes + taps : Math.max(displayedWishes, data.likes);
    wishes.textContent = format.format(displayedWishes);
    visits.textContent = format.format(data.visits);
    dailyVisitors.textContent = format.format(data.daily_visitors);
    return data;
  }
  async function wish() {
    taps++;
    displayedWishes++;
    wishes.textContent = format.format(displayedWishes);
    catFeedback();
    feedback.textContent = text(`本页已甩鞭 ${format.format(taps)} 次`, `${format.format(taps)} cracks this visit`);
    const eventId = crypto.randomUUID();
    try {
      await initialTotals;
      // A retry reuses the action ID, so one physical tap is never counted twice.
      await request('like', eventId).catch(() => request('like', eventId));
      note.textContent = defaultNote;
    } catch {
      note.textContent = text('这次甩鞭暂未确认，稍后再试。', 'This tap is not confirmed. Try again later.');
    }
  }
  button.addEventListener('click', wish);
  catButton?.addEventListener('click', wish);
  // Visible pages keep the session alive; returning after a 30-minute gap starts one.
  if (storedVisitor) {
    setInterval(() => { if (!document.hidden) request('visit').catch(() => {}); }, 5 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) request('visit').catch(() => {}); });
  }
  const initialTotals = request(storedVisitor ? 'visit' : '', undefined, true).catch(() => {
    note.textContent = text('累计暂不可用，仍可点击小猫重试。', 'Totals unavailable. Tap the cat again to retry.');
  });
}
