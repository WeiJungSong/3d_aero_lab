/* ============================================================
 *  app_cfd.js — CFD 版：求解器管理、介面、圖表、互動
 * ============================================================ */
const $ = (s, el) => (el || document).querySelector(s);
const el = (tag, attrs, ...kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
    else e.setAttribute(k, attrs[k]);
  }
  for (const c of kids) if (c != null) e.append(c);
  return e;
};
const fmtN = (v, d) => (v == null || !isFinite(v)) ? '—' : Number(v).toLocaleString('en-US', { minimumFractionDigits: d || 0, maximumFractionDigits: d || 0 });
const SUP = c => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(c)];
const fmtE = v => { if (v == null || !isFinite(v)) return '—'; const [m, e] = v.toExponential(1).split('e'); return +e === 0 ? m : `${m}×10${String(+e).replace(/[-0-9]/g, SUP)}`; };
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- CFD 專用場變數 ---------- */
CMAPS.magma = ['#2c115f', '#50127b', '#721f81', '#932b80', '#b6377a', '#d8456c', '#f1605d', '#fb8761', '#feae77', '#fdd49e', '#fcfdbf'];
CMAPS.vort = { stops: [0, 0.18, 0.36, 0.5, 0.64, 0.82, 1], cols: ['#b9ddf1', '#4a98d0', '#1f4f82', '#1a222b', '#8a2c20', '#dd6649', '#f7bfa0'] };
CMAPS.rocket = ['#35193e', '#5a1e56', '#861c5b', '#b01c55', '#d8354a', '#ec5c47', '#f38660', '#f6b18f', '#f9d9c1'];
for (const k of ['magma', 'vort', 'rocket']) LUTS[k] = buildLUT(CMAPS[k]);
FIELDS.Y = { name: '燃燒產物', sym: 'Y', unit: '質量分率', cmap: 'magma', log: false, sc: 1, dec: 2 };
FIELDS.vort = { name: '渦度', sym: 'ω', unit: '1/s', cmap: 'vort', log: false, sc: 1, dec: 0, zc: true };
FIELDS.ds = { name: '熵增', sym: 'Δs', unit: 'J/(kg·K)', cmap: 'rocket', log: false, sc: 1, dec: 0 };
const FIELD_ORDER = ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho', 'Y', 'vort', 'ds'];

/* ---------- 預設 ---------- */
const PRESETS = {
  hbtf: [
    { k: 'sls', name: '地面靜止', alt: 0, M0: 0, thr: 1 },
    { k: 'to', name: '起飛滾行', alt: 0, M0: 0.25, thr: 1 },
    { k: 'clb', name: '爬升', alt: 5000, M0: 0.6, thr: 0.95 },
    { k: 'crz', name: '巡航', alt: 10668, M0: 0.78, thr: 0.88 },
  ],
  tj: [
    { k: 'max', name: '地面最大（後燃）', alt: 0, M0: 0, thr: 1, ab: true },
    { k: 'mil', name: '地面軍用推力', alt: 0, M0: 0, thr: 1, ab: false },
    { k: 'crz', name: '亞音速巡航', alt: 9000, M0: 0.85, thr: 0.85, ab: false },
    { k: 'dash', name: '超音速衝刺', alt: 11000, M0: 1.8, thr: 1, ab: true },
  ],
  lbtf: [
    { k: 'max', name: '地面最大（後燃）', alt: 0, M0: 0, thr: 1, ab: true },
    { k: 'mil', name: '地面軍用推力', alt: 0, M0: 0, thr: 1, ab: false },
    { k: 'crz', name: '亞音速巡航', alt: 9000, M0: 0.85, thr: 0.84, ab: false },
    { k: 'dash', name: '超音速衝刺', alt: 11000, M0: 1.6, thr: 1, ab: true },
  ],
};
const DEFAULT_PRESET = { hbtf: 'to', tj: 'mil', lbtf: 'mil' };
const DESIGN_RANGES = {
  hbtf: { mdot: [150, 700, 5], opr: [15, 55, 0.5], fpr: [1.3, 2.0, 0.01], bpr: [3, 12, 0.1], pibst: [1.2, 3.0, 0.05], Tt4max: [1300, 1900, 10] },
  tj: { mdot: [30, 150, 1], opr: [5, 25, 0.1], Tt4max: [1000, 1600, 10] },
  lbtf: { mdot: [50, 200, 1], opr: [15, 40, 0.5], fpr: [2.2, 5.0, 0.05], Tt4max: [1400, 2000, 10] },
};
const S = {
  type: 'tj', design: null, eff: Object.assign({}, DEFAULT_EFF),
  alt: 0, M0: 0, thr: 1, ab: false, Tt7: 2000, nozzleType: 'cd', preset: 'mil',
  field: 'T', phi: 0, wedge: 180, rpXf: 0.5, particles: 2400, anim: 1,
  blades: true, contours: true, labels: true, lock: false, pcolor: 'white',
  pins: [], probeMin: window.innerWidth < 760,
  grid: 'medium', running: true, cfl: 0.8, order: 2, visc: true, init: 'cycle',
};
function resetType(t) {
  S.type = t;
  const T = ENGINE_TYPES[t];
  S.design = Object.assign({}, T.design);
  S.nozzleType = T.nozzle;
  S.Tt7 = t === 'lbtf' ? 2100 : 2000;
  S.lock = false;
  applyPreset(DEFAULT_PRESET[t], true);
  S.pins = null;
}
function applyPreset(k, silent) {
  const p = PRESETS[S.type].find(q => q.k === k);
  if (!p) return;
  S.alt = p.alt; S.M0 = p.M0; S.thr = p.thr; S.ab = !!p.ab;
  S.preset = k;
  if (!silent) { refreshControls(); request('params', true); }
}

const CUR = { specKey: null, nozKey: null };
const CFD = { solver: null, kind: null, grid: null, zones: null, comps: null, base: null, Q: null, G: null, map: null,
  hist: [], itTotal: 0, itAtRead: 0, prevRho: null, res: NaN, forces: null, ratios: [], seqTarget: null, readT: 0, panelT: 0,
  k: 4, ips: 0, ipsN: 0, ipsT: 0, conv: false, error: null, lastF: [], startIt: 0, geomKey: null };

/* ---------- 控制架 ---------- */
const CTRLS = [];
function mkSlider(o) {
  const id = o.id;
  const inp = el('input', { type: 'range', id, min: o.min, max: o.max, step: o.step });
  const out = el('output', { for: id });
  const sub = o.sub ? el('div', { class: 'sub' }) : null;
  const wrap = el('div', { class: 'ctl' }, el('label', { for: id, html: o.label + (o.sym ? `<span class="sym">${o.sym}</span>` : '') }), out, inp, sub);
  const c = { o, inp, out, sub, wrap };
  const setP = () => { const p = (inp.value - inp.min) / (inp.max - inp.min) * 100; inp.style.setProperty('--p', p + '%'); };
  c.refresh = () => {
    inp.value = o.get(); out.textContent = o.fmt(+inp.value); setP();
    if (sub) sub.textContent = o.sub();
    const dis = o.disabled ? o.disabled() : false; inp.disabled = dis; wrap.classList.toggle('dis', dis);
  };
  inp.addEventListener('input', () => { o.set(+inp.value); out.textContent = o.fmt(+inp.value); setP(); if (o.flight) { S.preset = null; updatePresetButtons(); } request(o.level || 'params', false); });
  inp.addEventListener('change', () => request(o.level || 'params', true));
  CTRLS.push(c);
  return wrap;
}
function mkSwitch(o) {
  const inp = el('input', { type: 'checkbox', id: o.id });
  const lab = el('label', { class: 'sw' + (o.cls ? ' ' + o.cls : ''), for: o.id }, el('span', { html: o.label }), inp);
  const c = { o, inp, wrap: lab, refresh: () => { inp.checked = !!o.get(); } };
  inp.addEventListener('change', () => { o.set(inp.checked); request(o.level || 'params', true); });
  CTRLS.push(c);
  return lab;
}
function mkSelect(o) {
  const sel = el('select', { id: o.id });
  for (const [v, t] of o.options) sel.append(el('option', { value: v }, t));
  const wrap = el('div', { class: 'ctl' }, el('label', { for: o.id, html: o.label }), sel);
  const c = { o, inp: sel, wrap, refresh: () => { sel.value = o.get(); sel.disabled = o.disabled ? o.disabled() : false; } };
  sel.addEventListener('change', () => { o.set(sel.value); request(o.level || 'params', true); });
  CTRLS.push(c);
  return wrap;
}
function grp(title, en, ...kids) { return el('section', { class: 'grp' }, el('h3', { html: `${title}<small>${en}</small>` }), ...kids); }
function updatePresetButtons() { for (const b of document.querySelectorAll('.presets button')) b.setAttribute('aria-pressed', b.dataset.k === S.preset ? 'true' : 'false'); }

function buildRack() {
  CTRLS.length = 0;
  const rack = $('#rack'); rack.innerHTML = '';
  const T = ENGINE_TYPES[S.type], DR = DESIGN_RANGES[S.type];
  const gpu = CFD.kind !== 'cpu';
  rack.append(grp('CFD 求解器', 'SOLVER',
    el('div', { class: 'presets' },
      el('button', { id: 'btnRun', onclick: () => toggleRun() }, S.running ? '暫停求解' : '繼續求解'),
      el('button', { onclick: () => restartCFD() }, '重新起始')),
    mkSelect({ id: 'grid', label: '網格解析度', options: [['coarse', '粗（約 5 萬格）'], ['medium', '中（約 12 萬格）'], ['fine', '細（約 23 萬格）']], get: () => S.grid, set: v => S.grid = v, level: 'grid', disabled: () => !gpu }),
    mkSelect({ id: 'init', label: '初始場', options: [['cycle', '由循環分析估算'], ['uniform', '均勻自由流（冷啟動）']], get: () => S.init, set: v => S.init = v, level: 'none' }),
    mkSlider({ id: 'cfl', label: 'CFL 數', min: 0.3, max: 0.95, step: 0.05, get: () => S.cfl, set: v => S.cfl = v, fmt: v => v.toFixed(2), level: 'solver' }),
    mkSelect({ id: 'order', label: '空間精度', options: [['2', '二階（MUSCL）'], ['1', '一階（較穩健）']], get: () => String(S.order), set: v => S.order = +v, level: 'solver' }),
    mkSelect({ id: 'visc', label: '紊流模型', options: [['1', 'Prandtl 混合長度'], ['0', '無黏（Euler）']], get: () => S.visc ? '1' : '0', set: v => S.visc = v === '1', level: 'solver' }),
    el('p', { class: 'note', id: 'solverNote' }),
  ));
  const pres = el('div', { class: 'presets' });
  for (const p of PRESETS[S.type]) pres.append(el('button', { 'data-k': p.k, onclick: () => applyPreset(p.k) }, p.name));
  rack.append(grp('飛行條件', 'FLIGHT', pres,
    mkSlider({ id: 'alt', label: '飛行高度', sym: 'h', min: 0, max: T.hmax, step: 50, get: () => S.alt, set: v => S.alt = v, fmt: v => fmtN(v) + ' m', flight: true }),
    mkSlider({ id: 'M0', label: '飛行馬赫數', sym: 'M₀', min: 0, max: T.Mmax, step: 0.01, get: () => S.M0, set: v => S.M0 = v, fmt: v => v.toFixed(2), flight: true,
      sub: () => CUR.sol ? `V₀ = ${fmtN(CUR.sol.fl.V0)} m/s` : '' }),
    mkSlider({ id: 'thr', label: '油門 Tt4 / Tt4,max', min: 0.5, max: 1, step: 0.005, get: () => S.thr, set: v => S.thr = v, fmt: v => (v * 100).toFixed(1) + ' %', flight: true,
      sub: () => CUR.sol ? `燃燒室出口目標 Tt4 ${fmtN(CUR.sol.op.Tt4)} K` : '' }),
  ));
  if (T.hasAB) rack.append(grp('後燃器與噴嘴', 'REHEAT · NOZZLE',
    mkSwitch({ id: 'ab', label: '後燃器點燃', cls: 'ab', get: () => S.ab, set: v => { S.ab = v; S.preset = null; updatePresetButtons(); } }),
    mkSlider({ id: 'Tt7', label: '後燃器出口總溫', sym: 'Tt7', min: 1500, max: 2300, step: 10, get: () => S.Tt7, set: v => S.Tt7 = v, fmt: v => fmtN(v) + ' K', disabled: () => !S.ab }),
    mkSelect({ id: 'noz', label: '噴嘴型式', options: [['cd', '收斂－擴張（可變）'], ['conv', '收斂（可變喉部）']], get: () => S.nozzleType, set: v => S.nozzleType = v }),
  ));
  rack.append(grp('視圖', 'VIEW',
    mkSlider({ id: 'phi', label: '剖切方位', sym: 'φ', min: 0, max: 360, step: 1, get: () => S.phi, set: v => S.phi = v, fmt: v => v.toFixed(0) + '°', level: 'view' }),
    mkSlider({ id: 'wedge', label: '剖開角度', min: 0, max: 270, step: 15, get: () => S.wedge, set: v => S.wedge = v, fmt: v => v.toFixed(0) + '°', level: 'view' }),
    mkSlider({ id: 'np', label: '粒子數量', min: 0, max: 6000, step: 100, get: () => S.particles, set: v => S.particles = v, fmt: v => fmtN(v), level: 'particles' }),
    mkSlider({ id: 'anim', label: '動畫速度', min: 0, max: 3, step: 0.1, get: () => S.anim, set: v => S.anim = v, fmt: v => v === 0 ? '暫停' : v.toFixed(1) + '×', level: 'none', sub: () => '粒子沿 CFD 速度場 (u, v) 移動，速度 × 0.0032 × 倍率' }),
    mkSelect({ id: 'pcol', label: '粒子著色', options: [['white', '白色（與剖面區隔）'], ['field', '依場變數']], get: () => S.pcolor, set: v => S.pcolor = v, level: 'none' }),
    mkSwitch({ id: 'swB', label: '顯示葉片', get: () => S.blades, set: v => S.blades = v, level: 'none' }),
    mkSwitch({ id: 'swC', label: '等值線', get: () => S.contours, set: v => S.contours = v, level: 'paint' }),
    mkSwitch({ id: 'swL', label: '元件標籤', get: () => S.labels, set: v => S.labels = v, level: 'none' }),
    mkSwitch({ id: 'swK', label: '鎖定色階範圍', get: () => S.lock, set: v => S.lock = v, level: 'paint' }),
  ));
  const dsn = [
    mkSlider({ id: 'mdot', label: '設計空氣流量', sym: 'ṁ', min: DR.mdot[0], max: DR.mdot[1], step: DR.mdot[2], get: () => S.design.mdot, set: v => S.design.mdot = v, fmt: v => fmtN(v) + ' kg/s', sub: () => '改變後重建網格並重新起始' }),
    mkSlider({ id: 'opr', label: '總壓比', sym: 'OPR', min: DR.opr[0], max: DR.opr[1], step: DR.opr[2], get: () => S.design.opr, set: v => S.design.opr = v, fmt: v => v.toFixed(1) }),
  ];
  if (DR.fpr) dsn.push(mkSlider({ id: 'fpr', label: '風扇壓比', sym: 'π_f', min: DR.fpr[0], max: DR.fpr[1], step: DR.fpr[2], get: () => S.design.fpr, set: v => S.design.fpr = v, fmt: v => v.toFixed(2) }));
  if (DR.bpr) dsn.push(mkSlider({ id: 'bpr', label: '涵道比', sym: 'α', min: DR.bpr[0], max: DR.bpr[1], step: DR.bpr[2], get: () => S.design.bpr, set: v => S.design.bpr = v, fmt: v => v.toFixed(1) }));
  if (DR.pibst) dsn.push(mkSlider({ id: 'pibst', label: '增壓級壓比', sym: 'π_LPC', min: DR.pibst[0], max: DR.pibst[1], step: DR.pibst[2], get: () => S.design.pibst, set: v => S.design.pibst = v, fmt: v => v.toFixed(2) }));
  dsn.push(mkSlider({ id: 'Tt4max', label: '最大渦輪入口溫度', sym: 'Tt4,max', min: DR.Tt4max[0], max: DR.Tt4max[1], step: DR.Tt4max[2], get: () => S.design.Tt4max, set: v => S.design.Tt4max = v, fmt: v => fmtN(v) + ' K' }));
  rack.append(grp('設計參數', 'DESIGN POINT', el('p', { class: 'note' }, '一維循環的設計點；CFD 以其工作點設定葉片排溫度比與燃燒室目標溫度'), ...dsn));
  const E = S.eff;
  const ef = (id, label, sym, min, max, step) => mkSlider({ id, label, sym, min, max, step, get: () => E[id], set: v => E[id] = v, fmt: v => v.toFixed(3) });
  rack.append(grp('部件效率', 'COMPONENTS',
    S.type !== 'tj' ? ef('ef', '風扇多變效率', 'e_f', 0.80, 0.95, 0.005) : null,
    ef('ec', '壓氣機多變效率', 'e_c', 0.80, 0.95, 0.005),
    ef('et', '渦輪多變效率', 'e_t', 0.80, 0.95, 0.005),
    ef('etb', '燃燒效率', 'η_b', 0.90, 1.0, 0.005),
    ef('etam', '機械效率', 'η_m', 0.95, 1.0, 0.002),
  ));
  const pin = el('div', { class: 'probe-in' },
    el('label', null, 'x (m)', el('input', { id: 'pinX', type: 'number', step: '0.01' })),
    el('label', null, 'r (m)', el('input', { id: 'pinR', type: 'number', step: '0.005', min: '0' })),
    el('span'),
    el('button', { class: 'btn', onclick: () => { const x = +$('#pinX').value, r = +$('#pinR').value; if (isFinite(x) && isFinite(r)) addPin(x, Math.abs(r), S.phi * DEG); } }, '放置'),
  );
  rack.append(grp('探針', 'PROBES', el('p', { class: 'note' }, '在剖面上點擊即可釘選（CFD 為軸對稱，θ 不影響數值）'), pin,
    el('table', { class: 'pins', id: 'pins' }),
    el('div', null, el('button', { class: 'btn', onclick: () => { S.pins = []; renderPins(); } }, '清除全部探針'))));
  refreshControls();
}
function refreshControls() {
  for (const c of CTRLS) c.refresh();
  updatePresetButtons();
  const b = $('#btnRun'); if (b) b.textContent = S.running ? '暫停求解' : '繼續求解';
  const n = $('#solverNote');
  if (n) n.textContent = CFD.kind === 'cpu' ? '此裝置不支援 WebGL2 浮點渲染，改用 CPU 求解（極粗網格，速度較慢）。' : CFD.grid ? `目前網格 ${CFD.grid.W} × ${CFD.grid.H} = ${fmtN(CFD.grid.N)} 格${CFD.seqTarget ? '（粗網格預收斂中，之後內插至目標網格）' : ''}` : '';
}

/* ---------- 排程 ---------- */
const LV = { none: 0, particles: 1, paint: 2, view: 3, solver: 4, params: 5, grid: 6 };
let pend = null, raf = 0, dragging = false;
function request(level, hi) {
  if (!pend) pend = { level: 0, hi: false };
  pend.level = Math.max(pend.level, LV[level] || 0);
  pend.hi = pend.hi || hi;
  if (!raf) raf = requestAnimationFrame(runPending);
}
document.addEventListener('pointerdown', e => { if (e.target && e.target.type === 'range') dragging = true; });
document.addEventListener('pointerup', () => { if (dragging) { dragging = false; request('params', true); } });
function runPending() {
  raf = 0;
  const p = pend; pend = null;
  if (!p) return;
  const final = p.hi && !dragging;
  if (p.level >= LV.grid) { solveCycle(); setupCFD(true); }
  else if (p.level >= LV.params) { const g = solveCycle(); if (g) setupCFD(true); else updateCFDParams(final); }
  if (p.level >= LV.solver && CFD.solver) { Object.assign(CFD.solver.opt, { cfl: S.cfl, order: S.order, visc: S.visc }); CFD.conv = false; }
  if (p.level >= LV.view) setWedge(S.phi * DEG, S.wedge * DEG);
  if (p.level >= LV.paint) paintAll();
  if (p.level >= LV.particles) syncParticles();
  if (p.level >= LV.params) { refreshControls(); updatePanels(true); }
}
function params() { return { type: S.type, design: S.design, eff: S.eff, alt: S.alt, M0: S.M0, thr: S.thr, ab: S.ab, Tt7: S.Tt7, nozzleType: S.nozzleType }; }
/* 一維循環與幾何；回傳 true 表示網格需重建 */
function solveCycle() {
  const P = params();
  const sol = solveEngine(P);
  const T = ENGINE_TYPES[S.type];
  const s = Math.sqrt(S.design.mdot / T.design.mdot);
  const nz = sol.op.noz;
  const rf = sol.ref;
  const noz = { r8: Math.sqrt(nz.Athroat / Math.PI), r9: Math.sqrt(Math.max(nz.A, nz.Athroat) / Math.PI), A9: rf.noz && rf.noz.A, A19: rf.nozB && rf.nozB.A };
  const spec = buildSpec(S.type, s, noz);
  const model = new FieldModel(spec, sol, P);
  Object.assign(CUR, { sol, spec, model, P });
  const key = S.type + '|' + s.toFixed(4) + (S.type === 'hbtf' ? '|' + spec.exitsGeom.map(e => e.R.toFixed(4)).join('|') : '');
  let regrid = false;
  if (key !== CUR.specKey) {
    buildEngineMeshes(spec);
    R3.floor.position.set(spec.view.target[0], -spec.view.Rmax * 1.7, 0);
    CUR.specKey = key; CUR.nozKey = null; regrid = true;
    buildLabels();
    if (S.pins === null) S.pins = defaultPins(spec);
    S.rpXf = defaultRpX(spec);
  }
  if (spec.nozzle) {
    const nk = noz.r8.toFixed(3) + '|' + noz.r9.toFixed(3);
    if (nk !== CUR.nozKey) { if (CUR.nozKey && !regrid) { buildBodies(spec); CUR.nozChanged = true; } CUR.nozKey = nk; }
  }
  return regrid;
}

/* ---------- CFD 管理 ---------- */
function cfdFs(fl) { return { r: fl.P0 / (RGAS * fl.T0), u: fl.V0, p: fl.P0 }; }
function makeSolver(grid, zones, comps, fs, Q0) {
  const opt = { cfl: S.cfl, order: S.order, visc: S.visc, hf: S.eff.etb * S.eff.LHV };
  if (CFD.kind !== 'cpu') {
    try { return { s: new GPUSolver(grid, zones, comps, fs, Q0, opt), kind: 'gpu' }; }
    catch (e) { console.warn('GPU 求解器無法使用：', e.message); CFD.gpuError = e.message; }
  }
  return { s: new CPUSolver(grid, zones, comps, fs, Q0, opt), kind: 'cpu' };
}
function setupCFD(reinit, fromState, levelOverride) {
  const { spec, model, sol, P } = CUR;
  let level = levelOverride || S.grid;
  if (CFD.kind === 'cpu') level = 'xcoarse';
  // 網格序列：目標為中／細且非由舊解內插時，先在粗網格預收斂
  CFD.seqTarget = null;
  if (!fromState && reinit && (level === 'medium' || level === 'fine') && CFD.kind !== 'cpu') { CFD.seqTarget = level; level = 'coarse'; }
  const grid = buildCFDGrid(spec, level);
  const zones = buildZones(grid, spec, model, sol.op, P);
  const comps = compParams(S.type, sol.op, P), base = Float64Array.from(comps);
  if (fromState && CFD.comps) { comps[17] = CFD.comps[17]; comps[29] = CFD.comps[29]; } // 延續出口總溫控制係數
  const Q0 = fromState ? interpState(fromState.grid, fromState.zones, fromState.Q, grid, zones) : initialState(grid, zones, spec, model, sol.fl, S.init === 'uniform');
  if (CFD.solver && CFD.solver.dispose) CFD.solver.dispose();
  const mk = makeSolver(grid, zones, comps, cfdFs(sol.fl), Q0);
  if (mk.kind === 'cpu' && level !== 'xcoarse') { CFD.kind = 'cpu'; return setupCFD(reinit, null, 'xcoarse'); }
  Object.assign(CFD, { solver: mk.s, kind: mk.kind, grid, zones, comps, base, Q: mk.kind === 'cpu' ? mk.s.Q : Q0, map: new CFDMap(grid),
    itAtRead: 0, prevRho: null, res: NaN, conv: false, error: null, readT: 0, k: mk.kind === 'cpu' ? 1 : 6, mfx: null, ctl: null });
  if (!fromState) { CFD.hist = []; CFD.itTotal = 0; CFD.lastF = []; }
  CFD.startIt = CFD.itTotal;
  CFD.solver.setComps(CFD.comps);
  R3.sliceA.geometry.dispose(); R3.sliceB.geometry.dispose();
  R3.sliceA.geometry = cfdSliceGeometry(grid); R3.sliceB.geometry = cfdSliceGeometry(grid);
  CFD.G = cfdDerived(grid, zones, CFD.Q, sol.fl, null, true);
  S.running = true;
  paintAll(); resetParticles();
  refreshControls();
}
/* 參數改變（幾何不變）：更新葉片排溫度比、熱源目標、自由流；噴嘴幾何改變時重算切割格 */
function updateCFDParams(final) {
  if (!CFD.solver) return;
  const { spec, model, sol, P } = CUR;
  if (CUR.nozChanged && final) {
    CUR.nozChanged = false;
    const z = buildZones(CFD.grid, spec, model, sol.op, P);
    CFD.zones = z;
  } else updateHeatZones(CFD.grid, CFD.zones, spec, sol.op);
  const comps = compParams(S.type, sol.op, P);
  CFD.base = Float64Array.from(comps);
  if (CFD.comps) { comps[17] = CFD.comps[17]; comps[29] = CFD.comps[29]; } // 延續出口總溫控制係數
  CFD.comps = comps;
  CFD.solver.setZones(CFD.zones); CFD.solver.setFs(cfdFs(sol.fl));
  CFD.solver.opt.hf = S.eff.etb * S.eff.LHV;
  CFD.solver.setComps(comps);
  CFD.conv = false; S.running = true; CFD.lastF = []; CFD.startIt = CFD.itTotal;
}
function restartCFD() { setupCFD(true); updatePanels(true); }
function toggleRun() { S.running = !S.running; if (S.running) { CFD.conv = false; CFD.lastF = []; CFD.startIt = CFD.itTotal; } refreshControls(); updateSolverBar(); }

/* 非均勻網格映射（與 gridLookup 相容） */
function CFDMap(grid) { this.g = grid; this.W = grid.W; this.H = grid.H; }
function fracIdx(arr, v) {
  const n = arr.length; if (v <= arr[0]) return (v - arr[0]) / (arr[1] - arr[0]);
  if (v >= arr[n - 1]) return n - 1 + (v - arr[n - 1]) / (arr[n - 1] - arr[n - 2]);
  let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arr[m] <= v) lo = m; else hi = m; }
  return lo + (v - arr[lo]) / (arr[hi] - arr[lo]);
}
CFDMap.prototype.uOfX = function (x) { return (fracIdx(this.g.xc, x) + 0.5) / this.W; };
CFDMap.prototype.vOfR = function (r) { return (fracIdx(this.g.rc, r) + 0.5) / this.H; };

/* 網格間內插（網格序列用） */
function interpState(gA, zA, QA, gB, zB) {
  const N = gB.N, Q = [0, 1, 2, 3, 4].map(() => new Float64Array(N));
  for (let j = 0; j < gB.H; j++) {
    const fj = fracIdx(gA.rc, gB.rc[j]);
    for (let i = 0; i < gB.W; i++) {
      const fi = fracIdx(gA.xc, gB.xc[i]);
      const i0 = clamp(Math.floor(fi), 0, gA.W - 1), j0 = clamp(Math.floor(fj), 0, gA.H - 1);
      const tx = clamp(fi - i0, 0, 1), ty = clamp(fj - j0, 0, 1);
      let wsum = 0; const acc = [0, 0, 0, 0, 0];
      for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
        const ii = Math.min(i0 + di, gA.W - 1), jj = Math.min(j0 + dj, gA.H - 1), k = jj * gA.W + ii;
        if (zA.solid[k] || w <= 0) continue;
        for (let q = 0; q < 5; q++) acc[q] += w * QA[q][k]; wsum += w;
      }
      const kB = j * gB.W + i;
      if (wsum <= 0) { // 最近流體格
        let best = -1, bd = 1e9;
        for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) {
          const ii = clamp(i0 + di, 0, gA.W - 1), jj = clamp(j0 + dj, 0, gA.H - 1), k = jj * gA.W + ii;
          if (!zA.solid[k] && di * di + dj * dj < bd) { bd = di * di + dj * dj; best = k; }
        }
        if (best < 0) { const fl = CUR.sol.fl; Q[0][kB] = fl.P0 / (RGAS * fl.T0); Q[3][kB] = fl.P0 / 0.4; continue; }
        for (let q = 0; q < 5; q++) Q[q][kB] = QA[q][best];
      } else for (let q = 0; q < 5; q++) Q[q][kB] = acc[q] / wsum;
    }
  }
  return Q;
}

/* ---------- 讀回、後處理、收斂 ---------- */
function cfdRead() {
  const now = performance.now();
  CFD.readT = now;
  const sv = CFD.solver, g = CFD.grid, z = CFD.zones, fl = CUR.sol.fl;
  CFD.Q = CFD.kind === 'gpu' ? sv.read(CFD.Q && CFD.Q[0] instanceof Float32Array ? CFD.Q : null) : sv.Q;
  const Q = CFD.Q, N = g.N;
  const it = sv.iter, dIt = it - CFD.itAtRead;
  if (CFD.prevRho && dIt > 0) {
    let s2 = 0, n = 0;
    for (let k = 0; k < N; k += 2) { if (z.solid[k]) continue; const d = (Q[0][k] - CFD.prevRho[k]) / CFD.prevRho[k]; if (d === d) { s2 += d * d; n++; } }
    CFD.res = Math.sqrt(s2 / Math.max(1, n)) / dIt;
  }
  if (!CFD.prevRho || CFD.prevRho.length !== N) CFD.prevRho = new Float32Array(N);
  CFD.prevRho.set(Q[0]);
  CFD.itTotal += dIt; CFD.itAtRead = it;
  // 發散偵測
  let bad = 0; for (let k = 0; k < N; k += 7) if (!(Q[3][k] > 0) || !(Q[0][k] > 0)) bad++;
  if (bad) { handleDivergence(); return; }
  CFD.mfx = sv.mfx && CFD.itTotal > 0 ? sv.mfx : null;
  const src = CFD.mfx && sv.src ? { S: sv.src, F: sv.mfx } : null;
  const f = cfdForces(g, z, Q, CFD.comps, fl.P0, S.eff.etb * S.eff.LHV, src);
  CFD.forces = f;
  // 燃燒室／後燃器出口總溫控制（相當於燃油控制）；轉軸功率比為診斷
  if (src && dIt > 0 && CFD.itTotal > 1500 && CFD.itTotal - CFD.startIt > 300) {
    const c = cfdControl(S.type, CUR.spec, g, z, Q, CFD.mfx, CFD.comps, CFD.base, f.pw, CUR.sol.op, S.eff.etam, dIt);
    CFD.ratios = c.ratios; CFD.ctl = c; sv.setComps(CFD.comps);
  } else CFD.ratios = spoolRatios(S.type, f.pw, S.eff.etam);
  if (dIt > 0) CFD.hist.push({ it: CFD.itTotal, res: CFD.res, F: f.F });
  if (CFD.hist.length > 800) CFD.hist = CFD.hist.filter((h, i) => i % 2 === 0 || i > CFD.hist.length - 200); // 抽稀舊紀錄，保留完整歷程
  CFD.G = cfdDerived(g, z, Q, fl, CFD.G, true);
  paintAll();
  // 收斂判斷：殘差低，或推力於最近 2,000 次迭代內變化 < 0.3%
  CFD.lastF.push([CFD.itTotal, f.F]);
  while (CFD.lastF.length > 2 && CFD.lastF[1][0] < CFD.itTotal - 2000) CFD.lastF.shift();
  const span = CFD.lastF.length > 1 ? CFD.itTotal - CFD.lastF[0][0] : 0;
  let fmin = Infinity, fmax = -Infinity; for (const [, v] of CFD.lastF) { fmin = Math.min(fmin, v); fmax = Math.max(fmax, v); }
  const steady = span >= 1800 && (fmax - fmin) < 0.003 * Math.max(1, Math.abs(f.F)) && CFD.res < 6e-5;
  const minIt = CFD.seqTarget ? 2500 : 3000, cap = !CFD.seqTarget && CFD.itTotal - CFD.startIt > 60000;
  CFD.capped = cap;
  if (CFD.itTotal - CFD.startIt > minIt && (CFD.res < 2e-5 || steady || cap)) {
    if (CFD.seqTarget) { const t = CFD.seqTarget; setupCFD(false, { grid: g, zones: z, Q }, t); return; }
    CFD.conv = true; S.running = false; refreshControls();
  } else if (CFD.seqTarget && CFD.itTotal - CFD.startIt > 9000) { const t = CFD.seqTarget; setupCFD(false, { grid: g, zones: z, Q }, t); return; }
}
function handleDivergence() {
  CFD.error = '偵測到非物理數值，已降低 CFL 並以一階格式由循環估算場重新起始';
  S.cfl = Math.max(0.3, S.cfl - 0.2); S.order = 1;
  setupCFD(true);
}

/* ---------- 著色 ---------- */
const HATCH = { 1: [[38, 46, 56], [58, 69, 82]], 2: [[34, 40, 48], [52, 60, 70]], 3: [[40, 48, 58], [62, 72, 84]], 4: [[70, 56, 36], [102, 82, 52]] };
function currentRange() {
  if (S.lock && CFD.range && CFD.rangeKey === S.field) return CFD.range;
  CFD.range = gridRange(CFD.G, S.field, true); CFD.rangeKey = S.field;
  return CFD.range;
}
function paintGrid(G, data, key, norm, lut, showExt, contours) {
  const W = G.W, H = G.H, A = G[key], R = G.reg;
  const fl = CUR.sol.fl, V0 = fl.V0, Tt0 = fl.Tt0, GV = G.V, GT = G.Tt;
  const nLev = 14;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const idx = j * W + i, o = idx * 4, reg = R[idx];
    if (reg === 1) {
      const hc = HATCH[G.mat[idx]] || HATCH[1];
      const c = ((i + j) % 6) < 2 ? hc[1] : hc[0];
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; continue;
    }
    if (reg === 0 && !showExt) { data[o + 3] = 0; continue; }
    const t = norm(A[idx]);
    const li = Math.round(t * 255) * 3;
    let r = lut[li], g = lut[li + 1], b = lut[li + 2];
    if (contours) {
      const lv = Math.floor(t * nLev);
      if ((i + 1 < W && R[idx + 1] !== 1 && Math.floor(norm(A[idx + 1]) * nLev) !== lv) || (j + 1 < H && R[idx + W] !== 1 && Math.floor(norm(A[idx + W]) * nLev) !== lv)) { r *= 0.55; g *= 0.55; b *= 0.55; }
    }
    data[o] = r; data[o + 1] = g; data[o + 2] = b;
    data[o + 3] = reg === 0 ? Math.round(95 + 160 * clamp(Math.abs(GV[idx] - V0) / 90 + Math.abs(GT[idx] - Tt0) / 160, 0, 1)) : 255;
  }
}
function paintAll() {
  const G = CFD.G; if (!G) return;
  const key = S.field, f = FIELDS[key];
  const range = currentRange(), norm = makeNorm(key, range), lut = LUTS[f.cmap];
  CFD.norm = norm; CFD.lut = lut;
  resizeTex(R3.texA, G.W, G.H); R3.sliceA.material.map = R3.texA;
  const ct = S.contours && !f.zc; // 渦度場雜訊多，不畫等值線
  paintGrid(G, R3.texA.image.data, key, norm, lut, true, ct); R3.texA.needsUpdate = true;
  resizeTex(R3.texB, G.W, G.H); R3.sliceB.material.map = R3.texB;
  paintGrid(G, R3.texB.image.data, key, norm, lut, Math.abs(S.wedge - 180) < 1, ct); R3.texB.needsUpdate = true;
  drawLegend();
}
function cfdSliceGeometry(g) {
  const pos = [], uv = [], idx = [];
  const W = g.W, H = g.H, sx = Math.max(1, Math.floor(W / 240)), sy = Math.max(1, Math.floor(H / 140));
  const xi = []; for (let i = 0; i <= W; i += sx) xi.push(i); if (xi[xi.length - 1] !== W) xi.push(W);
  const yj = []; for (let j = 0; j <= H; j += sy) yj.push(j); if (yj[yj.length - 1] !== H) yj.push(H);
  for (const j of yj) for (const i of xi) { pos.push(g.xf[i], g.rf[j], 0); uv.push(i / W, j / H); }
  const nx = xi.length;
  for (let a = 0; a < yj.length - 1; a++) for (let b = 0; b < nx - 1; b++) { const p = a * nx + b; idx.push(p, p + 1, p + nx, p + 1, p + nx + 1, p + nx); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); return geo;
}
function niceTicks(a, b, n) {
  const span = b - a; if (!(span > 0)) return [a];
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(a, b) {
  const out = [];
  for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) out.push(v); }
  return out;
}
function drawLegend() {
  const key = S.field, f = FIELDS[key], [a, b] = CFD.range;
  $('#lgName').innerHTML = `<b>${f.name} ${f.sym}</b>${f.log ? '（對數色階）' : f.diverge ? '（以 M = 1 為中點）' : f.zc ? '（以 0 為中點）' : ''}${S.lock ? ' · 已鎖定' : ''}`;
  $('#lgUnit').textContent = f.unit;
  const cv = $('#lgCanvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cv.clientWidth * dpr) || 280, H = Math.round(30 * dpr);
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), lut = LUTS[f.cmap], norm = CFD.norm, bh = 10 * dpr;
  for (let x = 0; x < W; x++) { const li = Math.round(x / (W - 1) * 255) * 3; g.fillStyle = `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`; g.fillRect(x, 0, 1, bh); }
  let ticks;
  if (f.diverge) ticks = [0, 0.5, 1, ...niceTicks(1, Math.max(1.05, b), 3).filter(v => v > 1)];
  else if (f.log) { ticks = logTicks(a, b); if (ticks.length > 7) ticks = ticks.filter((_, i) => i % 2 === 0); }
  else ticks = niceTicks(a, b, 5);
  g.fillStyle = '#a8b4c0'; g.font = `${10 * dpr}px "B612 Mono", monospace`; g.textBaseline = 'top';
  let lastX = -1e9;
  for (const v of ticks) {
    const t = norm(v); if (t < 0 || t > 1) continue;
    const x = Math.round(t * (W - 1)) + 0.5;
    g.fillRect(x - 0.5 * dpr, bh, dpr, 3 * dpr);
    const s = fmtN(v * f.sc, key === 'M' || key === 'Y' ? 1 : (f.log && v * f.sc < 10 ? (v * f.sc < 1 ? 2 : 1) : 0));
    const tw = g.measureText(s).width;
    const tx = clamp(x - tw / 2, 0, W - tw);
    if (tx < lastX + 4 * dpr) continue;
    g.fillText(s, tx, bh + 5 * dpr); lastX = tx + tw;
  }
}

/* ---------- CFD 取樣（雙線性，跳過固體） ---------- */
const CFD_KEYS = ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho', 'Vx', 'Vr', 'Y', 'vort', 'ds'];
function cfdSample(x, r) {
  const G = CFD.G, map = CFD.map; if (!G) return null;
  const fi = fracIdx(CFD.grid.xc, x), fj = fracIdx(CFD.grid.rc, r);
  const i0 = clamp(Math.floor(fi), 0, G.W - 2), j0 = clamp(Math.floor(fj), 0, G.H - 2);
  const tx = clamp(fi - i0, 0, 1), ty = clamp(fj - j0, 0, 1);
  const ic = clamp(Math.round(fi), 0, G.W - 1), jc = clamp(Math.round(fj), 0, G.H - 1), kc = jc * G.W + ic;
  if (G.reg[kc] === 1) return { solid: true, mat: G.mat[kc], i: ic, j: jc };
  const out = { solid: false, i: ic, j: jc, reg: G.reg[kc] };
  let ws = 0; for (const q of CFD_KEYS) out[q] = 0;
  for (const [di, dj, w] of [[0, 0, (1 - tx) * (1 - ty)], [1, 0, tx * (1 - ty)], [0, 1, (1 - tx) * ty], [1, 1, tx * ty]]) {
    const k = (j0 + dj) * G.W + i0 + di; if (G.reg[k] === 1 || w <= 0) continue;
    for (const q of CFD_KEYS) out[q] += w * G[q][k]; ws += w;
  }
  if (ws <= 0) return { solid: true, mat: G.mat[kc] };
  for (const q of CFD_KEYS) out[q] /= ws;
  const Y = out.Y, g = 1.4 - 0.07 * Y; out.g = g; out.cp = g * RGAS / (g - 1); out.a = Math.sqrt(g * RGAS * out.T);
  return out;
}

/* ---------- 粒子（沿 CFD 速度場） ---------- */
function resetParticles() { const P = R3.P; P.n = 0; syncParticles(); for (let k = 0; k < 40; k++) stepParticles(0.25, true); }
function syncParticles() {
  const P = R3.P, want = S.particles;
  if (!CFD.G) return;
  if (want > P.n) for (let i = P.n; i < want; i++) spawn(i);
  P.n = want;
  R3.pts.geometry.setDrawRange(0, want);
  R3.pts.material.uniforms.uSize.value = 0.02 * CUR.spec.s;
}
function pBounds() { const sp = CUR.spec, L = sp.view.len, xe = sp.exitsGeom[0].x; return [Math.max(sp.domain.xb[0], sp.lip.x - 0.45 * L), Math.min(sp.domain.xb[sp.domain.xb.length - 1], xe + 1.3 * L), Math.min(sp.domain.rb[sp.domain.rb.length - 1], 1.5 * sp.view.Rmax)]; }
function wedgeTh() { const w = S.wedge * DEG; return w > 0.01 ? S.phi * DEG + Math.random() * Math.min(w, 2 * Math.PI) : Math.random() * 2 * Math.PI; }
function spawn(i) {
  const P = R3.P, G = CFD.G, [x0, x1, rmax] = pBounds();
  for (let t = 0; t < 14; t++) {
    const x = lerp(x0, x1, Math.random()), r = rmax * Math.random();
    const u = gridLookup(G, CFD.map, x, r, 'V');
    if (!(u === u)) continue;
    if (Math.random() > 0.2 + 0.8 * Math.min(1, u / 150)) continue;
    P.x[i] = x; P.psi[i] = r; P.th[i] = wedgeTh(); P.age[i] = 0; return;
  }
  P.x[i] = x0; P.psi[i] = 0.3 * rmax; P.th[i] = wedgeTh(); P.age[i] = 0;
}
function stepParticles(dt, warm) {
  const P = R3.P, G = CFD.G, map = CFD.map; if (!G || !P.n) return;
  const kv = 0.0032 * (warm ? 1 : S.anim);
  const pos = R3.pts.geometry.attributes.position.array, col = R3.pts.geometry.attributes.color.array, al = R3.pts.geometry.attributes.alpha.array;
  const [x0, x1, rmax] = pBounds();
  const key = S.field, norm = CFD.norm, lut = CFD.lut, white = S.pcolor === 'white';
  const phi = S.phi * DEG, w = S.wedge * DEG;
  for (let i = 0; i < P.n; i++) {
    let x = P.x[i], r = P.psi[i];
    const u = gridLookup(G, map, x, r, 'Vx'), v = gridLookup(G, map, x, r, 'Vr');
    if (!(u === u) || !(v === v)) { spawn(i); continue; }
    x += u * kv * dt; r += v * kv * dt; if (r < 0) r = -r;
    P.age[i] += dt;
    if (x < x0 - 0.1 || x > x1 || r > rmax * 1.1 || P.age[i] > 30 || (Math.abs(u) + Math.abs(v)) * kv < 0.004 && P.age[i] > 6) { spawn(i); x = P.x[i]; r = P.psi[i]; }
    if (w > 0.01 && w < 2 * Math.PI - 0.01) { let d = P.th[i] - phi; d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI); if (d > w) P.th[i] = phi + Math.random() * w; }
    P.x[i] = x; P.psi[i] = r;
    if (warm) continue;
    const th = P.th[i];
    pos[i * 3] = x; pos[i * 3 + 1] = r * Math.cos(th); pos[i * 3 + 2] = r * Math.sin(th);
    if (white) { col[i * 3] = 0.93; col[i * 3 + 1] = 0.97; col[i * 3 + 2] = 1; }
    else {
      let val = gridLookup(G, map, x, r, key); if (!(val === val)) val = CFD.range[0];
      const li = Math.round(norm(val) * 255) * 3;
      col[i * 3] = lut[li] / 255; col[i * 3 + 1] = lut[li + 1] / 255; col[i * 3 + 2] = lut[li + 2] / 255;
    }
    al[i] = G.reg[clamp(Math.round(fracIdx(CFD.grid.rc, r)), 0, G.H - 1) * G.W + clamp(Math.round(fracIdx(CFD.grid.xc, x)), 0, G.W - 1)] === 0 ? 0.35 : 0.9;
  }
  if (!warm) { const a = R3.pts.geometry.attributes; a.position.needsUpdate = a.color.needsUpdate = a.alpha.needsUpdate = true; }
}

/* ---------- 標籤、探針 ---------- */
function buildLabels() {
  const L = $('#labels3d'); L.innerHTML = '';
  CUR.labels = [];
  const sp = CUR.spec;
  const keys = ['inlet', ...sp.chartComps]; if (sp.comps.find(c => c.key === 'byp')) keys.push('byp');
  let k = 0;
  for (const ck of keys) {
    const c = sp.comps.find(q => q.key === ck); if (!c) continue;
    const e = el('div', { class: 'lbl3d', title: c.en }, c.name.replace(/（.*）/, ''));
    L.append(e);
    CUR.labels.push({ e, p: new THREE.Vector3(0.5 * (c.x0 + c.x1), sp.view.Rmax * [1.16, 1.36, 1.56][k++ % 3], 0) });
  }
  CUR.pinLabels = [];
}
function defaultPins(sp) {
  const mid = (key, x) => { const s = sp.streams[key]; return 0.5 * (s.lo.at(x) + s.hi.at(x)); };
  const th = S.phi * DEG, pins = [];
  const f = sp.rows.find(r => r.kind === 'fan' || r.comp === 'comp');
  pins.push({ x: f.x0 - 0.02 * sp.s, r: mid(sp.order[0], f.x0 - 0.02 * sp.s), th });
  const c = sp.comb, xc = lerp(c.xd, c.x1, 0.35);
  pins.push({ x: xc, r: mid('core', xc), th });
  const ngv = sp.rows.find(r => r.kind === 'ngv'), xn = 0.5 * (ngv.x0 + ngv.x1);
  pins.push({ x: xn, r: mid('core', xn), th });
  const ex = sp.exitsGeom[sp.exitsGeom.length - 1];
  pins.push({ x: ex.x + 0.6 * ex.R, r: ex.plugTip ? 0.5 * (ex.R + ex.Rin) : 0.3 * ex.R, th });
  return pins;
}
function addPin(x, r, th) { if (!S.pins) S.pins = []; if (S.pins.length >= 6) S.pins.shift(); S.pins.push({ x, r, th }); renderPins(); }
function renderPins() {
  const tb = $('#pins'); if (!tb || !CFD.G) return;
  tb.innerHTML = '';
  if (!S.pins || !S.pins.length) tb.append(el('tr', null, el('td', { class: 'empty', colspan: 5 }, '尚無探針')));
  else {
    tb.append(el('tr', null, el('th', null, '#'), el('th', null, 'x, r (m)'), el('th', null, 'T (K)'), el('th', null, 'P (kPa)'), el('th', null, 'V · M'), el('th', null, '')));
    S.pins.forEach((p, i) => {
      const o = cfdSample(p.x, p.r) || { solid: true };
      tb.append(el('tr', { style: 'cursor:pointer', onclick: () => showProbe(p, i + 1) },
        el('td', { html: `<span class="pn">${i + 1}</span>` }), el('td', null, `${p.x.toFixed(2)}, ${p.r.toFixed(3)}`),
        el('td', null, o.solid ? '固體' : fmtN(o.T)), el('td', null, o.solid ? '' : fmtN(o.P / 1000, 1)),
        el('td', null, o.solid ? '' : `${fmtN(o.V)} · ${o.M.toFixed(2)}`),
        el('td', null, el('button', { title: '移除', 'aria-label': '移除探針', onclick: ev => { ev.stopPropagation(); S.pins.splice(i, 1); renderPins(); } }, '×'))));
    });
  }
  disposeGroup(R3.pinGroup);
  for (const pl of (CUR.pinLabels || [])) pl.e.remove();
  CUR.pinLabels = [];
  const rad = 0.018 * CUR.spec.s;
  (S.pins || []).forEach((p, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd882e6, depthTest: false, toneMapped: false }));
    s.renderOrder = 6; s.position.set(p.x, p.r * Math.cos(p.th), p.r * Math.sin(p.th)); R3.pinGroup.add(s);
    const e = el('div', { class: 'lbl3d', style: 'border-left-color:#d882e6;transform:translate(6px,-50%)' }, String(i + 1));
    $('#labels3d').append(e); CUR.pinLabels.push({ e, p: s.position.clone() });
  });
  if (!CUR.hovering) showProbe(S.pins && S.pins.length ? S.pins[S.pins.length - 1] : null, S.pins ? S.pins.length : 0);
}
const STREAM = { inlet: '進氣流', core: '核心流', bypass: '外涵流', ab: '混合／後燃段' };
const MATN = { 1: '機匣／短艙', 2: '輪轂／中心體', 3: '核心整流罩', 4: '結構' };
function showProbe(p, n, hover) {
  const box = $('#probe'); CUR.lastProbe = [p, n, hover];
  if (!p || !CFD.G) { box.innerHTML = `<h4>探針</h4><div class="hint">移動游標至剖面即可讀取 CFD 解。</div>`; return; }
  const o = cfdSample(p.x, p.r);
  const where = `x ${p.x.toFixed(3)} m · r ${p.r.toFixed(3)} m`;
  const title = (hover ? '探針 · 游標位置' : `探針 #${n}`) + `<button class="pc" aria-label="${S.probeMin ? '展開' : '收合'}探針資訊">${S.probeMin ? '＋' : '－'}</button>`;
  if (!o || o.solid) { box.innerHTML = `<h4>${title}</h4><div class="where">固體：${MATN[o && o.mat] || '結構'}<br>${where}</div>`; return; }
  const st = o.reg >= 2 ? CUR.spec.order[o.reg - 2] : null;
  const cmp = CUR.model.compName(p.x, st || 'x');
  const reg = [st ? STREAM[st] : '外部流場／噴流', cmp ? cmp.name : null].filter(Boolean).join(' · ');
  const cell = `網格 (${o.i}, ${o.j})`;
  if (S.probeMin) { box.innerHTML = `<h4>${title}</h4><div class="where">${reg}</div><dl><dt>T · P</dt><dd>${fmtN(o.T)} K · ${fmtN(o.P / 1000, 1)} kPa</dd><dt>V · M</dt><dd>${fmtN(o.V)} m/s · ${o.M.toFixed(2)}</dd></dl>`; return; }
  box.innerHTML = `<h4>${title}</h4><div class="where">${reg}<br>${where} · ${cell}</div><dl>
    <dt>靜溫 T</dt><dd>${fmtN(o.T)} K</dd><dt>總溫 Tt</dt><dd>${fmtN(o.Tt)} K</dd>
    <dt>靜壓 P</dt><dd>${fmtN(o.P / 1000, o.P < 1e5 ? 2 : 1)} kPa</dd><dt>總壓 Pt</dt><dd>${fmtN(o.Pt / 1000, o.Pt < 1e5 ? 2 : 1)} kPa</dd>
    <dt>速度 V</dt><dd>${fmtN(o.V)} m/s</dd><dt>軸向 u / 徑向 v</dt><dd>${fmtN(o.Vx)} / ${fmtN(o.Vr)} m/s</dd>
    <dt>馬赫數 M</dt><dd>${o.M.toFixed(3)}</dd><dt>密度 ρ</dt><dd>${fmtN(o.rho, 3)} kg/m³</dd>
    <dt>燃燒產物 Y</dt><dd>${o.Y.toFixed(3)}</dd><dt>渦度 ω</dt><dd>${fmtN(o.vort)} 1/s</dd>
    <dt>熵增 Δs</dt><dd>${fmtN(o.ds)} J/(kg·K)</dd><dt>γ · a</dt><dd>${o.g.toFixed(3)} · ${fmtN(o.a)} m/s</dd></dl>
    ${hover ? '<div class="hint">點擊可釘選此點。</div>' : ''}`;
}

/* ---------- 視角 ---------- */
function setView(kind, instant) {
  const sp = CUR.spec; if (!sp) return;
  const asp = R3.camera.aspect || 1.6;
  const t = new THREE.Vector3(...sp.view.target), d = sp.view.dist * Math.pow(Math.max(1, 1.5 / asp), 0.85);
  const phi = S.phi * DEG;
  const rad = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)), nrm = new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi));
  let p;
  if (kind === 'iso') p = t.clone().add(new THREE.Vector3(-0.22 * d, 0, 0)).add(rad.clone().multiplyScalar(0.34 * d)).add(nrm.clone().multiplyScalar(0.9 * d));
  else if (kind === 'side') { p = t.clone().add(nrm.clone().multiplyScalar(d * 0.95)); p.y += 0.001; }
  else if (kind === 'front') p = new THREE.Vector3(sp.lip.x - 0.75 * d, 0.22 * d, 0.3 * d);
  else if (kind === 'rear') p = new THREE.Vector3(sp.outerEnd + 0.8 * d, 0.2 * d, 0.3 * d);
  else p = new THREE.Vector3(t.x, d, 0.001);
  const tgt = kind === 'front' ? new THREE.Vector3(sp.lip.x + 0.3 * sp.view.len, 0, 0) : kind === 'rear' ? new THREE.Vector3(sp.outerEnd - 0.2 * sp.view.len, 0, 0) : t;
  if (instant || reduceMotion) { R3.camera.position.copy(p); R3.controls.target.copy(tgt); R3.controls.update(); return; }
  const p0 = R3.camera.position.clone(), t0 = R3.controls.target.clone(), t1 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t1) / 650), e = k * k * (3 - 2 * k); R3.camera.position.lerpVectors(p0, p, e); R3.controls.target.lerpVectors(t0, tgt, e); if (k < 1) requestAnimationFrame(step); };
  step();
}

/* ---------- 面板 ---------- */
function drawDial(cv, v, o) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = 128, H = 92;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cx = 44, cy = 54, R = 32, a0 = 150 * DEG, sweep = 210 * DEG;
  const ang = val => a0 + sweep * clamp((val - o.min) / (o.max - o.min), 0, 1);
  g.fillStyle = 'rgba(226,232,238,0.13)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, ang(v)); g.closePath(); g.fill();
  g.lineWidth = 2; g.strokeStyle = '#e2e8ee'; g.beginPath(); g.arc(cx, cy, R, a0, ang(o.amber)); g.stroke();
  g.strokeStyle = '#f3b43f'; g.beginPath(); g.arc(cx, cy, R, ang(o.amber), ang(o.red)); g.stroke();
  g.strokeStyle = '#f25a4f'; g.lineWidth = 3; const ar = ang(o.red); g.beginPath(); g.moveTo(cx + (R - 6) * Math.cos(ar), cy + (R - 6) * Math.sin(ar)); g.lineTo(cx + (R + 5) * Math.cos(ar), cy + (R + 5) * Math.sin(ar)); g.stroke();
  if (o.ref != null) { const ac = ang(o.ref); g.strokeStyle = '#d882e6'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + (R + 2) * Math.cos(ac), cy + (R + 2) * Math.sin(ac)); g.lineTo(cx + (R + 9) * Math.cos(ac), cy + (R + 9) * Math.sin(ac)); g.stroke(); }
  const an = ang(v); g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (R - 2) * Math.cos(an), cy + (R - 2) * Math.sin(an)); g.stroke();
  const col = v >= o.red ? '#f25a4f' : v >= o.amber ? '#f3b43f' : '#e2e8ee';
  g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(70.5, 4.5, 54, 21);
  g.fillStyle = col; g.font = '15px "B612 Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(o.fmt(v), 121, 15.5);
}
function stationDefs() {
  const sp = CUR.spec;
  return sp.stations.map(st => ({ ...st }));
}
function cfdStation(st) {
  const si = CUR.spec.order.indexOf(st.stream);
  const x = st.id === '9' || st.id === '19' ? st.x - 0.012 * CUR.spec.s : st.x;
  return cfdSection(CFD.grid, CFD.zones, CFD.Q, x, si, CFD.mfx);
}
function updatePanels(force) {
  const now = performance.now();
  if (!force && now - CFD.panelT < 650) return;
  CFD.panelT = now;
  if (!CFD.G || !CFD.forces) { updateSolverBar(); return; }
  const { sol } = CUR, op = sol.op, ref = sol.ref, T = ENGINE_TYPES[S.type];
  const f = CFD.forces;
  // 站位
  const st = {}; for (const s of stationDefs()) st[s.id] = cfdStation(s);
  const s2 = st['2'], s3 = st['3'], s4 = st['4'], s5 = st['5'], s9 = st['9'];
  const mIn = s2 ? s2.mdot : NaN;
  const mByp = st['13'] ? st['13'].mdot : 0, mCore = S.type === 'tj' ? mIn : (st['25'] || st['21'] || { mdot: NaN }).mdot;
  // 表盤（轉速 = 循環轉速 × CFD 轉速比）
  const dials = $('#dials');
  const want = S.type === 'tj' ? ['N', 'EGT'] : ['N1', 'N2', 'EGT'];
  if (dials.dataset.k !== want.join()) { dials.innerHTML = ''; dials.dataset.k = want.join(); for (const k of want) dials.append(el('div', { class: 'dial' }, el('canvas', { 'data-d': k }), el('span', null, k === 'EGT' ? 'EGT（Tt5）°C' : k + ' %'))); }
  const cv = k => dials.querySelector(`canvas[data-d="${k}"]`);
  const sp = SPOOLS[S.type];
  const dialN = (k, key) => drawDial(cv(k), op.N[key] * 100, { min: 0, max: 110, amber: 100.5, red: 105, fmt: v => v.toFixed(1), ref: op.N[key] * 100 });
  if (S.type === 'tj') dialN('N', 'HP'); else { dialN('N1', 'LP'); dialN('N2', 'HP'); }
  const egtRef = ref.Tt5 - 273.15;
  drawDial(cv('EGT'), (s5 ? s5.Tt : op.Tt5) - 273.15, { min: 0, max: Math.ceil((egtRef + 160) / 100) * 100, amber: egtRef + 20, red: egtRef + 60, fmt: v => v.toFixed(0), ref: op.Tt5 - 273.15 });
  const tsfc = f.mfuel / Math.max(f.F, 1e-6);
  const tiles = [
    { k: '淨推力 F（CFD）', v: `${fmtN(f.F / 1000, 1)}<small>kN</small>`, x: `一維 ${fmtN(op.F / 1000, 1)} kN`, cls: 'hero' },
    { k: '空氣流量 ṁ₀', v: `${fmtN(mIn, 1)}<small>kg/s</small>`, x: `一維 ${fmtN(op.mdot, 1)} kg/s` },
    S.type !== 'tj' ? { k: '涵道比 α', v: (mByp / Math.max(1e-6, mIn - mByp)).toFixed(2), x: `一維 ${op.bpr.toFixed(2)}` } : { k: '壓氣機出口 Tt3', v: `${fmtN(s3 && s3.Tt)}<small>K</small>`, x: `一維 ${fmtN(op.Tt3)} K` },
    { k: '總壓比', v: s3 && s2 ? (s3.Pt / s2.Pt).toFixed(1) : '—', x: `一維 ${op.opr.toFixed(1)}` },
    { k: '燃油流量', v: `${fmtN(f.mfuel * 3600)}<small>kg/h</small>`, x: `一維 ${fmtN(op.mfuel * 3600)} kg/h` },
    { k: '推力比油耗 TSFC', v: f.F > 0 ? `${fmtN(tsfc * 1e6, 2)}<small>g/(kN·s)</small>` : '—', x: `一維 ${fmtN(op.tsfc * 1e6, 2)}` },
    { k: '渦輪入口 Tt4', v: `${fmtN(s4 && s4.Tt)}<small>K</small>`, x: `目標 ${fmtN(op.Tt4)} K` },
    { k: '渦輪出口 Tt5', v: `${fmtN(s5 && s5.Tt)}<small>K</small>`, x: `一維 ${fmtN(op.Tt5)} K` },
    { k: '噴嘴出口 M₉', v: s9 ? s9.M.toFixed(2) : '—', x: `一維 ${op.noz.M.toFixed(2)}` },
    { k: '轉軸功率比 渦輪·ηm / 壓縮', v: CFD.ratios.length ? CFD.ratios.map(r => isFinite(r) ? r.toFixed(2) : '—').join(' · ') : '—', x: `${S.type === 'tj' ? '單軸' : '低壓軸 · 高壓軸'}；1.00 = 平衡` },
    { k: '迭代次數', v: fmtN(CFD.itTotal), x: `殘差 ${fmtE(CFD.res)}` },
    { k: '求解速度', v: `${fmtN(CFD.ips)}<small>it/s</small>`, x: `${CFD.kind === 'gpu' ? 'GPU' : 'CPU'} · ${fmtN(CFD.grid.N)} 格` },
  ];
  $('#nums').innerHTML = tiles.map(t => `<div class="nm ${t.cls || ''}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="x">${t.x}</div></div>`).join('');
  const warns = [...op.warn];
  if (CFD.error) warns.push(CFD.error);
  if (CFD.gpuError) warns.push('GPU 求解器無法使用：' + CFD.gpuError + '。改用 CPU 極粗網格求解');
  $('#warnbar').innerHTML = warns.map(w => `<div>⚠ ${w}</div>`).join('');
  const chips = [];
  if (op.abOn) chips.push(['warn', '後燃器點燃']);
  if (s9 && s9.M > 0.98) chips.push(['info', '噴嘴壅塞']);
  chips.push(CFD.conv ? (CFD.capped ? ['warn', '達迭代上限'] : ['ok', '已收斂']) : [S.running ? 'info' : 'warn', S.running ? '求解中' : '已暫停']);
  $('#chips').innerHTML = chips.map(([c, t]) => `<span class="chip ${c}"><i></i>${t}</span>`).join('');
  stationTable(st);
  drawAxial(); drawConv(); drawRadial(); renderPins(); updateSolverBar();
}
function updateSolverBar() {
  const b = $('#solverbar'); if (!b) return;
  if (!b.firstChild) {
    b.innerHTML = '<span class="st"><i></i><b></b></span><span data-k="grid"></span><span data-k="it"></span><span data-k="res"></span><span data-k="ips"></span><button type="button" id="sbRun"></button>';
    $('#sbRun').onclick = toggleRun;
  }
  const state = CFD.conv ? (CFD.capped ? ['pause', '達迭代上限'] : ['ok', '已收斂']) : S.running ? ['run', '求解中'] : ['pause', '已暫停'];
  const lvl = CFD.grid ? (GRID_LEVELS[CFD.grid.level] || {}).label : '';
  const st = b.querySelector('.st'); st.className = 'st ' + state[0]; st.querySelector('b').textContent = state[1];
  const set = (k, t) => { const e = b.querySelector(`[data-k="${k}"]`); if (e.textContent !== t) e.textContent = t; };
  set('grid', `${lvl}網格 ${CFD.grid ? fmtN(CFD.grid.N) : ''} 格${CFD.seqTarget ? '（預收斂）' : ''}`);
  set('it', `迭代 ${fmtN(CFD.itTotal)}`); set('res', `殘差 ${fmtE(CFD.res)}`); set('ips', `${fmtN(CFD.ips)} it/s`);
  const bt = $('#sbRun'), lab = S.running ? '暫停' : CFD.conv ? '繼續迭代' : '繼續'; if (bt.textContent !== lab) bt.textContent = lab;
}
function stationTable(st) {
  const op = CUR.sol.op, t = $('#stTable');
  const name = id => ({ '2': S.type === 'tj' ? '壓氣機進口' : '風扇進口', '13': '風扇外涵出口', '21': '增壓級進口', '25': '高壓壓氣機進口', '3': '壓氣機出口', '4': '渦輪進口', '45': '高壓渦輪出口', '5': '渦輪出口', '6': '後燃器進口', '6A': '混合器出口', '16': '外涵混合器進口', '7': '後燃器出口', '8': '噴嘴喉部', '9': '噴嘴出口', '19': '外涵噴嘴出口' }[id] || '');
  const rows = stationDefs().map(s => { const c = st[s.id], d = op.S[s.id] || {}; return { id: s.id, n: name(s.id), c, d }; });
  t.innerHTML = `<thead><tr><th>站位</th><th>位置</th><th>Tt CFD (K)</th><th>Tt 一維</th><th>Pt CFD (kPa)</th><th>Pt 一維</th><th>M CFD</th><th>ṁ CFD (kg/s)</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td><span class="id">${r.id}</span></td><td>${r.n}</td><td class="n">${fmtN(r.c && r.c.Tt)}</td><td class="n" style="color:var(--ink-3)">${fmtN(r.d.Tt)}</td><td class="n">${fmtN(r.c && r.c.Pt / 1000, 1)}</td><td class="n" style="color:var(--ink-3)">${fmtN(r.d.Pt / 1000, 1)}</td><td class="n">${r.c ? r.c.M.toFixed(2) : '—'}</td><td class="n">${fmtN(r.c && r.c.mdot, 1)}</td></tr>`).join('') + '</tbody>';
}

/* ---------- 圖表 ---------- */
function setupCanvas(box, hCss) {
  const cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = box.clientWidth || 400, H = hCss;
  cv.style.height = H + 'px';
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
const INK2 = '#a8b4c0', INK3 = '#6f8091', GRIDC = '#1f2c39';
const axisFont = g => { g.font = '11px "B612 Mono", ui-monospace, monospace'; };
function chartH() { return window.innerWidth < 760 ? 220 : window.innerWidth < 1180 ? 260 : 318; }
function axialVar() { const f = S.field; return ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho'].includes(f) ? f : 'Tt'; }
function corePathStream(x) {
  const sp = CUR.spec;
  for (const key of ['inlet', 'core', 'ab']) { const st = sp.streams[key]; if (st && x >= st.x0 && x <= st.x1) return sp.order.indexOf(key); }
  return null;
}
function cfdAxial() {
  const sp = CUR.spec, g = CFD.grid, L = sp.view.len, xe = sp.exitsGeom[sp.exitsGeom.length - 1].x;
  const x0 = sp.lip.x - 0.25 * L, x1 = xe + 0.75 * L, n = 170;
  const core = [], byp = [];
  const bi = sp.order.indexOf('bypass');
  for (let q = 0; q <= n; q++) {
    const x = lerp(x0, x1, q / n), si = corePathStream(x);
    let r;
    if (si !== null) r = cfdSection(g, CFD.zones, CFD.Q, x, si, CFD.mfx);
    else { const i = colAt(g, x); let k = i; for (let j = 0; j < g.H; j++) { if (!CFD.zones.solid[j * g.W + i]) { k = j * g.W + i; break; } } r = cellVals(k); }
    if (r && r.Tt > 0) core.push({ x, ...r });
    if (bi >= 0) { const st = sp.streams.bypass; if (x >= st.x0 + 0.01 && x <= st.x1 - 0.005) { const b = cfdSection(g, CFD.zones, CFD.Q, x, bi, CFD.mfx); if (b.Tt > 0) byp.push({ x, ...b }); } }
  }
  return { core, byp };
}
function cellVals(k) {
  const q = cfdPrim(CFD.Q, k), cp = q.g * RGAS / (q.g - 1), T = q.p / (q.r * RGAS), V = Math.hypot(q.u, q.v), Tt = T + V * V / (2 * cp);
  return { T, Tt, P: q.p, Pt: q.p * Math.pow(Tt / T, q.g / (q.g - 1)), V, M: V / Math.sqrt(q.g * q.p / q.r), rho: q.r };
}
function oneDAxial() {
  const m = CUR.model, core = [];
  for (const k of ['inlet', 'core', 'ab']) if (m.kn[k]) core.push(...axialSeries(m, k));
  return { core, byp: m.kn.bypass ? axialSeries(m, 'bypass') : null };
}
function drawAxial() {
  const box = $('#axChart'); if (!CFD.G) return;
  const H = chartH(); const { g, W } = setupCanvas(box, H);
  const key = axialVar(), f = FIELDS[key], sp = CUR.spec;
  const C = cfdAxial(), D = oneDAxial();
  const sc = f.sc, lg = f.log;
  const vOf = (p) => key === 'rho' ? (p.rho != null ? p.rho : (p.P / (RGAS * p.T))) : p[key];
  const series = [
    { n: 'CFD 核心', c: '#3987e5', pts: C.core.map(p => [p.x, vOf(p) * sc]) },
    { n: '一維 核心', c: '#3987e5', d: true, pts: D.core.map(p => [p.x, vOf(p) * sc]) },
  ];
  if (C.byp.length) series.push({ n: 'CFD 外涵', c: '#199e70', pts: C.byp.map(p => [p.x, vOf(p) * sc]) });
  if (D.byp) series.push({ n: '一維 外涵', c: '#199e70', d: true, pts: D.byp.map(p => [p.x, vOf(p) * sc]) });
  const pl = 64, pr = 12, pt = 26, pb = 30;
  const x0 = C.core.length ? C.core[0].x : 0, x1 = C.core.length ? C.core[C.core.length - 1].x : 1;
  for (const s of series) s.pts = s.pts.filter(p => p[0] >= x0 && p[0] <= x1 && isFinite(p[1]) && (!lg || p[1] > 0));
  let ymin = Infinity, ymax = -Infinity;
  for (const s of series) for (const p of s.pts) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  if (!isFinite(ymin)) return;
  if (key === 'M') { ymin = 0; ymax = Math.max(ymax, 1.2); }
  if (lg) { ymin /= 1.2; ymax *= 1.2; } else { const pad = (ymax - ymin) * 0.06; ymin = Math.max(0, ymin - pad); ymax += pad; }
  const X = x => pl + (x - x0) / (x1 - x0) * (W - pl - pr);
  const Y = lg ? v => pt + (1 - (Math.log(v) - Math.log(ymin)) / (Math.log(ymax) - Math.log(ymin))) * (H - pt - pb) : v => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb);
  g.font = '10.5px "Noto Sans TC", "PingFang TC", sans-serif'; g.textAlign = 'center';
  let alt = 0;
  for (const ck of sp.chartComps) {
    const c = sp.comps.find(q => q.key === ck); if (!c) continue;
    const a = X(c.x0), b = X(c.x1);
    g.fillStyle = (alt++ % 2) ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)'; g.fillRect(a, pt, b - a, H - pt - pb);
    const t = c.name.replace(/（.*）/, ''), t2 = b - a > g.measureText(t).width + 4 ? t : (c.short || t.slice(0, 2));
    if (b - a > g.measureText(t2).width) { g.fillStyle = INK3; g.fillText(t2, (a + b) / 2, pt - 8); }
  }
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of (lg ? logTicks(ymin, ymax) : niceTicks(ymin, ymax, 5))) { const y = Y(v); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = INK3; g.fillText(fmtN(v, v < 1 ? 2 : v < 10 && lg ? 1 : 0), pl - 6, y); }
  g.save(); g.translate(9, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = INK3; g.fillText(`${f.sym} ${f.unit}${lg ? '（對數）' : ''}`, 0, 0); g.restore();
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const v of niceTicks(x0, x1, 8)) { const x = X(v); if (x > W - pr - 44) continue; g.fillStyle = INK3; g.fillText(v.toFixed(v % 1 ? 1 : 0), x, H - pb + 16); }
  g.textAlign = 'right'; g.fillText('x (m)', W - pr, H - pb + 16);
  g.textAlign = 'center'; let lastSx = -1e9;
  for (const s of sp.stations) { if (s.stream === 'bypass') continue; const x = X(s.x); const tw = g.measureText(s.id).width; if (x - tw / 2 < lastSx + 3) continue; g.fillStyle = '#45cfe0'; g.fillText(s.id, x, H - pb + 4); lastSx = x + tw / 2; }
  if (key === 'M') { const y = Y(1); g.setLineDash([4, 4]); g.strokeStyle = INK2; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.setLineDash([]); }
  const xs = rpX(); if (xs >= x0 && xs <= x1) { const x = X(xs); g.strokeStyle = 'rgba(69,207,224,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); }
  g.lineJoin = 'round';
  for (const s of series) { g.strokeStyle = s.c; g.lineWidth = s.d ? 1.6 : 2; g.setLineDash(s.d ? [5, 4] : []); g.beginPath(); s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(clamp(p[1], ymin, ymax)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); }
  g.setLineDash([]);
  CFD.ax = { X, Y, x0, x1, pl, pr, pt, pb, W, H, series, f };
  $('#axKeys').innerHTML = series.map(s => `<span><i class="${s.d ? 'd' : ''}" style="border-color:${s.c}"></i>${s.n}</span>`).join('');
  $('#axSub').textContent = `${f.name}${key !== S.field ? '（所選場變數無一維對應，改顯示總溫）' : ''}`;
}
function interpSeries(pts, x) {
  if (!pts.length || x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { const a = pts[i - 1], b = pts[i]; const t = b[0] - a[0] < 1e-9 ? 1 : (x - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], t); }
  return null;
}
function axHover(e) {
  const A = CFD.ax; if (!A) return;
  const box = $('#axChart'), rc = box.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top, tip = box.querySelector('.tip');
  if (mx < A.pl || mx > A.W - A.pr) { tip.hidden = true; return; }
  const x = A.x0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.x1 - A.x0);
  let html = `<b>x = ${x.toFixed(2)} m</b>`;
  for (const s of A.series) { const v = interpSeries(s.pts, x); if (v != null) html += `<div class="r"><span style="color:${s.c}">${s.n}</span><span>${fmtN(v, v < 10 ? 2 : v < 100 ? 1 : 0)} ${A.f.unit}</span></div>`; }
  tip.innerHTML = html; tip.hidden = false;
  const tw = tip.offsetWidth; tip.style.left = (mx + 14 + tw > rc.width ? mx - tw - 10 : mx + 14) + 'px'; tip.style.top = Math.max(0, my - 10) + 'px';
}
function drawConv() {
  const h = CFD.hist;
  const b1 = $('#cvChart'), b2 = $('#cfChart');
  const H1 = window.innerWidth < 760 ? 110 : 150;
  const { g, W } = setupCanvas(b1, H1);
  const pl = 58, pr = 10, pt = 10, pb = 22;
  const pts = h.filter(p => p.res > 0 && isFinite(p.res));
  axisFont(g);
  if (pts.length < 2) { g.fillStyle = INK3; g.fillText('等待資料…', pl, 30); } else {
    const x0 = pts[0].it, x1 = Math.max(pts[pts.length - 1].it, x0 + 1);
    let ymin = Math.min(...pts.map(p => p.res)), ymax = Math.max(...pts.map(p => p.res));
    ymin = Math.pow(10, Math.floor(Math.log10(ymin))); ymax = Math.pow(10, Math.ceil(Math.log10(ymax)));
    if (ymax / ymin < 100) ymin = ymax / 100;
    const X = v => pl + (v - x0) / (x1 - x0) * (W - pl - pr), Y = v => pt + (1 - (Math.log10(v) - Math.log10(ymin)) / (Math.log10(ymax) - Math.log10(ymin))) * (H1 - pt - pb);
    g.textAlign = 'right'; g.textBaseline = 'middle';
    for (let e = Math.log10(ymin); e <= Math.log10(ymax) + 1e-9; e++) { const y = Y(Math.pow(10, e)); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillStyle = INK3; g.fillText('10' + String(e).replace(/[-0-9]/g, SUP), pl - 6, y); }
    g.textAlign = 'center'; g.textBaseline = 'top';
    for (const v of niceTicks(x0, x1, 5)) g.fillText(fmtN(v), X(v), H1 - pb + 5);
    g.strokeStyle = '#3987e5'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => i ? g.lineTo(X(p.it), Y(p.res)) : g.moveTo(X(p.it), Y(p.res))); g.stroke();
  }
  const H2 = window.innerWidth < 760 ? 110 : 150;
  const c2 = setupCanvas(b2, H2), g2 = c2.g, W2 = c2.W;
  axisFont(g2);
  const fp = h.filter(p => isFinite(p.F));
  const F1 = CUR.sol.op.F / 1000;
  if (fp.length >= 2) {
    const x0 = fp[0].it, x1 = Math.max(fp[fp.length - 1].it, x0 + 1);
    const vals = fp.map(p => p.F / 1000).concat([F1]);
    let ymin = Math.min(...vals), ymax = Math.max(...vals); const pad = Math.max(1, (ymax - ymin) * 0.1); ymin -= pad; ymax += pad;
    const X = v => pl + (v - x0) / (x1 - x0) * (W2 - pl - pr), Y = v => pt + (1 - (v - ymin) / (ymax - ymin)) * (H2 - pt - pb);
    g2.textAlign = 'right'; g2.textBaseline = 'middle';
    for (const v of niceTicks(ymin, ymax, 4)) { const y = Y(v); g2.strokeStyle = GRIDC; g2.beginPath(); g2.moveTo(pl, y); g2.lineTo(W2 - pr, y); g2.stroke(); g2.fillStyle = INK3; g2.fillText(fmtN(v), pl - 6, y); }
    g2.textAlign = 'center'; g2.textBaseline = 'top';
    for (const v of niceTicks(x0, x1, 5)) g2.fillText(fmtN(v), X(v), H2 - pb + 5);
    g2.setLineDash([5, 4]); g2.strokeStyle = '#d95926'; g2.lineWidth = 1.5; g2.beginPath(); g2.moveTo(pl, Y(F1)); g2.lineTo(W2 - pr, Y(F1)); g2.stroke(); g2.setLineDash([]);
    g2.strokeStyle = '#3987e5'; g2.lineWidth = 2; g2.beginPath(); fp.forEach((p, i) => i ? g2.lineTo(X(p.it), Y(p.F / 1000)) : g2.moveTo(X(p.it), Y(p.F / 1000))); g2.stroke();
    g2.save(); g2.translate(9, (pt + H2 - pb) / 2); g2.rotate(-Math.PI / 2); g2.textAlign = 'center'; g2.textBaseline = 'middle'; g2.fillText('F (kN)', 0, 0); g2.restore();
  }
  g.save(); g.translate(9, (pt + H1 - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK3; g.fillText('殘差', 0, 0); g.restore();
  $('#cvKeys').innerHTML = `<span><i style="border-color:#3987e5"></i>CFD</span><span><i class="d" style="border-color:#d95926"></i>一維推力</span>`;
}
function rpRange() { const sp = CUR.spec, L = sp.view.len; return [sp.lip.x - 0.2 * L, sp.exitsGeom[sp.exitsGeom.length - 1].x + 1.0 * L]; }
function defaultRpX(sp) { const L = sp.view.len, a = sp.lip.x - 0.2 * L, b = sp.exitsGeom[sp.exitsGeom.length - 1].x + 1.0 * L, c = sp.comb; return (lerp(c.xd, c.x1, 0.5) - a) / (b - a); }
function rpX() { const [a, b] = rpRange(); return lerp(a, b, S.rpXf); }
function drawRadial() {
  const box = $('#rpChart'); if (!CFD.G) return;
  const H = chartH() - 40; const { g, W } = setupCanvas(box, H);
  const G = CFD.G, grid = CFD.grid, key = S.field, f = FIELDS[key], x = rpX();
  const i = colAt(grid, x), Rmax = Math.min(grid.rf[grid.H], 1.25 * CUR.spec.view.Rmax);
  const pl = 52, pr = 12, pt = 10, pb = 30;
  const pts = []; let vmin = Infinity, vmax = -Infinity;
  const solids = [];
  for (let j = 0; j < grid.H && grid.rc[j] <= Rmax; j++) {
    const k = j * G.W + i;
    if (G.reg[k] === 1) { solids.push([grid.rf[j], grid.rf[j + 1]]); pts.push(null); continue; }
    const v = G[key][k] * f.sc; pts.push([grid.rc[j], v]); if (isFinite(v)) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
  }
  if (!isFinite(vmin)) return;
  if (f.log) { vmin /= 1.1; vmax *= 1.1; } else { const pad = Math.max(1e-6, (vmax - vmin) * 0.08); vmin -= pad; vmax += pad; }
  const X = f.log ? v => pl + (Math.log(v) - Math.log(vmin)) / (Math.log(vmax) - Math.log(vmin)) * (W - pl - pr) : v => pl + (v - vmin) / (vmax - vmin) * (W - pl - pr);
  const Y = r => pt + (1 - r / Rmax) * (H - pt - pb);
  g.fillStyle = 'rgba(160,170,185,0.16)';
  for (const [a, b] of solids) { g.fillRect(pl, Y(b), W - pl - pr, Y(a) - Y(b)); }
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const r of niceTicks(0, Rmax, 5)) { const y = Y(r); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillStyle = INK3; g.fillText(r.toFixed(2), pl - 6, y); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const v of (f.log ? logTicks(vmin, vmax) : niceTicks(vmin, vmax, 4))) g.fillText(fmtN(v, Math.abs(v) < 10 ? 2 : 0), X(v), H - pb + 5);
  g.save(); g.translate(10, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('r (m)', 0, 0); g.restore();
  g.strokeStyle = '#3987e5'; g.lineWidth = 2; g.beginPath();
  let pen = false;
  for (const p of pts) { if (!p || !isFinite(p[1])) { pen = false; continue; } const xx = X(clamp(p[1], vmin, vmax)), yy = Y(p[0]); if (pen) g.lineTo(xx, yy); else { g.moveTo(xx, yy); pen = true; } }
  g.stroke();
  CFD.rp = { X, Y, pts, Rmax, pl, pr, pt, pb, W, H, f, key };
  $('#rpXo').textContent = x.toFixed(2) + ' m';
  const cmp = CUR.model.compName(x, 'core') || CUR.model.compName(x, 'inlet') || CUR.model.compName(x, 'ab');
  $('#rpSub').textContent = `${f.name} · ${x > CUR.spec.exitsGeom[0].x ? '噴流區' : cmp ? cmp.name : ''}`;
  $('#rpX').value = Math.round(S.rpXf * 1000);
  const sp = CUR.spec, rr = Math.max(sp.outer.at(Math.min(x, sp.outerEnd)), 0.05) + 0.02 * sp.s;
  R3.ring.scale.setScalar(x > sp.outerEnd + 0.05 ? sp.exitsGeom[0].R * 1.3 : rr); R3.ring.position.set(x, 0, 0);
}
function rpHover(e) {
  const A = CFD.rp; if (!A) return;
  const box = $('#rpChart'), rc = box.getBoundingClientRect(), my = e.clientY - rc.top, tip = box.querySelector('.tip');
  const r = (1 - (my - A.pt) / (A.H - A.pt - A.pb)) * A.Rmax;
  let best = null, bd = Infinity; for (const p of A.pts) if (p && Math.abs(p[0] - r) < bd) { bd = Math.abs(p[0] - r); best = p; }
  if (!best) { tip.hidden = true; return; }
  tip.innerHTML = `<b>r = ${best[0].toFixed(3)} m</b><div class="r"><span>${A.f.name}</span><span>${fmtN(best[1], Math.abs(best[1]) < 10 ? 3 : 1)} ${A.f.unit}</span></div>`;
  tip.hidden = false; tip.style.left = (A.X(best[1]) + 10 > rc.width - 120 ? A.X(best[1]) - 130 : A.X(best[1]) + 10) + 'px'; tip.style.top = Math.max(0, my - 12) + 'px';
}

/* ---------- 3D 互動 ---------- */
const ndc = new THREE.Vector2();
let hoverRAF = 0, lastPE = null, downXY = null;
function pick(e) {
  const c = R3.renderer.domElement, rc = c.getBoundingClientRect();
  ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  R3.raycaster.setFromCamera(ndc, R3.camera);
  const hits = R3.raycaster.intersectObjects([R3.sliceA, R3.sliceB].filter(o => o.visible), false);
  for (const h of hits) {
    const p = h.point, r = Math.hypot(p.y, p.z);
    const th = h.object === R3.sliceA ? S.phi * DEG : (S.phi + S.wedge) * DEG;
    const o = cfdSample(p.x, r);
    if (h.object === R3.sliceB && Math.abs(S.wedge - 180) > 1 && o && !o.solid && o.reg === 0) continue;
    return { x: p.x, r, th, point: p };
  }
  return null;
}
function onVpMove(e) {
  lastPE = e; if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0; if (!CFD.G || !lastPE) return;
    const h = pick(lastPE);
    if (h) { CUR.hovering = true; showProbe(h, 0, true); R3.marker.visible = true; R3.marker.position.copy(h.point); R3.marker.scale.setScalar(0.012 * CUR.spec.s); R3.renderer.domElement.style.cursor = 'crosshair'; }
    else leaveVp();
  });
}
function leaveVp() { CUR.hovering = false; R3.marker.visible = false; R3.renderer.domElement.style.cursor = ''; showProbe(S.pins && S.pins.length ? S.pins[S.pins.length - 1] : null, S.pins ? S.pins.length : 0); }

/* ---------- 主迴圈 ---------- */
const V3 = new THREE.Vector3();
let lastT = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, R3.clock.getDelta());
  R3.controls.update();
  const now = performance.now();
  if (CFD.solver && S.running && !document.hidden) {
    const fdt = lastT ? now - lastT : 16;
    if (CFD.kind === 'gpu') { if (fdt < 22) CFD.k = Math.min(400, CFD.k * 1.1 + 1); else if (fdt > 40) CFD.k = Math.max(1, Math.floor(CFD.k * 0.75)); }
    const k = Math.max(1, Math.floor(CFD.k));
    CFD.solver.step(k);
    CFD.ipsN += k;
    if (now - CFD.readT > (CFD.kind === 'gpu' ? 280 : 900)) cfdRead();
  }
  lastT = now;
  if (now - CFD.ipsT > 1000) { CFD.ips = CFD.ipsN * 1000 / Math.max(1, now - CFD.ipsT); CFD.ipsN = 0; CFD.ipsT = now; updateSolverBar(); }
  updatePanels(false);
  if (CUR.sol) {
    if (S.anim > 0 && !reduceMotion) {
      const N = CUR.sol.op.N, sp = SPOOLS[S.type];
      R3.spools.LP.rotation.x += (N.LP || 0) * 2.4 * S.anim * dt;
      R3.spools.HP.rotation.x += (N.HP || 0) * 4.2 * S.anim * dt;
      if (S.particles > 0) stepParticles(dt, false);
    } else if (S.particles > 0) stepParticles(0, false);
    R3.statics.visible = R3.spools.LP.visible = R3.spools.HP.visible = S.blades;
    R3.pts.visible = S.particles > 0;
  }
  const rect = R3.host.getBoundingClientRect(), placed = [];
  // 標籤避開覆蓋面板（探針、工具列、求解器列、圖例、狀態）
  for (const id of ['probe', 'tools', 'solverbar', 'legend', 'chips']) {
    const e = document.getElementById(id); if (!e || !e.offsetParent) continue;
    const b = e.getBoundingClientRect(); if (b.width && b.height) placed.push([b.left - rect.left, b.top - rect.top, b.right - rect.left, b.bottom - rect.top]);
  }
  const proj = (arr, show, pin) => {
    for (const L of arr || []) {
      if (!show) { L.e.hidden = true; continue; }
      V3.copy(L.p).project(R3.camera);
      let vis = V3.z < 1 && Math.abs(V3.x) < 1.05 && Math.abs(V3.y) < 1.05;
      const px = (V3.x + 1) / 2 * rect.width, py = (1 - V3.y) / 2 * rect.height;
      if (vis && !pin) {
        if (!L.w) { L.e.hidden = false; L.w = L.e.offsetWidth || 60; L.h = L.e.offsetHeight || 16; }
        const bx = [px - L.w / 2 - 2, py - L.h - 2, px + L.w / 2 + 2, py + 2];
        if (placed.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) vis = false; else placed.push(bx);
      }
      L.e.hidden = !vis;
      if (vis) { L.e.style.left = px + 'px'; L.e.style.top = py + 'px'; }
    }
  };
  proj(CUR.labels, S.labels); proj(CUR.pinLabels, true, true);
  if (!R3.paused) R3.renderer.render(R3.scene, R3.camera);
}
function onResize() {
  const r = R3.host.getBoundingClientRect();
  R3.renderer.setSize(r.width, r.height, false);
  R3.camera.aspect = r.width / Math.max(1, r.height); R3.camera.updateProjectionMatrix();
  R3.pts.material.uniforms.uScale.value = r.height * R3.renderer.getPixelRatio() / (2 * Math.tan(R3.camera.fov * DEG / 2));
  if (CFD.G) { drawLegend(); updatePanels(true); }
}

/* ---------- 啟動 ---------- */
function markSeg() {
  for (const b of $('#typeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.t === S.type ? 'true' : 'false');
  for (const b of $('#fieldSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.f === S.field ? 'true' : 'false');
}
function switchType(t, first) {
  if (!first) resetType(t);
  markSeg();
  solveCycle();
  CUR.specKey = S.type + '|' + Math.sqrt(S.design.mdot / ENGINE_TYPES[S.type].design.mdot).toFixed(4);
  setupCFD(true);
  buildRack();
  setWedge(S.phi * DEG, S.wedge * DEG);
  onResize();
  setView('iso', !!first);
  updatePanels(true);
}
function boot() {
  const ts = $('#typeSeg');
  for (const k of ['hbtf', 'tj', 'lbtf']) ts.append(el('button', { 'data-t': k, onclick: () => switchType(k) }, ENGINE_TYPES[k].label));
  const fs = $('#fieldSeg');
  for (const k of FIELD_ORDER) fs.append(el('button', { 'data-f': k, title: FIELDS[k].name, onclick: () => { S.field = k; markSeg(); request('paint', true); updatePanels(true); } }, FIELDS[k].name));
  initScene($('#vp'));
  R3.disk.visible = false;
  for (const b of $('#tools').querySelectorAll('button')) b.addEventListener('click', () => setView(b.dataset.view));
  const cvs = R3.renderer.domElement;
  cvs.addEventListener('pointermove', onVpMove);
  cvs.addEventListener('pointerleave', () => { lastPE = null; leaveVp(); });
  cvs.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  cvs.addEventListener('pointerup', e => { if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4) return; const h = pick(e); if (h) addPin(h.x, h.r, h.th); });
  $('#probe').addEventListener('click', e => { if (e.target.closest('.pc')) { S.probeMin = !S.probeMin; if (CUR.lastProbe) showProbe(...CUR.lastProbe); } });
  const ax = $('#axChart');
  ax.addEventListener('pointermove', axHover);
  ax.addEventListener('pointerleave', () => { ax.querySelector('.tip').hidden = true; });
  ax.addEventListener('click', e => {
    const A = CFD.ax, rc = ax.getBoundingClientRect(), mx = e.clientX - rc.left; if (!A || mx < A.pl || mx > A.W - A.pr) return;
    const x = A.x0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.x1 - A.x0); const [a, b] = rpRange(); S.rpXf = clamp((x - a) / (b - a), 0, 1); drawRadial(); drawAxial();
  });
  const rp = $('#rpChart'); rp.addEventListener('pointermove', rpHover); rp.addEventListener('pointerleave', () => { rp.querySelector('.tip').hidden = true; });
  const rx = $('#rpX'); rx.addEventListener('input', () => { S.rpXf = rx.value / 1000; drawRadial(); drawAxial(); });
  new ResizeObserver(onResize).observe($('#vp'));
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(onResize, 120); });
  resetType('tj');
  switchType('tj', true);
  requestAnimationFrame(frame);
}
