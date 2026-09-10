const english = document.documentElement.lang.toLowerCase().startsWith('en');
const feedback = document.querySelector('#copy-feedback');
const panel = document.querySelector('.freebie-panel');

function openLinkedGuide() {
  if (location.hash === '#freebie' && panel) panel.open = true;
}
openLinkedGuide();
window.addEventListener('hashchange', openLinkedGuide);
document.querySelectorAll('a[href="#freebie"]').forEach(link => {
  link.addEventListener('click', () => { if (panel) panel.open = true; });
});

document.querySelectorAll('[data-copy-target]').forEach(button => {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copyTarget);
    if (!code || !feedback) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      feedback.textContent = english ? 'Copied to clipboard.' : '已复制到剪贴板。';
    } catch {
      // Leave the command selected when clipboard permission is unavailable.
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(code);
      selection.removeAllRanges();
      selection.addRange(range);
      feedback.textContent = english
        ? 'Clipboard access is unavailable. The command is selected; press Ctrl+C or ⌘C to copy.'
        : '浏览器暂不允许访问剪贴板。命令已选中，请按 Ctrl+C 或 ⌘C 复制。';
    }
  });
});
