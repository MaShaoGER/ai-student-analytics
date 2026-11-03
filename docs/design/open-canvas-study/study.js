'use strict';
// Opus 交互改版 · 概念循环
// 每一页 = 中心（课程或指标）+ 显式范围 + 当前画法。
// 左层：围绕中心的关联内容（可点，点了换中心）；右层：同一份数据的不同画法（只换表达，不换数据/范围）。
const D = window.CANVAS_DATA, R = window.CANVAS_RELATIONS;
const stage = document.querySelector('#stage');
const systemMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const COURSES = Object.keys(R.byCourse);
const facts = name => R.byCourse[name];
const binsOf = name => (D.courses.find(c => c.name === name) || {}).bins;
const esc = s => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const fx = (v, d = 1) => v == null ? '—' : (+v).toFixed(d);
const pct = v => v == null ? '—' : `${fx(v, 2)}%`;
const narrow = () => window.innerWidth <= 760;

const METRICS = {
  attendance: { name: '出勤率', unit: '%', read: c => facts(c).attendanceRate, show: pct, note: '出勤课时 ÷ 应到课时' },
  score: { name: '均分', unit: '分', read: c => facts(c).meanScore, show: v => `${fx(v, 2)} 分`, note: '课程成绩平均值（百分制）' },
  pass: { name: '通过率', unit: '%', read: c => facts(c).passRate, show: pct, note: '成绩 ≥ 60 人数 ÷ 课程人数' },
  completion: { name: '课程完成率', unit: '%', read: c => facts(c).completionRate, show: pct, note: '完成课程人数 ÷ 课程人数（不是目标达成率）' },
  homework: { name: '作业提交率', unit: '%', read: c => facts(c).homeworkRate, show: pct, note: '已交作业 ÷ 应交作业' },
  ontime: { name: '按时提交率', unit: '%', read: c => facts(c).onTimeRate, show: pct, note: '按时作业 ÷ 应交作业' },
};
const ORDER = ['attendance', 'score', 'pass', 'completion', 'homework', 'ontime'];

// 每个指标中心的关联；scope:'all' 表示该关系显式扩大到 18 门课。
// links：这条关系里出现、可继续点的其它指标。
const RELATIONS = {
  attendance: [
    { id: 'band-score', title: '出勤率 – 成绩', q: '不同出勤区间的学生，均分是多少？', scope: 'course', views: ['bars', 'dots'], links: ['score'] },
    { id: 'band-pass', title: '出勤率 – 通过率', q: '不同出勤区间的学生，通过率是多少？', scope: 'course', views: ['bars', 'dots'], links: ['pass'] },
    { id: 'trend', title: '出勤率 – 教学周', q: '16 周里每周出勤如何变化？', scope: 'course', views: ['line', 'bars'], links: [] },
    { id: 'subject', title: '出勤率 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
  score: [
    { id: 'dist', title: '成绩分布', q: '这门课的人落在哪些分数段？', scope: 'course', views: ['bars', 'dots'], links: ['pass'] },
    { id: 'band-score', title: '出勤率 – 成绩', q: '出勤高低与均分', scope: 'course', views: ['bars', 'dots'], links: ['attendance'] },
    { id: 'subject', title: '均分 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
  pass: [
    { id: 'split-pass', title: '60 分两侧人数', q: '及格与不及格各多少人？', scope: 'course', views: ['stack', 'bars'], links: ['score'] },
    { id: 'band-pass', title: '出勤率 – 通过率', q: '出勤高低与通过率', scope: 'course', views: ['bars', 'dots'], links: ['attendance'] },
    { id: 'subject', title: '通过率 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
  completion: [
    { id: 'split-done', title: '完成 / 未完成人数', q: '多少人完成了课程？', scope: 'course', views: ['stack', 'bars'], links: [] },
    { id: 'subject', title: '课程完成率 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
  homework: [
    { id: 'work', title: '作业去向', q: '应交作业中按时、迟交、缺交各多少？', scope: 'course', views: ['stack', 'bars'], links: ['ontime'] },
    { id: 'subject', title: '作业提交率 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
  ontime: [
    { id: 'work', title: '作业去向', q: '应交作业中按时、迟交、缺交各多少？', scope: 'course', views: ['stack', 'bars'], links: ['homework'] },
    { id: 'subject', title: '按时提交率 – 学科', q: '同一指标放到 18 门课里看', scope: 'all', views: ['rank', 'dots'], links: [] },
  ],
};
const VIEW_NAME = { line: '折线', bars: '柱形', dots: '点位', rank: '排序条', stack: '堆叠条', radar: '雷达' };
const HOME_VIEWS = ['rank', 'dots'];
const COURSE_VIEWS = ['bars', 'dots', 'radar'];

const S = { entries: [{ type: 'home', view: 'rank', views: ['rank'], scroll: 0 }], index: 0, overview: false, ai: false, earlier: false, archived: [], draft: '', context: true, motion: false };
const entry = () => S.entries[S.index];
const relOf = e => RELATIONS[e.metric].find(r => r.id === e.rel);
const reduced = () => S.motion || systemMotion.matches;

function scopeText(e) {
  if (e.type === 'home') return '2025J · 18 门课程';
  if (e.type === 'metric' && relOf(e).scope === 'all') return `2025J · 全部 18 门课程（由「${e.course}」显式扩展）`;
  return `2025J · ${e.course} · ${facts(e.course).n} 人`;
}
function titleOf(e) {
  if (e.type === 'home') return '课程全景';
  if (e.type === 'course') return e.course;
  return relOf(e).title;
}
function centreOf(e) {
  if (e.type === 'home') return '18 门课程 · 均分';
  if (e.type === 'course') return `课程 · ${e.course}`;
  return `指标 · ${METRICS[e.metric].name}`;
}

// ---------- 数据：每一页只有一份数据，所有画法都画它 ----------
function dataOf(e) {
  if (e.type === 'home') return { kind: 'courses', metric: 'score', items: COURSES.map(c => ({ course: c, v: facts(c).meanScore })) };
  if (e.type === 'course') return { kind: 'profile', course: e.course, items: ORDER.map(k => ({ key: k, v: METRICS[k].read(e.course) })) };
  const f = facts(e.course);
  switch (e.rel) {
    case 'trend': return { kind: 'series', unit: '%', min: 60, max: 100, axis: '教学周', yName: '出勤率 / %', items: f.weeklyAttendance.map(w => ({ label: w.week, v: w.rate, tip: `第 ${w.week} 周 · ${w.attended}/${w.scheduled} 课时 · ${pct(w.rate)}` })) };
    case 'dist': return { kind: 'series', unit: '人', axis: '成绩区间 / 分', yName: '人数', ref: 6, items: binsOf(e.course).map((v, i) => ({ label: `${i * 10}`, v, tip: `${i * 10}–${i === 9 ? 100 : i * 10 + 10} 分 · ${v} 人` })) };
    case 'band-score': case 'band-pass': {
      const key = e.rel === 'band-score' ? 'meanScore' : 'passRate', unit = key === 'meanScore' ? '分' : '%';
      return { kind: 'series', unit, min: 0, max: 100, axis: '个人学期出勤率区间 / %', yName: key === 'meanScore' ? '均分 / 分' : '通过率 / %', items: f.attendanceBands.map(b => ({ label: b.label, v: b[key], n: b.n, suppressed: b.suppressed, tip: b.suppressed ? `${b.label}% · 人数 1–2，已隐藏` : b.n === 0 ? `${b.label}% · 无人` : `${b.label}% · ${b.n} 人 · ${key === 'meanScore' ? fx(b.meanScore, 2) + ' 分' : pct(b.passRate)}` })) };
    }
    case 'split-pass': { const c = D.courses.find(x => x.name === e.course); return { kind: 'parts', unit: '人', total: c.n, items: [{ label: '≥ 60 分', v: c.pass, tone: 'a' }, { label: '< 60 分', v: c.n - c.pass, tone: 'c' }] }; }
    case 'split-done': { const c = D.courses.find(x => x.name === e.course); return { kind: 'parts', unit: '人', total: c.n, items: [{ label: '完成', v: c.completed, tone: 'a' }, { label: '未完成', v: c.n - c.completed, tone: 'c' }] }; }
    case 'work': { const h = f.homeworkCounts; return { kind: 'parts', unit: '份', total: h.scheduled, items: [{ label: '按时', v: h.onTime, tone: 'a' }, { label: '迟交', v: h.late, tone: 'b' }, { label: '缺交', v: h.missing, tone: 'c' }] }; }
    case 'subject': return { kind: 'courses', metric: e.metric, origin: e.course, items: COURSES.map(c => ({ course: c, v: METRICS[e.metric].read(c) })) };
  }
}

// ---------- 画法 ----------
const T = (x, y, t, a = '') => `<text x="${x}" y="${y}" ${a}>${t}</text>`;
const svg = (w, h, label, body) => `<svg class="chart" viewBox="0 0 ${w} ${h}" role="group" aria-label="${esc(label)}">${body}</svg>`;

function drawSeries(d, view, label) {
  const W = narrow() ? 400 : 820, H = narrow() ? 300 : 380, L = 46, Rr = W - 12, top = 30, B = H - 52;
  const vals = d.items.map(i => i.v).filter(v => v != null);
  const max = d.max ?? Math.ceil(Math.max(...vals) * 1.15 / 5) * 5, min = d.min ?? 0;
  const y = v => B - (Math.max(v, min) - min) / (max - min) * (B - top), step = (Rr - L) / d.items.length;
  const dec = d.unit === '人' ? 0 : 1;
  let o = '';
  for (let k = 0; k <= 4; k++) { const v = min + (max - min) * k / 4; o += `<line class="grid" x1="${L}" x2="${Rr}" y1="${y(v)}" y2="${y(v)}"/>` + T(L - 8, y(v) + 4, Math.round(v), 'class="tick" text-anchor="end"'); }
  const pts = d.items.map((it, i) => [L + step * (i + .5), it.v == null ? null : y(it.v)]);
  if (view === 'line') { const p = pts.filter(q => q[1] != null).map((q, i) => `${i ? 'L' : 'M'}${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(''); o += `<path class="glow-line" d="${p}"/><path class="mark-line" d="${p}"/>`; }
  const every = narrow() && d.items.length > 10 ? 2 : 1;
  d.items.forEach((it, i) => {
    const [x, py] = pts[i];
    o += `<g class="datum"><title>${esc(it.tip)}</title>`;
    if (it.v == null) o += `<rect class="void" x="${x - step * .3}" y="${B - 40}" width="${step * .6}" height="40" rx="3"/>` + T(x, B - 48, it.suppressed ? '已隐藏' : '无人', 'class="tick" text-anchor="middle"');
    else {
      const soft = d.ref != null && i < d.ref ? ' soft' : '';
      if (view === 'bars') o += `<rect class="mark${soft}" x="${x - step * .3}" y="${py}" width="${step * .6}" height="${B - py}" rx="3"/>`;
      else { if (view === 'dots') o += `<line class="stem" x1="${x}" x2="${x}" y1="${B}" y2="${py}"/>`; o += `<circle class="mark${soft}" cx="${x}" cy="${py}" r="${view === 'line' ? 3.5 : 6}"/>`; }
      if (i % every === 0) o += T(x, py - 10, fx(it.v, dec).replace(/\.0$/, ''), 'class="val" text-anchor="middle"');
    }
    if (i % every === 0) o += T(x, B + 18, it.label, 'class="tick" text-anchor="middle"');
    if (it.n != null) o += T(x, B + 34, it.suppressed ? '1–2 人' : `${it.n} 人`, 'class="tick faint" text-anchor="middle"');
    o += '</g>';
  });
  if (d.ref != null) { const x = L + step * d.ref; o += `<line class="ref" x1="${x}" x2="${x}" y1="${top - 12}" y2="${B}"/>` + T(x + 6, top - 4, '60 分', 'class="ref-label"'); }
  o += T(L, 14, d.yName, 'class="tick"') + T(Rr, H - 2, d.axis, 'class="tick" text-anchor="end"');
  return svg(W, H, label, o);
}

function drawParts(d, view, label) {
  if (view === 'stack') {
    const bar = d.items.map(it => `<span class="seg tone-${it.tone}" style="--w:${it.v / d.total * 100}%" title="${esc(it.label)} ${it.v} ${d.unit}"></span>`).join('');
    return `<div class="stack" role="img" aria-label="${esc(label)}"><div class="stack-bar">${bar}</div><dl>${d.items.map(it => `<div class="tone-${it.tone}"><dt>${it.label}</dt><dd><b>${it.v}</b> ${d.unit} · ${pct(it.v / d.total * 100)}</dd></div>`).join('')}</dl><p class="tick">合计 ${d.total} ${d.unit}</p></div>`;
  }
  return drawSeries({ unit: d.unit, axis: `合计 ${d.total} ${d.unit}`, yName: d.unit === '人' ? '人数' : '份数', items: d.items.map(it => ({ label: it.label, v: it.v, tip: `${it.label} · ${it.v} ${d.unit}` })) }, 'bars', label);
}

// 课程指标轮廓：六项指标同一份数，三种画法。均分单位是分，其余为 %，都在 0–100 刻度上。
function drawProfile(d, view, label) {
  const btn = (it, inner, cls = '') => `<button class="${cls}" data-action="go-metric" data-metric="${it.key}" aria-label="${METRICS[it.key].name} ${METRICS[it.key].show(it.v)}，以它为下一轮中心">${inner}</button>`;
  if (view === 'radar') {
    const S0 = narrow() ? 340 : 420, c = S0 / 2, r = c - 70, n = d.items.length;
    const P = (i, v) => { const a = -Math.PI / 2 + i * 2 * Math.PI / n; return [c + Math.cos(a) * r * v / 100, c + Math.sin(a) * r * v / 100]; };
    let o = '';
    [25, 50, 75, 100].forEach(g => { o += `<polygon class="grid" fill="none" points="${d.items.map((_, i) => P(i, g).join(',')).join(' ')}"/>`; });
    o += `<polygon class="area" points="${d.items.map((it, i) => P(i, it.v).join(',')).join(' ')}"/>`;
    d.items.forEach((it, i) => {
      const [x, y] = P(i, it.v), [lx, ly] = P(i, 122);
      o += `<g role="button" tabindex="0" class="pt" data-action="go-metric" data-metric="${it.key}" aria-label="${METRICS[it.key].name} ${METRICS[it.key].show(it.v)}，以它为下一轮中心"><circle class="hit" cx="${lx}" cy="${ly}" r="30"/><circle class="mark" cx="${x}" cy="${y}" r="5"/>${T(lx, ly - 2, METRICS[it.key].name, 'class="pt-label" text-anchor="middle"')}${T(lx, ly + 14, METRICS[it.key].show(it.v), 'class="val" text-anchor="middle"')}</g>`;
    });
    return `<div class="radar-wrap">${svg(S0, S0, label, o)}</div><p class="tick">0–100 刻度；均分以分计，其余为 %。点指标名进入下一轮。</p>`;
  }
  const rows = d.items.map(it => btn(it, `<span>${METRICS[it.key].name}</span><span class="track ${view}"><i style="--v:${it.v}%"></i></span><b>${METRICS[it.key].show(it.v)}</b>`, 'profile-row')).join('');
  return `<div class="profile">${rows}<p class="tick">同一 0–100 刻度；均分以分计，其余为 %。点任一行，让它成为下一轮中心。</p></div>`;
}

// 课程 × 单项指标：排序条或点位，数据相同；点课程进入那门课。
function drawCourses(d, view, label) {
  const M = METRICS[d.metric];
  const rows = [...d.items].sort((a, b) => b.v - a.v);
  if (view === 'rank') return `<div class="rank" aria-label="${esc(label)}">${rows.map(it => `<button class="rank-row ${it.course === d.origin ? 'origin' : ''}" data-action="go-course" data-course="${esc(it.course)}" aria-label="${esc(it.course)}，${M.name} ${M.show(it.v)}，进入这门课"><span>${esc(it.course)}</span><span class="track"><i style="--v:${it.v}%"></i></span><b>${M.show(it.v)}</b></button>`).join('')}</div>`;
  const W = narrow() ? 400 : 820, H = narrow() ? 220 : 200, L = 20, Rr = W - 20, mid = H / 2;
  const vs = d.items.map(i => i.v), x0 = Math.floor(Math.min(...vs) - 2), x1 = Math.ceil(Math.max(...vs) + 2);
  const X = v => L + (v - x0) / (x1 - x0) * (Rr - L);
  let o = `<line class="grid" x1="${L}" x2="${Rr}" y1="${mid}" y2="${mid}"/>`;
  for (let k = 0; k <= 4; k++) { const v = x0 + (x1 - x0) * k / 4; o += T(X(v), H - 6, v.toFixed(0), 'class="tick" text-anchor="middle"'); }
  rows.forEach((it, i) => {
    const up = i % 2 ? -1 : 1, ly = mid + up * (28 + (i % 4 > 1 ? 30 : 0)), og = it.course === d.origin;
    o += `<g role="button" tabindex="0" class="pt ${og ? 'origin' : ''}" data-action="go-course" data-course="${esc(it.course)}" aria-label="${esc(it.course)}，${M.name} ${M.show(it.v)}，进入这门课"><line class="stem" x1="${X(it.v)}" x2="${X(it.v)}" y1="${mid}" y2="${ly - (up > 0 ? 10 : -4)}"/><circle class="hit" cx="${X(it.v)}" cy="${mid}" r="12"/><circle class="mark" cx="${X(it.v)}" cy="${mid}" r="${og ? 8 : 5}"/>${!narrow() || og ? T(X(it.v), ly, esc(it.course), 'class="pt-label" text-anchor="middle"') : ''}</g>`;
  });
  o += T(Rr, 14, `${M.name} / ${M.unit}`, 'class="tick" text-anchor="end"');
  return svg(W, H, label, o) + (narrow() ? `<p class="tick">窄屏只标注当前课程；点任一点进入该课，或切到排序条看全部名称。</p>` : '');
}

function drawEntry(e) {
  const d = dataOf(e), label = `${titleOf(e)} · ${scopeText(e)} · ${VIEW_NAME[e.view]}`;
  if (d.kind === 'profile') return drawProfile(d, e.view, label);
  if (d.kind === 'courses') return drawCourses(d, e.view, label);
  if (d.kind === 'parts') return drawParts(d, e.view, label);
  return drawSeries(d, e.view, label);
}
const viewsOf = e => e.type === 'home' ? HOME_VIEWS : e.type === 'course' ? COURSE_VIEWS : relOf(e).views;

// ---------- 左层 ----------
function metricTable(course) {
  return `<h2 class="layer-title">${esc(course)} · 统一指标</h2><div class="metric-table">${ORDER.map(k => `<button class="metric-cell" data-action="go-metric" data-metric="${k}"><small>${METRICS[k].name}</small><b>${METRICS[k].show(METRICS[k].read(course))}</b><span>${METRICS[k].note}</span></button>`).join('')}<div class="metric-cell missing"><small>目标达成率</small><b>—</b><span>数据缺少定义，未计算；不用完成率代替</span></div></div><p class="tick">点任一指标，它成为中心；范围仍是这门课。</p>`;
}
function relationList(e) {
  const rs = RELATIONS[e.metric], M = METRICS[e.metric];
  const others = ORDER.filter(k => k !== e.metric);
  return `<h2 class="layer-title">围绕「${M.name}」的关联 · ${esc(e.course)}</h2>
<div class="rel-list">${rs.map(r => `<button class="rel-item ${r.id === e.rel ? 'current' : ''}" data-action="rel" data-rel="${r.id}" aria-pressed="${r.id === e.rel}"><b>${r.title}</b><span>${r.q}</span><small>${r.scope === 'all' ? '范围扩大到 18 门课' : '仍在这门课'}</small></button>`).join('')}</div>
${relOf(e).links.length ? `<p class="tick">这张图里还有：${relOf(e).links.map(k => `<button class="chip" data-action="go-metric" data-metric="${k}">${METRICS[k].name} →</button>`).join('')}</p>` : ''}
<h3 class="layer-sub">同一门课的其它指标</h3><div class="chips">${others.map(k => `<button class="chip" data-action="go-metric" data-metric="${k}">${METRICS[k].name} <em>${METRICS[k].show(METRICS[k].read(e.course))}</em></button>`).join('')}<button class="chip" data-action="go-course" data-course="${esc(e.course)}">回到课程 ${esc(e.course)}</button></div>`;
}
function homeLeft() {
  return `<p class="eyebrow">学析台 · 2025J 学期</p><h1 tabindex="-1">从一门课开始，<br>沿着概念往下看。</h1><p class="intro">右边是 18 门课程的均分。点一门课：左边给出它的统一指标，右边换这门课的画法。再点任何指标，它就成为新的中心。</p><p class="guide">点右侧任一课程</p>`;
}

function render() {
  const e = entry();
  document.body.classList.toggle('reduce-motion', S.motion);
  if (S.ai) return renderAI();
  if (S.overview) return renderOverview();
  const views = viewsOf(e);
  const left = e.type === 'home' ? homeLeft() : `<p class="eyebrow">${esc(centreOf(e))}</p><h1 tabindex="-1">${esc(titleOf(e))}</h1><p class="scope-line">范围 <b>${esc(scopeText(e))}</b></p>${e.type === 'course' ? metricTable(e.course) : relationList(e)}`;
  stage.innerHTML = `<section class="scene loop ${e.type}">
<div class="layer-left">${left}</div>
<div class="layer-right"><div class="figure-title"><span>${e.type === 'home' ? '18 门课程 · 均分' : e.type === 'course' ? `${esc(e.course)} · 指标轮廓` : esc(relOf(e).title)}</span><span>${esc(scopeText(e))}</span></div>
<div class="view-switch" role="group" aria-label="换画法（同数据、同范围）">${views.map(v => `<button class="text-button" data-action="view" data-view="${v}" aria-pressed="${v === e.view}">${VIEW_NAME[v]}</button>`).join('')}</div>
<div class="figure">${drawEntry(e)}</div>
${e.type === 'metric' ? `<p class="tick def">${METRICS[e.metric].name}：${METRICS[e.metric].note}。${relOf(e).id.startsWith('band') ? '个人出勤分箱 1–2 人时隐藏。' : ''}</p>` : ''}</div>
</section>`;
  updateChrome();
}

function preview(e, view) {
  const d = dataOf(e);
  const items = d.kind === 'courses' ? [...d.items].sort((a, b) => b.v - a.v) : d.items;
  const values = items.map(it => it.v);
  const max = d.kind === 'profile' ? 100 : Math.max(1, ...values.filter(v => v != null));
  const points = values.map((v, i) => [8 + i * 184 / Math.max(1, values.length - 1), v == null ? null : 55 - v / max * 44]);
  let marks = '';
  if (view === 'radar') {
    const polygon = values.map((v, i) => { const a = -Math.PI / 2 + i * 2 * Math.PI / values.length; return `${100 + Math.cos(a) * 26 * v / 100},${31 + Math.sin(a) * 26 * v / 100}`; }).join(' ');
    marks = `<polygon points="${polygon}" fill="#4064ec22" stroke="#4064ec"/>`;
  } else if (view === 'stack') {
    const total = values.reduce((sum, v) => sum + v, 0); let x = 0;
    marks = values.map((v, i) => { const width = v / total * 200, rect = `<rect x="${x}" y="21" width="${width}" height="20" fill="${['#4064ec', '#a9b9f5', '#e6c79a'][i]}"/>`; x += width; return rect; }).join('');
  } else if (view === 'line') {
    marks = `<polyline points="${points.filter(p => p[1] != null).map(p => p.join(',')).join(' ')}" fill="none" stroke="#4064ec" stroke-width="2"/>`;
  } else {
    const step = 200 / values.length;
    marks = values.map((v, i) => v == null ? '' : view === 'dots' ? `<circle cx="${step * (i + .5)}" cy="${55 - v / max * 44}" r="3" fill="#4064ec"/>` : `<rect x="${step * i + 2}" y="${55 - v / max * 44}" width="${Math.max(2, step - 4)}" height="${v / max * 44}" rx="1" fill="#4064ec" opacity=".7"/>`).join('');
  }
  return `<svg viewBox="0 0 200 64" aria-hidden="true">${marks}</svg>`;
}

function renderOverview() {
  const first = S.earlier ? 1 : Math.max(1, S.entries.length - 5);
  const card = (e, i, view, archived = false) => `<button class="space-card ${!archived && i === S.index && view === e.view ? 'current' : ''}" data-action="${archived ? 'archive' : 'jump'}" data-index="${i}" data-view="${view}"><small>${esc(centreOf(e))}</small><strong>${esc(titleOf(e))}</strong><small>${esc(scopeText(e))}</small><small>${VIEW_NAME[view]}</small>${preview(e, view)}</button>`;
  const row = (e, i, archived = false) => `<div class="space-row" style="--depth:${archived ? 0 : Math.min(5, S.entries.length - 1 - i)}" data-label="${archived ? '旧段' : i === 0 ? '首页' : i}">${e.views.map(view => card(e, i, view, archived)).join('')}</div>`;
  stage.innerHTML = `<section class="scene overview"><div class="scene-heading"><div><p class="eyebrow">探索全览</p><h1 tabindex="-1">把主题与画法，一起展开。</h1><p>前后是主题过程，左右是已看过的画法。点击回到那里继续。</p></div></div>
<div class="space concept-space">${row(S.entries[0], 0)}${S.entries.slice(first).map((e, i) => row(e, first + i)).join('')}
${first > 1 || S.archived.length ? `<button class="text-button" data-action="earlier">${S.earlier ? '收起更早探索' : '更早探索'} · ${Math.max(0, S.entries.length - 6) + S.archived.length} 项</button>` : ''}
${S.earlier ? S.archived.map((e, i) => row(e, i, true)).join('') : ''}</div>
<p class="space-tip">首页始终保留；早期主题和离开的后续段只折叠，不删除。横向切换画法不增加主题步骤。</p></section>`;
  updateChrome();
}

function renderAI() {
  const e = entry();
  stage.innerHTML = `<section class="scene ai-scene"><p class="eyebrow">AI 对话 · 布局草稿</p><h1 tabindex="-1">带着当前画面提问</h1>
${S.context ? `<div class="ai-context"><span>上下文：${esc(centreOf(e))} · ${esc(titleOf(e))} · ${esc(scopeText(e))} · ${VIEW_NAME[e.view]}</span><button data-action="drop-context">移除</button></div>` : `<div class="ai-context"><span>未携带数据上下文</span><button data-action="add-context">重新带上</button></div>`}
<textarea id="ai-draft" aria-label="问题草稿" placeholder="例如：这门课出勤 60% 以下的区间，成绩为什么还更低？">${esc(S.draft)}</textarea>
<p class="ai-disclaimer">讨论稿：不会发送，也没有接入任何模型。返回后数据画面与草稿都会保留。</p></section>`;
  stage.querySelector('#ai-draft').addEventListener('input', ev => { S.draft = ev.target.value; });
  updateChrome();
}

function updateChrome() {
  const e = entry();
  document.querySelector('#scope-info').textContent = S.ai ? 'AI 对话' : S.overview ? '探索全览' : `${centreOf(e)} · ${scopeText(e)}`;
  document.querySelector('#back-button').disabled = !S.overview && !S.ai && S.index === 0;
  document.querySelector('#overview-button').setAttribute('aria-pressed', S.overview);
  document.querySelector('#ai-switch-label').textContent = S.ai ? '回到数据浏览' : '与 AI 继续';
  const h = stage.querySelector('h1'); if (h && focusNext) { h.focus({ preventScroll: true }); focusNext = false; }
}

// ---------- 导航（模糊渐进） ----------
let focusNext = false, navigationTimer, animationTimer;
function cancelMotion() {
  clearTimeout(navigationTimer); clearTimeout(animationTimer);
  stage.classList.remove('blur-out', 'blur-in');
}
function go(mutate, say, { restore = false } = {}) {
  cancelMotion();
  if (!S.overview && !S.ai) entry().scroll = window.scrollY;
  const apply = () => {
    mutate(); focusNext = true; render();
    window.scrollTo(0, restore ? entry().scroll : 0); announce(say);
  };
  if (reduced()) return apply();
  stage.classList.add('blur-out');
  navigationTimer = setTimeout(() => {
    apply(); stage.classList.remove('blur-out'); stage.classList.add('blur-in');
    animationTimer = setTimeout(() => stage.classList.remove('blur-in'), 420);
  }, 180);
}
function push(next, say) {
  go(() => {
    S.archived.push(...S.entries.splice(S.index + 1));
    S.entries.push({ ...next, views: [next.view], scroll: 0 }); S.index++;
    S.overview = S.ai = false;
  }, say);
}
function announce(t) { if (t) document.querySelector('#announcement').textContent = t; }
const courseOfEntry = () => entry().course;

function act(el) {
  const a = el.dataset.action, e = entry();
  switch (a) {
    case 'home': go(() => { S.index = 0; S.overview = S.ai = false; }, '回到首页', { restore: true }); break;
    case 'go-course': push({ type: 'course', course: el.dataset.course, view: 'bars' }, `中心：课程 ${el.dataset.course}`); break;
    case 'go-metric': { const m = el.dataset.metric, r = RELATIONS[m][0]; push({ type: 'metric', metric: m, course: courseOfEntry(), rel: r.id, view: r.views[0] }, `中心：${METRICS[m].name}`); break; }
    case 'rel': { const r = RELATIONS[e.metric].find(x => x.id === el.dataset.rel); if (r.id === e.rel) return; push({ type: 'metric', metric: e.metric, course: e.course, rel: r.id, view: r.views[0] }, `关系：${r.title}`); break; }
    case 'view': cancelMotion(); e.view = el.dataset.view; if (!e.views.includes(e.view)) e.views.push(e.view); render(); announce(`画法：${VIEW_NAME[e.view]}，数据与范围不变`); stage.querySelector(`[data-view="${e.view}"]`)?.focus({ preventScroll: true }); break;
    case 'back': if (S.overview || S.ai) go(() => { S.overview = S.ai = false; }, '', { restore: true }); else if (S.index > 0) go(() => { S.index--; }, '返回上一画面', { restore: true }); break;
    case 'overview': go(() => { S.overview = !S.overview; S.ai = false; }); break;
    case 'jump': go(() => { S.index = +el.dataset.index; entry().view = el.dataset.view; S.overview = false; }, '', { restore: true }); break;
    case 'archive': push({ ...S.archived[+el.dataset.index], view: el.dataset.view }, '从更早探索继续'); break;
    case 'earlier': cancelMotion(); S.earlier = !S.earlier; render(); break;
    case 'ai': go(() => { S.ai = !S.ai; S.overview = false; }, '', { restore: S.ai }); break;
    case 'drop-context': cancelMotion(); S.context = false; render(); break;
    case 'add-context': cancelMotion(); S.context = true; render(); break;
    case 'close-notes': toggleNotes(false); break;
  }
}
function toggleNotes(open) {
  const n = document.querySelector('#notes'), b = document.querySelector('#menu-toggle');
  n.hidden = !open; b.setAttribute('aria-expanded', open); (open ? n.querySelector('button') : b).focus();
}
document.addEventListener('click', ev => { const el = ev.target.closest('[data-action]'); if (el && !el.disabled) act(el); });
document.addEventListener('keydown', ev => {
  if (ev.key === 'Escape') { if (!document.querySelector('#notes').hidden) toggleNotes(false); else if (S.overview || S.ai) act({ dataset: { action: 'back' } }); return; }
  const el = ev.target.closest && ev.target.closest('[role=button][data-action]');
  if (el && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); act(el); }
});
document.querySelector('#menu-toggle').addEventListener('click', () => toggleNotes(document.querySelector('#notes').hidden));
document.querySelector('#motion-toggle').addEventListener('change', ev => { S.motion = ev.target.checked; cancelMotion(); render(); });
systemMotion.addEventListener('change', () => { cancelMotion(); render(); });
let rz; window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(render, 150); });
render();
