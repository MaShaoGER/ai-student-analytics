const sparkSVG = '<svg class="spark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="m12 2 2.1 7.9L22 12l-7.9 2.1L12 22l-2.1-7.9L2 12l7.9-2.1L12 2Z"/></svg>';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const presets = {
  course: {
    id:'course', prompt:'比较各课程平均成绩。', scope:'限定：全部学期 · 全部课程 · 平均成绩',
    lead:'体育与健康平均分最高，为 75.22 分；高等数学为 57.27 分。',
    support:'两者相差 17.95 分。本次比较覆盖全部学期中的 18 个课程分组。', type:'bars', title:'平均成绩', subtitle:'按课程 · 节选 6 个分组', range:'0—80 分',
    data:[{label:'体育与健康',value:75.22},{label:'大学英语',value:71.68},{label:'计算机基础',value:68.42},{label:'线性代数',value:63.85},{label:'大学物理',value:61.20},{label:'高等数学',value:57.27}],
    stats:[[18,'课程分组'],[75.22,'最高平均分'],[57.27,'最低平均分'],[17.95,'最高与最低分差']], evidence:'分析依据 · 4 条统计事实', followups:['term','distribution']
  },
  term: {
    id:'term', prompt:'各学期平均成绩如何？', scope:'限定：全部课程 · 按学期 · 平均成绩',
    lead:'整体均值从 72.40 分升至 75.00 分，中间略有回落。',
    support:'这里只描述五个学期的整体变化，不把单次回落解释为具体原因。', type:'line', title:'学期平均成绩', subtitle:'全部课程 · 5 个学期', range:'70—76 分',
    data:[{label:'2023 秋',value:72.40},{label:'2024 春',value:73.10},{label:'2024 秋',value:71.80},{label:'2025 春',value:74.20},{label:'2025 秋',value:75.00}],
    stats:[[5,'学期数量'],[72.40,'首学期均分',2],[75,'末学期均分',2],[2.60,'首尾变化']], evidence:'分析依据 · 5 个演示数据点', followups:['course','distribution']
  },
  distribution: {
    id:'distribution', prompt:'各科成绩分布如何？', scope:'限定：全部学期 · 全部课程 · 成绩分布',
    lead:'70–79 分人数最多，共 68 人。',
    support:'分布仅描述当前模拟群体，不用于推断任何个体表现；各区间人数合计为 200 人。', type:'distribution', title:'成绩分布', subtitle:'全部课程 · 200 人', range:'人数 / 人',
    data:[{label:'<60',value:18},{label:'60–69',value:42},{label:'70–79',value:68},{label:'80–89',value:51},{label:'90+',value:21}],
    stats:[[200,'总人数'],[68,'最多区间人数'],[5,'分数区间'],['70–79','人数最多区间']], evidence:'分析依据 · 分组合计 200 人', followups:['course','attendance']
  },
  attendance: {
    id:'attendance', prompt:'缺勤次数和成绩有关系吗？', scope:'限定：全部学期 · 缺勤分组 · 平均成绩',
    lead:'缺勤 0–2 次组平均分最高，为 76.40 分。',
    support:'这只是群体统计关联，不代表缺勤与成绩之间的因果关系；各组人数均为模拟值。', type:'bars', title:'平均成绩 · 按缺勤分组', subtitle:'群体统计 · 4 个分组', range:'0—80 分',
    data:[{label:'3–5 次',value:72.80,count:64},{label:'0–2 次',value:76.40,count:86},{label:'10 次以上',value:61.60,count:16},{label:'6–9 次',value:68.30,count:34}],
    stats:[[4,'缺勤分组'],[76.40,'最高组均分'],[61.60,'最低组均分'],[14.80,'组间分差']], evidence:'分析依据 · 关联不等于因果', followups:['course','term']
  }
};

const thread = document.querySelector('#thread');
const threadScroll = document.querySelector('#threadScroll');
const emptyState = document.querySelector('#emptyState');
const input = document.querySelector('#promptInput');
const sendButton = document.querySelector('#sendButton');
const charCount = document.querySelector('#charCount');
const scopeText = document.querySelector('#scopeText');
const replayButton = document.querySelector('#replayButton');
const progress = document.querySelector('#generationProgress');
const tooltip = document.querySelector('#chartTooltip');
const liveAnnouncement = document.querySelector('#liveAnnouncement');
const drawer = document.querySelector('#historyDrawer');
let activeRun = 0;
let skipMotion = false;
let currentPreset = null;
let turnSerial = 0;
let returnFocus = null;

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function formatNumber(value, decimals = null) {
  if (typeof value !== 'number') return String(value);
  const places = decimals === null ? (Number.isInteger(value) ? 0 : 2) : decimals;
  return value.toFixed(places);
}
function scrollToLatest(smooth = true) {
  requestAnimationFrame(() => threadScroll.scrollTo({top:threadScroll.scrollHeight,behavior:smooth && !reducedMotion.matches && !skipMotion ? 'smooth':'auto'}));
}
function pause(ms, run) {
  return new Promise(resolve => setTimeout(() => resolve(run === activeRun), skipMotion || reducedMotion.matches ? 0 : ms));
}
function detectPreset(text) {
  if (/学期|变化|趋势/.test(text)) return presets.term;
  if (/分布|区间/.test(text)) return presets.distribution;
  if (/缺勤|出勤|考勤/.test(text)) return presets.attendance;
  if (/课程|平均|均分|比较/.test(text)) return presets.course;
  return null;
}
function customPreset(text) {
  return {id:'custom',prompt:text,scope:'静态交互预览 · 未调用 API',lead:'这个预览内置了四种学习分析问题。',support:'请从下方选择一个预设问题。所有回答都来自本地静态内容，不会调用 API。',type:'none',stats:[],evidence:'静态演示 · 没有生成真实统计结果',followups:['course','term','distribution','attendance']};
}
function userHTML(prompt) {
  return `<div class="user"><div class="user-bubble"><div class="user-label">你</div><div class="user-text">${escapeHTML(prompt)}</div></div></div>`;
}
function answerHeader(status='静态演示 · 本地预设结果') {
  return `<div class="answer-title"><strong>学析台</strong><span>${status}</span></div>`;
}
function thinkingHTML() {
  return `<div class="thinking"><div class="answer-title"><strong>学析台</strong><span>正在准备预设回答</span></div><div class="thinking-status"><span class="thinking-dots"><i></i><i></i><i></i></span><span class="thinking-label">理解问题</span><button class="skip-button" type="button">跳过动画</button></div></div>`;
}
function chartHTML(preset, animate) {
  if (preset.type === 'none') return '';
  const animated = animate ? 'chart-animated' : '';
  const sort = preset.type === 'bars' ? '<button class="sort-button" type="button" aria-label="按高低重排图表数据" aria-pressed="false">按高低重排 ↓</button>' : '';
  const header = `<div class="chart-head"><div><h2>${preset.title}</h2><p>${preset.subtitle}</p></div><div class="chart-actions">${sort}<span class="chart-range">${preset.range}</span></div></div>`;
  let plot = '';
  if (preset.type === 'bars') {
    plot = `<div class="bars" data-sorted="false">${preset.data.map((item,index)=>`<div class="bar-row" data-index="${index}" data-value="${item.value}" data-label="${item.label}" data-count="${item.count||''}" style="--order:${index}" tabindex="0"><span class="bar-label">${item.label}</span><div class="bar-track"><div class="bar-fill" style="width:${item.value/80*100}%"></div></div><span class="bar-value" data-animate-number="${item.value}">${animate?'0.00':formatNumber(item.value,2)}</span></div>`).join('')}</div>`;
  } else if (preset.type === 'distribution') {
    const max = Math.max(...preset.data.map(item=>item.value));
    plot = `<div class="distribution">${preset.data.map((item,index)=>`<div class="dist-column" style="--order:${index}"><span class="dist-value" data-animate-number="${item.value}">${animate?'0':item.value}</span><div class="dist-bar" style="height:${item.value/max*82}%"></div><span class="dist-label">${item.label}</span></div>`).join('')}</div>`;
  } else {
    const points = preset.data.map((item,index)=>({...item,x:45+index*(710/(preset.data.length-1)),y:205-(item.value-70)/6*170}));
    const path = points.map((point,index)=>`${index?'L':'M'} ${point.x} ${point.y}`).join(' ');
    const area = `${path} L ${points.at(-1).x} 205 L ${points[0].x} 205 Z`;
    plot = `<svg class="line-chart" viewBox="0 0 800 230" role="img" aria-label="五个学期平均成绩折线图"><path class="line-grid" d="M35 35H765M35 120H765M35 205H765"/><path class="line-area" d="${area}"/><path class="line-path" d="${path}"/>${points.map((point,index)=>`<circle class="line-point" style="--order:${index}" cx="${point.x}" cy="${point.y}" r="6"><title>${point.label}：${formatNumber(point.value,2)} 分</title></circle>`).join('')}</svg><div class="line-labels">${preset.data.map(item=>`<span>${item.label}</span>`).join('')}</div>`;
  }
  return `<section class="chart ${animated}">${header}${plot}</section>`;
}
function statsHTML(preset, animate) {
  if (!preset.stats.length) return '';
  return `<div class="evidence-strip">${preset.stats.map(([value,label,decimals=null])=>`<div class="fact"><strong ${typeof value==='number'?`data-animate-number="${value}" data-decimals="${decimals??(Number.isInteger(value)?0:2)}"`:''}>${animate&&typeof value==='number'?'0':formatNumber(value,decimals)}</strong><span>${label}</span></div>`).join('')}</div>`;
}
function followupsHTML(preset) {
  return preset.followups.length ? `<div class="follow-ups">${preset.followups.map((id,index)=>`<button class="follow-up" style="--order:${index}" type="button" data-followup="${id}">${presets[id].prompt} ↗</button>`).join('')}</div>` : '';
}
function resultHTML(preset, animate) {
  return `<div class="result-section">${chartHTML(preset,animate)}${statsHTML(preset,animate)}<div class="evidence-link"><span>${preset.evidence}</span><span>静态预设 · 无网络请求</span></div>${followupsHTML(preset)}</div>`;
}
function fullAnswerHTML(preset) {
  return `${answerHeader()}<p class="lead">${escapeHTML(preset.lead)}</p><p class="support">${escapeHTML(preset.support)}</p>${resultHTML(preset,false)}`;
}
function createTurn(preset, state, prompt = preset.prompt) {
  const turn = document.createElement('section');
  turn.className = 'turn';
  turn.dataset.turn = String(++turnSerial);
  turn.dataset.state = state;
  turn.innerHTML = `${userHTML(prompt)}<section class="answer">${sparkSVG}<div class="answer-body">${state==='thinking'?thinkingHTML():fullAnswerHTML(preset)}</div></section>`;
  thread.appendChild(turn);
  return turn;
}
function animateNumbers(root, run) {
  root.querySelectorAll('[data-animate-number]').forEach((element,index) => {
    const target = Number(element.dataset.animateNumber);
    const decimals = Number(element.dataset.decimals ?? (Number.isInteger(target)?0:2));
    if (skipMotion || reducedMotion.matches) { element.textContent = formatNumber(target,decimals); return; }
    const start = performance.now()+index*35;
    function tick(now) {
      if (run !== activeRun) return;
      const progress = Math.max(0,Math.min(1,(now-start)/420));
      element.textContent = (target*(1-Math.pow(1-progress,4))).toFixed(decimals);
      if (progress<1) requestAnimationFrame(tick); else element.textContent = formatNumber(target,decimals);
    }
    requestAnimationFrame(tick);
  });
}
async function streamText(element,text,run) {
  let previous=null;
  const caret=document.createElement('span');
  caret.className='stream-caret';
  for (const char of Array.from(text)) {
    if (run!==activeRun) return false;
    const part=document.createElement('span');
    part.className='stream-chunk fresh';
    part.textContent=char;
    element.append(part,caret);
    if (previous) previous.classList.remove('fresh');
    previous=part;
    if (!skipMotion&&!reducedMotion.matches&&!await pause(12,run)) return false;
  }
  caret.remove();
  if (previous) previous.classList.remove('fresh');
  return true;
}
function stopPendingTurns() {
  for (const turn of thread.querySelectorAll('.turn')) {
    if (turn.dataset.state==='complete'||turn.dataset.state==='stopped') continue;
    turn.dataset.state='stopped';
    turn.querySelector('.answer-body').innerHTML=`${answerHeader('上一轮演示已停止')}<p class="support">该轮已被新问题取代，没有生成统计结果。</p>`;
  }
}
async function sendPrompt(text,presetId=null) {
  const prompt=text.trim();
  if (!prompt) return;
  activeRun++;
  stopPendingTurns();
  const run=activeRun;
  const preset=presetId?presets[presetId]:(detectPreset(prompt)||customPreset(prompt));
  currentPreset=preset;
  skipMotion=reducedMotion.matches;
  document.body.classList.remove('skip-animations');
  progress.classList.remove('running');
  progress.style.removeProperty('opacity');
  void progress.offsetWidth;
  progress.classList.add('running');
  replayButton.disabled=false;
  scopeText.textContent=preset.scope;
  liveAnnouncement.textContent=`已开始预设演示：${prompt}`;
  const turn=createTurn(preset,'thinking',prompt);
  scrollToLatest();
  input.value='';
  resizeInput();
  updateInputState();
  emptyState.classList.add('exit');
  window.setTimeout(()=>{if(emptyState.classList.contains('exit'))emptyState.hidden=true;},reducedMotion.matches?0:300);
  const status=turn.querySelector('.thinking-label');
  const stageDelay=reducedMotion.matches?0:140;
  for (const stage of ['理解问题','整理演示分组','准备图表与依据']) {
    if (!await pause(stageDelay,run)) return;
    status.textContent=stage;
  }
  if (!await pause(reducedMotion.matches?0:100,run)) return;
  const body=turn.querySelector('.answer-body');
  turn.dataset.state='streaming';
  body.innerHTML=`${answerHeader()}<p class="lead"></p><p class="support"></p>`;
  if (!await streamText(body.querySelector('.lead'),preset.lead,run)) return;
  if (!await streamText(body.querySelector('.support'),preset.support,run)) return;
  body.insertAdjacentHTML('beforeend',resultHTML(preset,true));
  turn.dataset.state='complete';
  animateNumbers(body,run);
  scrollToLatest(false);
  liveAnnouncement.textContent=`回答已完成。${preset.lead}`;
  progress.classList.remove('running');
  progress.style.removeProperty('opacity');
  document.body.classList.remove('skip-animations');
}
function loadPreset(id) {
  activeRun++;
  stopPendingTurns();
  document.body.classList.remove('skip-animations');
  skipMotion=reducedMotion.matches;
  currentPreset=presets[id];
  thread.innerHTML='';
  emptyState.hidden=true;
  emptyState.classList.add('exit');
  replayButton.disabled=false;
  scopeText.textContent=currentPreset.scope;
  createTurn(currentPreset,'complete');
  threadScroll.scrollTop=0;
  closeHistory();
}
function resetConversation() {
  activeRun++;
  stopPendingTurns();
  document.body.classList.remove('skip-animations');
  skipMotion=reducedMotion.matches;
  currentPreset=null;
  thread.innerHTML='';
  emptyState.hidden=false;
  requestAnimationFrame(()=>emptyState.classList.remove('exit'));
  replayButton.disabled=true;
  progress.classList.remove('running');
  progress.style.removeProperty('opacity');
  scopeText.textContent='限定：全部学期 · 全部课程 · 平均成绩';
  closeHistory();
  input.focus();
}
function updateInputState() {
  charCount.textContent=`${input.value.length}/500`;
  sendButton.disabled=!input.value.trim();
}
function resizeInput() {
  input.style.height='auto';
  input.style.height=`${Math.min(input.scrollHeight,110)}px`;
}
function openHistory() {
  returnFocus=document.activeElement;
  drawer.inert=false;
  drawer.classList.add('open');
  document.querySelector('.focus-shell').inert=true;
  document.querySelector('.topbar').inert=true;
  document.querySelector('#historyOpen').setAttribute('aria-expanded','true');
  const scrim=document.querySelector('#historyScrim');
  scrim.classList.add('open');
  scrim.setAttribute('aria-hidden','false');
  document.querySelector('#historyClose').focus();
}
function closeHistory() {
  if (!drawer.classList.contains('open')) return;
  drawer.classList.remove('open');
  drawer.inert=true;
  document.querySelector('.focus-shell').inert=false;
  document.querySelector('.topbar').inert=false;
  const scrim=document.querySelector('#historyScrim');
  scrim.classList.remove('open');
  scrim.setAttribute('aria-hidden','true');
  document.querySelector('#historyOpen').setAttribute('aria-expanded','false');
  if (returnFocus?.isConnected) returnFocus.focus();
}

for (const button of document.querySelectorAll('[data-preset]')) button.addEventListener('click',()=>sendPrompt(presets[button.dataset.preset].prompt,button.dataset.preset));
for (const button of document.querySelectorAll('[data-history]')) button.addEventListener('click',()=>loadPreset(button.dataset.history));
document.querySelector('#historyOpen').addEventListener('click',openHistory);
document.querySelector('#historyClose').addEventListener('click',closeHistory);
document.querySelector('#historyScrim').addEventListener('click',closeHistory);
document.querySelector('#newChat').addEventListener('click',resetConversation);
replayButton.addEventListener('click',()=>{if(currentPreset){thread.innerHTML='';sendPrompt(currentPreset.prompt,currentPreset.id==='custom'?null:currentPreset.id);}});
document.querySelector('#composer').addEventListener('submit',event=>{event.preventDefault();if(input.value.trim())sendPrompt(input.value);});
input.addEventListener('input',()=>{updateInputState();resizeInput();});
input.addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();if(input.value.trim())sendPrompt(input.value);}});
document.addEventListener('keydown',event=>{
  if (event.key==='Escape'&&drawer.classList.contains('open')) {closeHistory();return;}
  if (event.key!=='Tab'||!drawer.classList.contains('open')) return;
  const controls=[...drawer.querySelectorAll('button:not(:disabled)')];
  const first=controls[0],last=controls.at(-1);
  if (event.shiftKey&&document.activeElement===first) {event.preventDefault();last.focus();}
  else if (!event.shiftKey&&document.activeElement===last) {event.preventDefault();first.focus();}
});
thread.addEventListener('click',event=>{
  const followup=event.target.closest('[data-followup]');
  if (followup) {sendPrompt(presets[followup.dataset.followup].prompt,followup.dataset.followup);return;}
  const skip=event.target.closest('.skip-button');
  if (skip) {skipMotion=true;document.body.classList.add('skip-animations');skip.textContent='正在跳过…';return;}
  const sort=event.target.closest('.sort-button');
  if (!sort) return;
  const bars=sort.closest('.chart').querySelector('.bars');
  const rows=[...bars.querySelectorAll('.bar-row')];
  const firstRects=new Map(rows.map(row=>[row,row.getBoundingClientRect()]));
  const descending=bars.dataset.sorted!=='true';
  rows.sort((a,b)=>descending?Number(b.dataset.value)-Number(a.dataset.value):Number(a.dataset.index)-Number(b.dataset.index));
  rows.forEach(row=>bars.appendChild(row));
  bars.dataset.sorted=String(descending);
  sort.textContent=descending?'恢复原始顺序 ↗':'按高低重排 ↓';
  sort.setAttribute('aria-label',descending?'恢复图表原始顺序':'按高低重排图表数据');
  sort.setAttribute('aria-pressed',String(descending));
  rows.forEach(row=>{
    const delta=firstRects.get(row).top-row.getBoundingClientRect().top;
    if (!reducedMotion.matches&&!skipMotion) row.animate([{transform:`translateY(${delta}px)`},{transform:'translateY(0)'}],{duration:320,easing:'cubic-bezier(.16,1,.3,1)'});
  });
});
thread.addEventListener('mouseover',event=>{
  const row=event.target.closest('.bar-row');
  if (!row) return;
  tooltip.textContent=`${row.dataset.label} · 平均成绩 ${Number(row.dataset.value).toFixed(2)} 分${row.dataset.count?` · ${row.dataset.count} 人`:''}`;
  tooltip.classList.add('show');
});
thread.addEventListener('mousemove',event=>{
  if (!tooltip.classList.contains('show')) return;
  tooltip.style.left=`${Math.min(event.clientX+16,window.innerWidth-tooltip.offsetWidth-16)}px`;
  tooltip.style.top=`${Math.max(12,event.clientY-tooltip.offsetHeight-15)}px`;
});
thread.addEventListener('mouseout',event=>{if(event.target.closest('.bar-row'))tooltip.classList.remove('show');});
thread.addEventListener('focusin',event=>{
  const row=event.target.closest('.bar-row');
  if (!row) return;
  const rect=row.getBoundingClientRect();
  tooltip.textContent=`${row.dataset.label} · 平均成绩 ${Number(row.dataset.value).toFixed(2)} 分`;
  tooltip.style.left=`${rect.left+rect.width/2}px`;
  tooltip.style.top=`${rect.top-42}px`;
  tooltip.classList.add('show');
});
thread.addEventListener('focusout',event=>{if(event.target.closest('.bar-row'))tooltip.classList.remove('show');});
thread.addEventListener('keydown',event=>{if(event.target.matches('.bar-row')&&(event.key==='Enter'||event.key===' ')){event.preventDefault();event.target.click();}});
reducedMotion.addEventListener('change',()=>{if(reducedMotion.matches)skipMotion=true;});
updateInputState();
