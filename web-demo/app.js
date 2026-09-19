import { dialogue, parseTime, playerUrl } from './dialogue.js';

const $ = (selector) => document.querySelector(selector);
let timer;
let lastTime = 0;
function play(seconds, autoplay = true) {
  clearTimeout(timer);
  lastTime = seconds;
  const frame = document.createElement('iframe');
  frame.title = 'B 站原视频播放器';
  frame.allow = 'autoplay; fullscreen; picture-in-picture';
  frame.allowFullscreen = true;
  frame.src = playerUrl(seconds, autoplay);
  $('#player-status').textContent = `正在请求从 ${seconds} 秒起播；如未自动播放，请点击播放器。`;
  frame.addEventListener('load', () => {
    clearTimeout(timer);
    $('#player-status').textContent = `播放器页面已载入，目标 ${seconds} 秒。请在播放器中确认实际播放位置。`;
  });
  frame.addEventListener('error', () => {
    clearTimeout(timer);
    $('#player-status').textContent = '播放器页面加载失败，请重试或打开 B 站原视频。';
  });
  $('#player-wrap').replaceChildren(frame);
  $('#load').textContent = '重新加载';
  timer = setTimeout(() => {
    $('#player-status').textContent = '暂未确认播放器加载完成。如无法播放，请重试或打开 B 站原视频。';
  }, 15000);
}
$('#load').addEventListener('click', () => play(lastTime, false));
$('#seek-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const input = $('#seek');
  const seconds = parseTime(input.value);
  input.setCustomValidity(seconds === null ? '请输入有效时间，如 15 或 1:05，最大 86400 秒。' : '');
  if (input.reportValidity()) play(seconds);
});
$('#seek').addEventListener('input', (event) => event.target.setCustomValidity(''));
document.querySelectorAll('[data-seek]').forEach((button) => button.addEventListener('click', () => {
  $('#seek').value = button.dataset.seek;
  $('#seek').setCustomValidity('');
  play(Number(button.dataset.seek));
}));

const rows = dialogue.map(([speaker, en, zh], index) => {
  const article = document.createElement('article');
  article.className = 'sentence';
  // Only the fixed template is HTML; all dialogue and user input use textContent/value.
  article.innerHTML = '<div class="sentence-meta"><span></span><button type="button" class="timestamp">时间待校准</button></div><button class="zh" disabled></button><details><summary>展开英文</summary><p class="english" lang="en"></p></details><form class="timing" hidden><label></label><div class="input-row"><input inputmode="decimal" autocomplete="off" placeholder="例如 0:15"><button type="submit">设置时间</button></div></form>';
  article.querySelector('.sentence-meta span').textContent = `${String(index + 1).padStart(2, '0')} / ${speaker}`;
  const chinese = article.querySelector('.zh');
  const timestamp = article.querySelector('.timestamp');
  chinese.textContent = zh;
  article.querySelector('.english').textContent = en;
  const input = article.querySelector('input');
  input.id = `time-${index}`;
  const label = article.querySelector('label');
  label.htmlFor = input.id;
  label.textContent = '开始时间（秒或 分:秒）；留空可清除';
  let seconds = index * 5;
  input.value = String(seconds);
  chinese.disabled = false;
  article.querySelector('.timestamp').textContent = `${seconds} 秒 · 演示时间 ▶`;
  chinese.setAttribute('aria-label', `${zh}，从 ${seconds} 秒播放（演示时间）`);
  input.addEventListener('input', () => input.setCustomValidity(''));
  article.querySelector('form').addEventListener('submit', (event) => {
    event.preventDefault();
    const value = input.value.trim();
    const parsed = value ? parseTime(value) : null;
    input.setCustomValidity(value && parsed === null ? '请输入有效时间，如 15 或 1:05，最大 86400 秒。' : '');
    if (!input.reportValidity()) return;
    seconds = parsed;
    chinese.disabled = seconds === null;
    timestamp.disabled = seconds === null;
    article.querySelector('.timestamp').textContent = seconds === null ? '时间待校准' : `${seconds} 秒 · 手动设置 ▶`;
    chinese.setAttribute('aria-label', seconds === null ? zh : `${zh}，从 ${seconds} 秒播放`);
  });
  const playSentence = () => {
    if (seconds === null) return;
    document.querySelectorAll('.selected').forEach((row) => row.classList.remove('selected'));
    article.classList.add('selected');
    play(seconds);
    $('#player-wrap').scrollIntoView({ block: 'center' });
  };
  chinese.addEventListener('click', playSentence);
  timestamp.addEventListener('click', playSentence);
  const details = article.querySelector('details');
  details.addEventListener('toggle', () => {
    details.querySelector('summary').textContent = details.open ? '收起英文' : '展开英文';
    const allOpen = rows.every((row) => row.querySelector('details').open);
    $('#toggle-all').textContent = allOpen ? '收起全部英文' : '展开全部英文';
    $('#toggle-all').setAttribute('aria-pressed', String(allOpen));
  });
  return article;
});
$('#sentences').replaceChildren(...rows);
$('#toggle-all').addEventListener('click', () => {
  const open = !rows.every((row) => row.querySelector('details').open);
  rows.forEach((row) => { row.querySelector('details').open = open; });
});
$('#edit-times').addEventListener('change', (event) => {
  rows.forEach((row) => { row.querySelector('.timing').hidden = !event.target.checked; });
});
window.addEventListener('pagehide', () => { clearTimeout(timer); });
