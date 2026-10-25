const english = document.documentElement.lang.startsWith('en');
const text = (zh, en) => english ? en : zh;
const visits = document.querySelector('#visit-count');
const likes = document.querySelector('#like-count');
const button = document.querySelector('#like-button');
const label = document.querySelector('#like-label');
const note = document.querySelector('#engagement-note');
const fallback = location.hostname.endsWith('github.io') || new URLSearchParams(location.search).has('snapshot');

if (fallback) {
  note.replaceChildren(Object.assign(document.createElement('a'), {
    href: `https://codex-reset-watcher.weican16hit.workers.dev/${english ? 'en/' : ''}`,
    textContent: text('到实时站查看访问量与点赞 ↗', 'View visits and like on the live site ↗')
  }));
} else {
  let visitor;
  try {
    visitor = localStorage.getItem('watcher-visitor-v1');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(visitor || '')) {
      visitor = crypto.randomUUID();
      localStorage.setItem('watcher-visitor-v1', visitor);
    }
  } catch {
    visitor = undefined;
    // Keep totals available when storage is blocked; do not inflate visits or likes.
  }
  let liked = false;
  const defaultNote = note.textContent;
  async function request(action) {
    const response = await fetch(`/api/engagement${action ? `/${action}` : ''}`, {
      method: action ? 'POST' : 'GET', cache: 'no-store',
      headers: action ? { 'Content-Type': 'application/json' } : visitor ? { 'X-Visitor-ID': visitor } : {},
      ...(action ? { body: JSON.stringify({ visitor_id: visitor }) } : {})
    });
    if (!response.ok) throw new Error('engagement_unavailable');
    const data = await response.json();
    note.textContent = defaultNote;
    const format = new Intl.NumberFormat(english ? 'en' : 'zh-CN');
    visits.textContent = format.format(data.visits);
    likes.textContent = format.format(data.likes);
    liked = data.liked;
    button.setAttribute('aria-pressed', String(liked));
    label.textContent = liked ? text('已点赞', 'Liked') : text('点赞', 'Like');
    button.disabled = liked || !visitor;
  }
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await request('like');
    } catch {
      note.textContent = text('点赞暂未确认，请重试。', 'Like not confirmed. Please retry.');
      button.disabled = liked || !visitor;
    }
  });
  request(visitor ? 'visit' : '').catch(() => {
    note.textContent = text('计数暂不可用，请稍后刷新。', 'Counts unavailable. Please refresh later.');
  });
}
