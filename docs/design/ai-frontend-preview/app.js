'use strict';

// All numbers and links below are a self-contained, explicitly labelled demo.
const courses = [
  { name: '数据结构', code: 'CS · 202', score: 76.8, pass: 88, count: 186, x: 465, y: 329, r: 100, weekly: [35, 46, 41, 65, 61, 82], metrics: [76.8, 88, 91, 85, 82, 94], description: '从抽象结构到解决问题的路径。沿着出勤、作业和成绩，观察同一门课程的不同侧面。' },
  { name: '高等数学', code: 'MA · 101', score: 72.4, pass: 81, count: 212, x: 222, y: 154, r: 67, weekly: [48, 39, 58, 51, 65, 71], metrics: [72.4, 81, 86, 80, 75, 89], description: '从变化中寻找规律。在学习轮廓中，对照课程均分、出勤与完成情况。' },
  { name: '程序设计', code: 'CS · 101', score: 82.6, pass: 93, count: 196, x: 724, y: 197, r: 76, weekly: [32, 49, 55, 52, 76, 89], metrics: [82.6, 93, 94, 90, 88, 96], description: '让想法成为可以运行的表达。查看示意课程在六项学习指标上的不同表现。' },
  { name: '线性代数', code: 'MA · 103', score: 74.1, pass: 84, count: 178, x: 746, y: 489, r: 64, weekly: [29, 43, 40, 57, 62, 73], metrics: [74.1, 84, 88, 83, 79, 90], description: '在向量与空间中建立联系。不同的指标，为同一门课程提供互补的观察角度。' },
  { name: '大学英语', code: 'EN · 102', score: 79.3, pass: 91, count: 205, x: 349, y: 583, r: 61, weekly: [55, 57, 49, 70, 67, 81], metrics: [79.3, 91, 93, 89, 86, 94], description: '在持续练习中积累理解。把分散的活动与结果整理为清楚的学习轮廓。' },
  { name: '计算机网络', code: 'CS · 305', score: 78.5, pass: 89, count: 164, x: 126, y: 425, r: 70, weekly: [26, 40, 51, 47, 66, 79], metrics: [78.5, 89, 90, 84, 81, 92], description: '连接不同节点，理解信息流动。沿着六项示意指标，发现值得进一步关注的线索。' },
];
const metricLabels = ['课程均分', '通过率', '出勤率', '作业提交率', '按时提交率', '课程完成率'];
const $ = (id) => document.getElementById(id);
const root = document.documentElement;
let selected = 0;
let mode = 'canvas';
let detail = false;
let manualReduced = false;
const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

function spark(values, width = 120, height = 42) {
  return values.map((v, i) => `${(i * width / (values.length - 1)).toFixed(1)},${(height - v / 100 * (height - 8)).toFixed(1)}`).join(' ');
}

function renderNetwork() {
  const edges = [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 5], [2, 3], [3, 4], [4, 5]];
  const lines = edges.map(([a, b]) => {
    const p = courses[a], q = courses[b];
    const bend = (a + b) % 2 ? 55 : -65;
    return `<path class="network-link ${a === selected || b === selected ? 'related' : ''}" d="M${p.x},${p.y} Q${(p.x + q.x) / 2 + bend},${(p.y + q.y) / 2 - 35} ${q.x},${q.y}"/>`;
  }).join('');
  const nodes = courses.map((c, i) => `<g class="network-node ${selected === i ? 'active' : ''}" role="button" tabindex="0" aria-label="${c.name}，示意均分${c.score}分，点击查看焦点" aria-pressed="${selected === i}" data-course="${i}" transform="translate(${c.x},${c.y})">
    <circle class="node-halo" r="${c.r + 8}"/><circle class="node-wash" r="${c.r}"/><circle class="node-rim" r="${c.r - .8}"/>
    ${selected === i ? `<circle class="selected-ring" r="${c.r + 13}"/>` : ''}
    <text class="node-label" y="-25">${c.name}</text><text class="node-score" y="17" style="font-size:${i === 0 ? 44 : 32}px">${c.score}</text><text class="node-unit" y="40">${c.code}</text>
  </g>`).join('');
  $('network').innerHTML = `<ellipse class="orbit" cx="455" cy="355" rx="310" ry="223" transform="rotate(-19 455 355)"/><ellipse class="orbit" cx="455" cy="355" rx="350" ry="300" transform="rotate(12 455 355)"/>${lines}<g aria-hidden="true"><circle class="satellite-dot" cx="490" cy="80" r="2"/><text class="satellite-label" x="504" y="84">概念相连，路径延伸</text><circle class="satellite-dot" cx="568" cy="620" r="2"/><circle class="satellite-dot" cx="76" cy="254" r="2"/></g>${nodes}`;
  $('network').querySelectorAll('[data-course]').forEach((el) => {
    const pick = () => selectCourse(Number(el.dataset.course));
    el.addEventListener('click', pick);
    el.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pick(); const replacement = $('network').querySelector(`[data-course="${selected}"]`); replacement?.focus({ preventScroll: true }); } });
  });
}

function selectCourse(index, announce = true) {
  selected = index;
  const c = courses[selected];
  $('course-name').textContent = c.name;
  $('course-code').textContent = c.code;
  $('course-index').textContent = String(index + 1).padStart(2, '0');
  $('mean-score').innerHTML = `${c.score.toFixed(1)}<small>分</small>`;
  $('pass-rate').innerHTML = `${c.pass}<small>%</small>`;
  $('sample-count').textContent = c.count;
  $('explore-button').innerHTML = `探索${c.name} <span>↗</span>`;
  $('sparkline').innerHTML = `<polyline fill="none" stroke="var(--accent)" stroke-opacity=".65" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${spark(c.weekly)}"/><path d="M0,42 L${spark(c.weekly).replaceAll(' ', ' L')} L120,42 Z" fill="rgba(var(--accent-rgb),.045)"/>`;
  renderNetwork();
  updateStack();
  if (announce) $('announcer').textContent = `已聚焦${c.name}，示意均分${c.score}分，通过率${c.pass}%`;
}

function renderStack() {
  $('stack-scene').innerHTML = courses.map((c, i) => `<button class="stack-card" data-stack="${i}" aria-label="${c.name}，点选聚焦，再次点选进入课程">
    <span class="card-no">EXPLORATION / ${String(i + 1).padStart(2, '0')}</span><h2>${c.name}</h2><span class="card-code">${c.code} / COURSE PROFILE</span>
    <svg viewBox="0 0 240 130" aria-hidden="true">${c.metrics.map((v, j) => `<rect x="${j * 39 + 5}" y="${120 - v}" width="24" height="${v}" rx="3" fill="${j === 0 ? 'var(--accent)' : 'var(--ink)'}" opacity="${j === 0 ? .65 : .09 + j * .025}"/>`).join('')}</svg>
    <span class="card-value">${c.score}<small>分 / 课程均分</small></span><span class="card-bottom"><span>示意样本 ${c.count} 人</span><span>打开课程 ↗</span></span>
  </button>`).join('');
  $('stack-scene').querySelectorAll('[data-stack]').forEach((el) => el.addEventListener('click', () => { const i = Number(el.dataset.stack); if (selected === i) openDetail(); else selectCourse(i); }));
}

function updateStack() {
  const blur = Number($('blur-range').value) / 60;
  $('stack-scene').querySelectorAll('[data-stack]').forEach((card) => {
    const i = Number(card.dataset.stack), delta = i - selected, distance = Math.abs(delta);
    card.style.transform = `translate3d(${delta * 121}px,${-delta * 16 + (delta === 0 ? -30 : 0)}px,${delta === 0 ? 160 : -distance * 45}px)`;
    card.style.filter = `blur(${distance * .8 * blur}px)`;
    card.style.opacity = String(Math.max(.23, 1 - distance * .13));
    card.classList.toggle('current', i === selected);
    card.setAttribute('aria-pressed', String(i === selected));
  });
  $('stack-title').textContent = courses[selected].name;
  $('stack-position').textContent = `${String(selected + 1).padStart(2, '0')} / 06`;
  $('previous-card').disabled = selected === 0;
  $('next-card').disabled = selected === courses.length - 1;
}

function animateView(el) {
  el.classList.remove('view-enter');
  void el.offsetWidth;
  el.classList.add('view-enter');
}

function showMode(next) {
  mode = next;
  detail = false;
  $('detail-view').hidden = true;
  $('canvas-view').hidden = next !== 'canvas';
  $('overview-view').hidden = next !== 'overview';
  document.querySelectorAll('.mode').forEach((el) => { const active = el.dataset.mode === next; el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active)); });
  animateView($(next === 'canvas' ? 'canvas-view' : 'overview-view'));
  $('announcer').textContent = next === 'canvas' ? '课程全景，示意数据' : '空间全览，可用前后按钮或方向键选择主题';
}

function openDetail() {
  const c = courses[selected];
  detail = true;
  $('canvas-view').hidden = true;
  $('overview-view').hidden = true;
  $('detail-view').hidden = false;
  $('detail-title').textContent = c.name;
  $('detail-score').textContent = c.score;
  $('detail-description').textContent = c.description;
  $('detail-bars').innerHTML = c.metrics.map((v, i) => `<div class="bar-row"><span>${metricLabels[i]}</span><div class="bar-track"><div class="bar-fill" style="--value:${v}%;--delay:${i * 65}ms"></div></div><span>${v}${i ? '%' : ' 分'}</span></div>`).join('');
  animateView($('detail-view'));
  $('back-button').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setPanel(open) {
  $('appearance-panel').hidden = !open;
  $('settings-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('blur-range').focus({ preventScroll: true });
  else $('settings-toggle').focus({ preventScroll: true });
}

function updateMotion() {
  const reduced = manualReduced || systemMotion.matches;
  document.body.classList.toggle('reduced-motion', reduced);
  $('motion-toggle').setAttribute('aria-pressed', String(!reduced));
  $('motion-toggle').innerHTML = `${reduced ? '静态' : '动态'} <span class="motion-indicator" style="opacity:${reduced ? .25 : 1}"></span>`;
  $('motion-toggle').title = systemMotion.matches ? '跟随系统减少动态设置' : '切换动态效果';
}

document.querySelectorAll('.mode').forEach((el) => el.addEventListener('click', () => showMode(el.dataset.mode)));
document.querySelector('.brand').addEventListener('click', (event) => { event.preventDefault(); showMode('canvas'); window.scrollTo({ top: 0, behavior: 'instant' }); });
$('theme-toggle').addEventListener('click', () => { const dark = root.dataset.theme !== 'dark'; root.dataset.theme = dark ? 'dark' : 'light'; $('theme-toggle').setAttribute('aria-label', dark ? '切换到浅色主题' : '切换到深色主题'); });
$('open-detail').addEventListener('click', openDetail);
$('explore-button').addEventListener('click', openDetail);
$('back-button').addEventListener('click', () => { showMode(mode); document.querySelector(`.mode[data-mode="${mode}"]`).focus({ preventScroll: true }); });
$('previous-card').addEventListener('click', () => { if (selected > 0) selectCourse(selected - 1); });
$('next-card').addEventListener('click', () => { if (selected < courses.length - 1) selectCourse(selected + 1); });
$('settings-toggle').addEventListener('click', () => setPanel($('appearance-panel').hidden));
$('settings-close').addEventListener('click', () => setPanel(false));
$('blur-range').addEventListener('input', (event) => { const n = Number(event.target.value); root.style.setProperty('--edge-blur', `${n / 6}px`); root.style.setProperty('--far-blur', `${n / 37.5}px`); $('blur-value').textContent = `${n}%`; updateStack(); });
$('light-range').addEventListener('input', (event) => { const n = Number(event.target.value); root.style.setProperty('--light', n / 100); $('light-value').textContent = `${n}%`; });
document.querySelectorAll('.swatch').forEach((el) => el.addEventListener('click', () => { root.style.setProperty('--accent', el.dataset.color); root.style.setProperty('--accent-rgb', el.dataset.rgb); document.querySelectorAll('.swatch').forEach((button) => { const active = button === el; button.classList.toggle('selected', active); button.setAttribute('aria-pressed', String(active)); }); }));
$('motion-toggle').addEventListener('click', () => { manualReduced = !manualReduced; updateMotion(); });
systemMotion.addEventListener('change', updateMotion);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') { if (!$('appearance-panel').hidden) setPanel(false); else if (detail) { showMode(mode); document.querySelector(`.mode[data-mode="${mode}"]`).focus({ preventScroll: true }); } else if (mode === 'overview') showMode('canvas'); }
  if (event.target instanceof HTMLInputElement || !$('appearance-panel').hidden || mode !== 'overview' || detail) return;
  if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); selectCourse(Math.max(0, Math.min(courses.length - 1, selected + (event.key === 'ArrowRight' ? 1 : -1)))); }
});

renderStack();
selectCourse(0, false);
updateMotion();
