/* ============================================================
 *  app_main.js — 狀態、控制架、計算管線、圖表、互動
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
const fmtV = (key, v) => { const f = FIELDS[key]; return fmtN(v * f.sc, key === 'P' || key === 'Pt' ? (v * f.sc < 100 ? 2 : 1) : f.dec); };
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 預設狀態 ---------- */
const PRESETS = {
  hbtf: [
    { k: 'sls', name: '地面靜止', alt: 0, M0: 0, thr: 1 },
    { k: 'to', name: '起飛滾行', alt: 0, M0: 0.25, thr: 1 },
    { k: 'clb', name: '爬升', alt: 5000, M0: 0.6, thr: 0.95 },
    { k: 'crz', name: '巡航', alt: 10668, M0: 0.78, thr: 0.88 },
    { k: 'dsc', name: '下降（低推力）', alt: 7000, M0: 0.72, thr: 0.58 },
  ],
  tj: [
    { k: 'max', name: '地面最大（後燃）', alt: 0, M0: 0, thr: 1, ab: true },
    { k: 'mil', name: '地面軍用推力', alt: 0, M0: 0, thr: 1, ab: false },
    { k: 'crz', name: '亞音速巡航', alt: 9000, M0: 0.85, thr: 0.85, ab: false },
    { k: 'dash', name: '超音速衝刺', alt: 11000, M0: 2.0, thr: 1, ab: true },
  ],
  lbtf: [
    { k: 'max', name: '地面最大（後燃）', alt: 0, M0: 0, thr: 1, ab: true },
    { k: 'mil', name: '地面軍用推力', alt: 0, M0: 0, thr: 1, ab: false },
    { k: 'crz', name: '亞音速巡航', alt: 9000, M0: 0.85, thr: 0.84, ab: false },
    { k: 'dash', name: '超音速衝刺', alt: 11000, M0: 1.6, thr: 1, ab: true },
  ],
};
const DEFAULT_PRESET = { hbtf: 'to', tj: 'mil', lbtf: 'max' };
const DESIGN_RANGES = {
  hbtf: { mdot: [150, 700, 5], opr: [15, 55, 0.5], fpr: [1.3, 2.0, 0.01], bpr: [3, 12, 0.1], pibst: [1.2, 3.0, 0.05], Tt4max: [1300, 1900, 10] },
  tj: { mdot: [30, 150, 1], opr: [5, 25, 0.1], Tt4max: [1000, 1600, 10] },
  lbtf: { mdot: [50, 200, 1], opr: [15, 40, 0.5], fpr: [2.2, 5.0, 0.05], Tt4max: [1400, 2000, 10] },
};
const S = {
  type: 'hbtf', design: null, eff: Object.assign({}, DEFAULT_EFF),
  alt: 0, M0: 0.25, thr: 1, ab: false, Tt7: 2000, nozzleType: 'conv', preset: 'to',
  field: 'T', phi: 0, wedge: 180, secXf: 0.5, particles: 2600, anim: 1,
  blades: true, contours: true, labels: true, lock: false, disk3d: false, pcolor: 'white',
  pins: [], probeMin: window.innerWidth < 760,
};
function resetType(t) {
  S.type = t;
  const T = ENGINE_TYPES[t];
  S.design = Object.assign({}, T.design);
  S.nozzleType = T.nozzle;
  S.Tt7 = t === 'lbtf' ? 2100 : 2000;
  S.lock = false;
  applyPreset(DEFAULT_PRESET[t], true);
  S.pins = null; // 由預設探針填入
  S.secXf = null;
}
function applyPreset(k, silent) {
  const p = PRESETS[S.type].find(q => q.k === k);
  if (!p) return;
  S.alt = p.alt; S.M0 = p.M0; S.thr = p.thr; if (p.ab !== undefined) S.ab = p.ab; else S.ab = false;
  S.preset = k;
  if (!silent) { refreshControls(); request('solve', true); }
}

/* ---------- 目前計算結果 ---------- */
const CUR = { specKey: null, nozKey: null };

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
    if (o.range) { const [a, b, st] = o.range(); inp.min = a; inp.max = b; inp.step = st; }
    inp.value = o.get(); out.textContent = o.fmt(+inp.value); setP();
    if (sub) sub.textContent = o.sub();
    const dis = o.disabled ? o.disabled() : false; inp.disabled = dis; wrap.classList.toggle('dis', dis);
  };
  inp.addEventListener('input', () => { o.set(+inp.value); out.textContent = o.fmt(+inp.value); setP(); if (o.onInput) o.onInput(); S.preset = o.keepPreset ? S.preset : (o.flight ? null : S.preset); updatePresetButtons(); request(o.level || 'solve', false); });
  inp.addEventListener('change', () => request(o.level || 'solve', true));
  CTRLS.push(c);
  return wrap;
}
function mkSwitch(o) {
  const inp = el('input', { type: 'checkbox', id: o.id });
  const lab = el('label', { class: 'sw' + (o.cls ? ' ' + o.cls : ''), for: o.id }, el('span', { html: o.label }), inp);
  const c = { o, inp, wrap: lab, refresh: () => { inp.checked = !!o.get(); } };
  inp.addEventListener('change', () => { o.set(inp.checked); if (o.after) o.after(); request(o.level || 'solve', true); });
  CTRLS.push(c);
  return lab;
}
function mkSelect(o) {
  const sel = el('select', { id: o.id });
  for (const [v, t] of o.options) sel.append(el('option', { value: v }, t));
  const wrap = el('div', { class: 'ctl' }, el('label', { for: o.id, html: o.label }), sel);
  wrap.style.gridTemplateColumns = '1fr auto';
  const c = { o, inp: sel, wrap, refresh: () => { sel.value = o.get(); } };
  sel.addEventListener('change', () => { o.set(sel.value); request(o.level || 'solve', true); });
  CTRLS.push(c);
  return wrap;
}
function grp(title, en, ...kids) { return el('section', { class: 'grp' }, el('h3', { html: `${title}<small>${en}</small>` }), ...kids); }
function updatePresetButtons() { for (const b of document.querySelectorAll('.presets button')) b.setAttribute('aria-pressed', b.dataset.k === S.preset ? 'true' : 'false'); }

function buildRack() {
  CTRLS.length = 0;
  const rack = $('#rack'); rack.innerHTML = '';
  const T = ENGINE_TYPES[S.type], DR = DESIGN_RANGES[S.type];
  const mil = T.hasAB;
  // 飛行條件
  const pres = el('div', { class: 'presets' });
  for (const p of PRESETS[S.type]) pres.append(el('button', { 'data-k': p.k, onclick: () => applyPreset(p.k) }, p.name));
  const amb = el('div', { class: 'amb', id: 'amb' });
  rack.append(grp('飛行條件', 'FLIGHT',
    pres,
    mkSlider({ id: 'alt', label: '飛行高度', sym: 'h', min: 0, max: T.hmax, step: 50, get: () => S.alt, set: v => S.alt = v, fmt: v => fmtN(v) + ' m', flight: true }),
    mkSlider({ id: 'M0', label: '飛行馬赫數', sym: 'M₀', min: 0, max: T.Mmax, step: 0.01, get: () => S.M0, set: v => S.M0 = v, fmt: v => v.toFixed(2), flight: true,
      sub: () => CUR.sol ? `V₀ = ${fmtN(CUR.sol.fl.V0)} m/s（${fmtN(CUR.sol.fl.V0 * 1.94384)} kt）` : '' }),
    mkSlider({ id: 'thr', label: '油門 Tt4 / Tt4,max', min: 0.5, max: 1, step: 0.005, get: () => S.thr, set: v => S.thr = v, fmt: v => (v * 100).toFixed(1) + ' %', flight: true,
      sub: () => CUR.sol ? `Tt4 指令 ${fmtN(CUR.sol.op.Tt4cmd)} K` + (CUR.sol.op.limited ? ` → 限轉後 ${fmtN(CUR.sol.op.Tt4)} K` : '') : '' }),
    amb,
  ));
  if (mil) {
    rack.append(grp('後燃器與噴嘴', 'REHEAT · NOZZLE',
      mkSwitch({ id: 'ab', label: '後燃器點燃', cls: 'ab', get: () => S.ab, set: v => { S.ab = v; S.preset = null; updatePresetButtons(); } }),
      mkSlider({ id: 'Tt7', label: '後燃器出口總溫', sym: 'Tt7', min: 1500, max: 2300, step: 10, get: () => S.Tt7, set: v => S.Tt7 = v, fmt: v => fmtN(v) + ' K', disabled: () => !S.ab }),
      mkSelect({ id: 'noz', label: '噴嘴型式', options: [['cd', '收斂－擴張（可變）'], ['conv', '收斂（可變喉部）']], get: () => S.nozzleType, set: v => S.nozzleType = v }),
    ));
  }
  rack.append(grp('視圖', 'VIEW',
    mkSlider({ id: 'phi', label: '剖切方位', sym: 'φ', min: 0, max: 360, step: 1, get: () => S.phi, set: v => S.phi = v, fmt: v => v.toFixed(0) + '°', level: 'grid', keepPreset: true }),
    mkSlider({ id: 'wedge', label: '剖開角度', min: 0, max: 270, step: 15, get: () => S.wedge, set: v => S.wedge = v, fmt: v => v.toFixed(0) + '°', level: 'grid', keepPreset: true, sub: () => S.wedge === 0 ? '0° 為完整外觀；180° 為對半剖開' : '' }),
    mkSlider({ id: 'np', label: '粒子數量', min: 0, max: 6000, step: 100, get: () => S.particles, set: v => S.particles = v, fmt: v => fmtN(v), level: 'particles', keepPreset: true }),
    mkSlider({ id: 'anim', label: '動畫速度', min: 0, max: 3, step: 0.1, get: () => S.anim, set: v => S.anim = v, fmt: v => v === 0 ? '暫停' : v.toFixed(1) + '×', level: 'none', keepPreset: true, sub: () => '粒子速度為實際流速 × 0.0032 × 倍率；葉片轉速同比例放慢' }),
    mkSelect({ id: 'pcol', label: '粒子著色', options: [['white', '白色（與剖面區隔）'], ['field', '依場變數']], get: () => S.pcolor, set: v => S.pcolor = v, level: 'none' }),
    mkSwitch({ id: 'swB', label: '顯示葉片', get: () => S.blades, set: v => S.blades = v, level: 'none' }),
    mkSwitch({ id: 'swC', label: '等值線', get: () => S.contours, set: v => S.contours = v, level: 'paint' }),
    mkSwitch({ id: 'swL', label: '元件標籤', get: () => S.labels, set: v => S.labels = v, level: 'none' }),
    mkSwitch({ id: 'swD', label: '3D 橫截面圓盤', get: () => S.disk3d, set: v => S.disk3d = v, level: 'section' }),
    mkSwitch({ id: 'swK', label: '鎖定色階範圍', get: () => S.lock, set: v => S.lock = v, level: 'paint' }),
  ));
  const dsn = [
    mkSlider({ id: 'mdot', label: '設計空氣流量', sym: 'ṁ', min: DR.mdot[0], max: DR.mdot[1], step: DR.mdot[2], get: () => S.design.mdot, set: v => S.design.mdot = v, fmt: v => fmtN(v) + ' kg/s', sub: () => `幾何尺寸 ×${Math.sqrt(S.design.mdot / T.design.mdot).toFixed(2)}（相對參考）` }),
    mkSlider({ id: 'opr', label: '總壓比', sym: 'OPR', min: DR.opr[0], max: DR.opr[1], step: DR.opr[2], get: () => S.design.opr, set: v => S.design.opr = v, fmt: v => v.toFixed(1) }),
  ];
  if (DR.fpr) dsn.push(mkSlider({ id: 'fpr', label: '風扇壓比', sym: 'π_f', min: DR.fpr[0], max: DR.fpr[1], step: DR.fpr[2], get: () => S.design.fpr, set: v => S.design.fpr = v, fmt: v => v.toFixed(2),
    sub: S.type === 'lbtf' ? () => CUR.sol ? `設計涵道比（由混合器總壓匹配求得）${CUR.sol.ref.bpr.toFixed(2)}` : '' : null }));
  if (DR.bpr) dsn.push(mkSlider({ id: 'bpr', label: '涵道比', sym: 'α', min: DR.bpr[0], max: DR.bpr[1], step: DR.bpr[2], get: () => S.design.bpr, set: v => S.design.bpr = v, fmt: v => v.toFixed(1) }));
  if (DR.pibst) dsn.push(mkSlider({ id: 'pibst', label: '增壓級壓比', sym: 'π_LPC', min: DR.pibst[0], max: DR.pibst[1], step: DR.pibst[2], get: () => S.design.pibst, set: v => S.design.pibst = v, fmt: v => v.toFixed(2),
    sub: () => `高壓壓氣機壓比 ${(S.design.opr / (S.design.fpr * S.design.pibst)).toFixed(2)}` }));
  dsn.push(mkSlider({ id: 'Tt4max', label: '最大渦輪入口溫度', sym: 'Tt4,max', min: DR.Tt4max[0], max: DR.Tt4max[1], step: DR.Tt4max[2], get: () => S.design.Tt4max, set: v => S.design.Tt4max = v, fmt: v => fmtN(v) + ' K' }));
  rack.append(grp('設計參數', 'DESIGN POINT', el('p', { class: 'note' }, '海平面標準大氣、靜止、100% 油門時成立'), ...dsn));
  const E = S.eff;
  const ef = (id, label, sym, min, max, step, d) => mkSlider({ id, label, sym, min, max, step, get: () => E[id], set: v => E[id] = v, fmt: v => v.toFixed(d || 3) });
  rack.append(grp('部件效率與損失', 'COMPONENTS',
    S.type !== 'tj' ? ef('ef', '風扇多變效率', 'e_f', 0.80, 0.95, 0.005) : null,
    ef('ec', '壓氣機多變效率', 'e_c', 0.80, 0.95, 0.005),
    ef('et', '渦輪多變效率', 'e_t', 0.80, 0.95, 0.005),
    ef('etb', '燃燒效率', 'η_b', 0.90, 1.0, 0.005),
    ef('pib', '燃燒室總壓恢復', 'π_b', 0.90, 0.99, 0.005),
    ef('pidmax', '進氣道總壓恢復', 'π_d', 0.90, 1.0, 0.005),
    ef('pin', '噴嘴總壓恢復', 'π_n', 0.95, 1.0, 0.002),
    ef('etam', '機械效率', 'η_m', 0.95, 1.0, 0.002),
    mkSlider({ id: 'LHV', label: '燃料低熱值', sym: 'h_PR', min: 40, max: 45, step: 0.1, get: () => E.LHV / 1e6, set: v => E.LHV = v * 1e6, fmt: v => v.toFixed(1) + ' MJ/kg' }),
  ));
  // 探針
  const pin = el('div', { class: 'probe-in' },
    el('label', null, 'x (m)', el('input', { id: 'pinX', type: 'number', step: '0.01' })),
    el('label', null, 'r (m)', el('input', { id: 'pinR', type: 'number', step: '0.005', min: '0' })),
    el('label', null, 'θ (°)', el('input', { id: 'pinT', type: 'number', step: '1' })),
    el('button', { class: 'btn', onclick: () => { const x = +$('#pinX').value, r = +$('#pinR').value, t = +$('#pinT').value * DEG; if (isFinite(x) && isFinite(r)) addPin(x, Math.abs(r), t); } }, '放置'),
  );
  rack.append(grp('探針', 'PROBES', el('p', { class: 'note' }, '在剖面或橫截面上點擊即可釘選；也可輸入座標'), pin,
    el('table', { class: 'pins', id: 'pins' }),
    el('div', null, el('button', { class: 'btn', onclick: () => { S.pins = []; renderPins(); } }, '清除全部探針')),
  ));
  refreshControls();
}
function refreshControls() {
  for (const c of CTRLS) c.refresh();
  updatePresetButtons();
  const a = $('#amb');
  if (a && CUR.sol) {
    const fl = CUR.sol.fl;
    a.innerHTML = `<div>T₀<b>${fmtN(fl.T0, 1)} K</b></div><div>P₀<b>${fmtN(fl.P0 / 1000, 2)} kPa</b></div><div>ρ₀<b>${fmtN(fl.rho0, 3)} kg/m³</b></div>`;
  }
}

/* ---------- 計算排程 ---------- */
const LEVELS = { none: 0, particles: 1, paint: 2, section: 3, grid: 4, solve: 5 };
let pend = null, raf = 0, dragging = false;
function request(level, hi) {
  if (!pend) pend = { level: 0, hi: false };
  pend.level = Math.max(pend.level, LEVELS[level] || 0);
  pend.hi = pend.hi || hi;
  if (!raf) raf = requestAnimationFrame(runPending);
}
document.addEventListener('pointerdown', e => { if (e.target && e.target.type === 'range') dragging = true; });
document.addEventListener('pointerup', () => { if (dragging) { dragging = false; request('solve', true); } });
function runPending() {
  raf = 0;
  const p = pend; pend = null;
  if (!p) return;
  const hi = p.hi && !dragging;
  if (p.level >= LEVELS.solve) solveAll();
  if (p.level >= LEVELS.grid) computeGrids(hi);
  if (p.level >= LEVELS.section) computeSec(hi);
  if (p.level >= LEVELS.paint) paintAll();
  if (p.level >= LEVELS.particles) syncParticles();
  if (CUR.needReset && CUR.gA) { CUR.needReset = false; resetParticles(); }
  if (p.level >= LEVELS.solve) { refreshControls(); updatePanels(); }
  else if (p.level >= LEVELS.paint) { drawAxial(); drawTS(); renderPins(); }
  if (!hi && p.level >= LEVELS.grid) { // 放開後補高解析
    clearTimeout(runPending.t); runPending.t = setTimeout(() => request('grid', true), 260);
  }
}
function params() { return { type: S.type, design: S.design, eff: S.eff, alt: S.alt, M0: S.M0, thr: S.thr, ab: S.ab, Tt7: S.Tt7, nozzleType: S.nozzleType }; }
function solveAll() {
  const P = params();
  const sol = solveEngine(P);
  const T = ENGINE_TYPES[S.type];
  const s = Math.sqrt(S.design.mdot / T.design.mdot);
  const nz = sol.op.noz;
  const noz = { r8: Math.sqrt(nz.Athroat / Math.PI), r9: Math.sqrt(Math.max(nz.A, nz.Athroat) / Math.PI) };
  const spec = buildSpec(S.type, s, noz);
  const model = new FieldModel(spec, sol, P);
  Object.assign(CUR, { sol, spec, model, P });
  const key = S.type + '|' + s.toFixed(4);
  if (key !== CUR.specKey) {
    buildEngineMeshes(spec);
    R3.sliceA.geometry.dispose(); R3.sliceB.geometry.dispose();
    R3.sliceA.geometry = sliceGeometry(spec.domain); R3.sliceB.geometry = sliceGeometry(spec.domain);
    R3.floor.position.set(spec.view.target[0], -spec.view.Rmax * 1.7, 0);
    const first = !CUR.specKey;
    CUR.specKey = key; CUR.nozKey = null;
    buildLabels();
    if (S.pins === null) S.pins = defaultPins(spec, model);
    if (S.secXf === null) S.secXf = defaultSecX(spec);
    CUR.typeKey = S.type;
    CUR.needReset = true;
  }
  if (spec.nozzle) {
    const nk = noz.r8.toFixed(3) + '|' + noz.r9.toFixed(3);
    if (nk !== CUR.nozKey) { if (CUR.nozKey) buildBodies(spec); CUR.nozKey = nk; }
  }
}
function computeGrids(hi) {
  const sp = CUR.spec, m = CUR.model;
  const W = hi ? 800 : 380, H = hi ? 176 : 84;
  const map = new GridMap(sp.domain, W, H);
  const phi = S.phi * DEG, w = S.wedge * DEG;
  const gA = computeGrid(m, map, phi);
  let gB = null;
  if (w > 0.01) { gB = computeGrid(m, map, phi + w, cloneGrid(gA), true); gB.th = phi + w; }
  Object.assign(CUR, { map, gA, gB, hiRes: hi });
  setWedge(phi, w);
}
function secRange() { const sp = CUR.spec; const L = sp.view.len; return [sp.lip.x - 0.3 * L, sp.exitsGeom[sp.exitsGeom.length - 1].x + 1.1 * L]; }
function defaultSecX(sp) { const [a, b] = secRange2(sp); const c = sp.comb; return (lerp(c.xd, c.x1, 0.62) - a) / (b - a); }
function secRange2(sp) { const L = sp.view.len; return [sp.lip.x - 0.3 * L, sp.exitsGeom[sp.exitsGeom.length - 1].x + 1.1 * L]; }
function secX() { const [a, b] = secRange(); return lerp(a, b, S.secXf); }
function computeSec(hi) {
  const x = secX();
  const nT = hi ? 240 : 120, nR = hi ? 110 : 55;
  CUR.sec = computeSection(CUR.model, x, CUR.spec.secR, nT, nR);
  const sp = CUR.spec;
  const rr = Math.max(sp.outer.at(Math.min(x, sp.outerEnd)), 0.05) + 0.02 * sp.s;
  R3.ring.scale.setScalar(x > sp.outerEnd + 0.05 ? sp.exitsGeom[0].R * 1.3 : rr);
  R3.ring.position.set(x, 0, 0);
  $('#secXo').textContent = x.toFixed(2) + ' m';
  const cmp = CUR.model.compName(x, 'core') || CUR.model.compName(x, 'inlet') || CUR.model.compName(x, 'ab');
  $('#secSub').textContent = x < sp.lip.x ? '進氣前方' : x > sp.exitsGeom[sp.exitsGeom.length - 1].x ? '噴流區' : (cmp ? cmp.name : '');
  $('#secX').value = Math.round(S.secXf * 1000);
}

/* ---------- 著色 ---------- */
function currentRange() {
  if (S.lock && CUR.range && CUR.rangeKey === S.field) return CUR.range;
  CUR.range = gridRange(CUR.gA, S.field, true); CUR.rangeKey = S.field;
  return CUR.range;
}
const HATCH = { 1: [[38, 46, 56], [58, 69, 82]], 2: [[34, 40, 48], [52, 60, 70]], 3: [[40, 48, 58], [62, 72, 84]], 4: [[70, 56, 36], [102, 82, 52]] };
function paintGrid(G, data, key, norm, lut, showExt, contours) {
  const W = G.W, H = G.H, A = G[key], R = G.reg;
  const fl = CUR.sol.fl, V0 = fl.V0, Tt0 = fl.Tt0, GV = G.V, GT = G.Tt;
  const nLev = 14;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const idx = j * W + i, o = idx * 4, reg = R[idx];
    if (reg === 1) {
      const hc = HATCH[G.mat[idx]] || HATCH[1];
      const c = ((i + j) % 7) < 2 ? hc[1] : hc[0];
      data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255; continue;
    }
    if (reg === 0 && !showExt) { data[o + 3] = 0; continue; }
    const t = norm(A[idx]);
    let li = Math.round(t * 255) * 3;
    let r = lut[li], g = lut[li + 1], b = lut[li + 2];
    if (contours) {
      const lv = Math.floor(t * nLev);
      let edge = false;
      if (i + 1 < W && R[idx + 1] !== 1 && Math.floor(norm(A[idx + 1]) * nLev) !== lv) edge = true;
      else if (j + 1 < H && R[idx + W] !== 1 && Math.floor(norm(A[idx + W]) * nLev) !== lv) edge = true;
      if (edge) { r *= 0.55; g *= 0.55; b *= 0.55; }
    }
    data[o] = r; data[o + 1] = g; data[o + 2] = b;
    data[o + 3] = reg === 0 ? Math.round(95 + 160 * clamp(Math.abs(GV[idx] - V0) / 90 + Math.abs(GT[idx] - Tt0) / 160, 0, 1)) : 255;
  }
}
function paintAll() {
  if (!CUR.gA) return;
  const key = S.field, f = FIELDS[key];
  const range = currentRange(), norm = makeNorm(key, range), lut = LUTS[f.cmap];
  CUR.norm = norm; CUR.lut = lut;
  const gA = CUR.gA;
  resizeTex(R3.texA, gA.W, gA.H);
  R3.sliceA.material.map = R3.texA;
  paintGrid(gA, R3.texA.image.data, key, norm, lut, true, S.contours); R3.texA.needsUpdate = true;
  if (CUR.gB) {
    resizeTex(R3.texB, gA.W, gA.H); R3.sliceB.material.map = R3.texB;
    paintGrid(CUR.gB, R3.texB.image.data, key, norm, lut, Math.abs(S.wedge - 180) < 1, S.contours); R3.texB.needsUpdate = true;
  }
  paintSection();
  drawLegend();
}
function paintSection() {
  const sec = CUR.sec; if (!sec) return;
  const cv = $('#secChart canvas'), wrap = $('#secChart');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const css = Math.max(160, Math.min(wrap.clientWidth || 300, 320));
  cv.style.width = css + 'px'; cv.style.height = css + 'px';
  const N = Math.round(css * dpr);
  if (cv.width !== N || cv.height !== N) { cv.width = N; cv.height = N; }
  const g = cv.getContext('2d');
  const img = g.createImageData(N, N), d = img.data;
  const c = N / 2, Rpx = N / 2 - 30 * dpr, Rs = sec.Rsec;
  const key = S.field, A = sec[key], norm = CUR.norm, lut = CUR.lut;
  const nT = sec.nT, nR = sec.nR;
  for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
    const dx = (px + 0.5 - c) / Rpx, dy = (c - py - 0.5) / Rpx;
    const rr = Math.hypot(dx, dy);
    if (rr >= 1) continue;
    let th = Math.atan2(dx, dy); if (th < 0) th += 2 * Math.PI;
    const i = Math.min(nT - 1, Math.floor(th / (2 * Math.PI) * nT)), j = Math.min(nR - 1, Math.floor(rr * nR));
    const idx = j * nT + i, o = (py * N + px) * 4;
    if (sec.reg[idx] === 1) {
      const hc = HATCH[sec.mat[idx]] || HATCH[1];
      const cc = ((px + py) % 9) < 3 ? hc[1] : hc[0];
      d[o] = cc[0]; d[o + 1] = cc[1]; d[o + 2] = cc[2]; d[o + 3] = 255; continue;
    }
    const li = Math.round(norm(A[idx]) * 255) * 3;
    d[o] = lut[li]; d[o + 1] = lut[li + 1]; d[o + 2] = lut[li + 2]; d[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // 疊加：剖切面方位、刻度
  g.save(); g.translate(c, c);
  g.strokeStyle = 'rgba(226,232,238,0.25)'; g.lineWidth = dpr;
  g.beginPath(); g.arc(0, 0, Rpx, 0, 2 * Math.PI); g.stroke();
  const ray = (th, col, dash) => { g.setLineDash(dash); g.strokeStyle = col; g.beginPath(); g.moveTo(0, 0); g.lineTo(Rpx * Math.sin(th), -Rpx * Math.cos(th)); g.stroke(); };
  g.lineWidth = 1.5 * dpr;
  ray(S.phi * DEG, '#45cfe0', [5 * dpr, 4 * dpr]);
  if (S.wedge > 0) ray((S.phi + S.wedge) * DEG, '#45cfe0', [2 * dpr, 4 * dpr]);
  g.setLineDash([]);
  g.fillStyle = '#a8b4c0'; g.font = `${10 * dpr}px "B612 Mono", monospace`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.textAlign = 'center'; g.fillText('0°', 0, -(Rpx + 9 * dpr)); g.fillText('180°', 0, Rpx + 9 * dpr);
  g.textAlign = 'left'; g.fillText('90°', Rpx + 3 * dpr, 0);
  g.textAlign = 'right'; g.fillText('270°', -(Rpx + 3 * dpr), 0);
  g.restore();
  // 3D 圓盤
  if (S.disk3d) {
    const tex = resizeTex(R3.diskTex, nT, nR), td = tex.image.data;
    for (let idx = 0; idx < nT * nR; idx++) {
      const o = idx * 4;
      if (sec.reg[idx] === 1) { td[o] = 44; td[o + 1] = 52; td[o + 2] = 62; td[o + 3] = 255; continue; }
      const li = Math.round(norm(A[idx]) * 255) * 3;
      td[o] = lut[li]; td[o + 1] = lut[li + 1]; td[o + 2] = lut[li + 2]; td[o + 3] = 255;
    }
    tex.needsUpdate = true; R3.disk.material.map = tex;
    const w = S.wedge > 0 ? S.wedge * DEG : 2 * Math.PI;
    R3.disk.geometry.dispose();
    R3.disk.geometry = diskGeometry(sec.x, sec.Rsec, S.phi * DEG, S.phi * DEG + w);
  }
  R3.disk.visible = S.disk3d;
}
function niceTicks(a, b, n) {
  const span = b - a; if (!(span > 0)) return [a];
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
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
  const key = S.field, f = FIELDS[key], [a, b] = CUR.range;
  $('#lgName').innerHTML = `<b>${f.name} ${f.sym}</b>${f.log ? '（對數色階）' : f.diverge ? '（以 M = 1 為中點）' : ''}${S.lock ? ' · 已鎖定' : ''}`;
  $('#lgUnit').textContent = f.unit;
  const cv = $('#lgCanvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cv.clientWidth * dpr) || 280, H = Math.round(30 * dpr);
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), lut = LUTS[f.cmap], norm = CUR.norm;
  const bh = 10 * dpr;
  for (let x = 0; x < W; x++) { const li = Math.round(x / (W - 1) * 255) * 3; g.fillStyle = `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`; g.fillRect(x, 0, 1, bh); }
  let ticks;
  if (f.diverge) ticks = [0, 0.5, 1, ...niceTicks(1, Math.max(1.05, b), 3).filter(v => v > 1)];
  else if (f.log) { ticks = logTicks(a, b); if (ticks.length > 7) ticks = ticks.filter((_, i) => i % 2 === 0); }
  else ticks = niceTicks(a, b, 5);
  g.fillStyle = '#a8b4c0'; g.strokeStyle = '#a8b4c0'; g.font = `${10 * dpr}px "B612 Mono", monospace`; g.textBaseline = 'top';
  let lastX = -1e9;
  for (const v of ticks) {
    const t = norm(v); if (t < 0 || t > 1) continue;
    const x = Math.round(t * (W - 1)) + 0.5;
    g.fillRect(x - 0.5 * dpr, bh, dpr, 3 * dpr);
    const s = fmtN(v * f.sc, key === 'M' ? 1 : (f.log && v * f.sc < 10 ? (v * f.sc < 1 ? 2 : 1) : 0));
    const tw = g.measureText(s).width;
    let tx = x - tw / 2; tx = clamp(tx, 0, W - tw);
    if (tx < lastX + 4 * dpr) continue;
    g.fillText(s, tx, bh + 5 * dpr); lastX = tx + tw;
  }
}

/* ---------- 粒子 ---------- */
function resetParticles() { const P = R3.P; P.n = 0; syncParticles(); warmParticles(); }
function syncParticles() {
  const P = R3.P, want = S.particles;
  if (want > P.n) { for (let i = P.n; i < want; i++) spawn(i, true); }
  P.n = want;
  R3.pts.geometry.setDrawRange(0, want);
  const sp = CUR.spec; if (sp) R3.pts.material.uniforms.uSize.value = 0.02 * sp.s;
}
function warmParticles() {
  const P = R3.P, T = 30;
  for (let i = 0; i < P.n; i++) P.age[i] = -Math.random() * T;
  for (let k = 0; k < 150; k++) stepParticles(0.2, true);
  for (let i = 0; i < P.n; i++) if (P.age[i] < 0) P.age[i] = 0;
}
function wedgeTh() { const w = S.wedge * DEG; return w > 0.01 ? S.phi * DEG + Math.random() * Math.min(w, 2 * Math.PI) : Math.random() * 2 * Math.PI; }
function spawn(i, initial) {
  const P = R3.P, sp = CUR.spec, fl = CUR.sol.fl;
  P.th[i] = wedgeTh(); P.age[i] = 0;
  const extFrac = clamp(fl.V0 / 120, 0, 1) * 0.12;
  const x0 = sp.domain.xb[0];
  if (Math.random() < extFrac) { P.st[i] = 20; P.psi[i] = Math.random(); P.x[i] = initial ? lerp(x0, sp.domain.xb[3] * 0.8, Math.random()) : x0; return; }
  P.st[i] = 0; P.psi[i] = 0.02 + 0.96 * Math.random();
  P.x[i] = sp.lip.x - 0.9 * sp.lip.r - Math.random() * 0.25 * sp.lip.r;
}
function capR() {
  const sp = CUR.spec, sol = CUR.sol, fl = sol.fl;
  const rl = sp.lip.r;
  if (fl.V0 < 20) return 1.5 * rl;
  const A0 = sol.op.mdot / (fl.rho0 * fl.V0);
  return clamp(Math.sqrt(A0 / Math.PI), 0.6 * rl, 1.5 * rl);
}
function particleR(i, x) {
  const P = R3.P, sp = CUR.spec, st = P.st[i], psi = clamp(P.psi[i], 0.03, 0.97);
  const xs = sp.lip.x - 1.15 * sp.lip.r;
  if (st === 0) { const Rst = lerp(CUR.rcap, sp.lip.r * 0.97, smooth(xs, sp.lip.x, x)); return Math.sqrt(psi) * Rst; }
  if (st >= 1 && st < 10) {
    const s = sp.streams[sp.order[st - 1]];
    const lo = s.lo.at(x), hi = s.hi.at(x);
    return Math.sqrt(lo * lo + psi * (hi * hi - lo * lo));
  }
  if (st >= 10 && st < 20) {
    const ex = CUR.model.exits, e = ex[st - 10], d = x - e.x;
    const Ro = e.R + 1.25 * e.spread * d;
    let ri = 0;
    if (e.plugTip && x < e.plugTip) ri = sp.lines.hub.at(x);
    else if (e.key === 'bypass') { const c = ex.find(q => q.key === 'core'); ri = x < c.x ? sp.lines.cowl.at(x) : c.R + 1.0 * c.spread * (x - c.x); }
    ri = Math.min(ri, Ro * 0.95);
    return Math.sqrt(ri * ri + psi * (Ro * Ro - ri * ri));
  }
  // 外流
  let B;
  const xsp = xs;
  if (x < sp.lip.x) B = lerp(CUR.rcap, sp.lip.rOut, smooth(xsp, sp.lip.x, x));
  else if (x <= sp.outerEnd) B = sp.outer.at(x) + 0.01 * sp.s;
  else { const e = CUR.model.exits[0]; B = Math.max(sp.outer.at(sp.outerEnd), e.R + 1.6 * e.spread * (x - e.x)); }
  const Rf = sp.domain.rb[sp.domain.rb.length - 1] * 0.92;
  return Math.sqrt(B * B + psi * Math.max(0, Rf * Rf - B * B));
}
function stepParticles(dt, warm) {
  const P = R3.P, sp = CUR.spec, m = CUR.model, G = CUR.gA, map = CUR.map;
  if (!sp || !G) return;
  CUR.rcap = capR();
  const kv = 0.0032 * (warm ? 1 : S.anim);
  const pos = R3.pts.geometry.attributes.position.array, col = R3.pts.geometry.attributes.color.array, al = R3.pts.geometry.attributes.alpha.array;
  const xEnd = sp.domain.xb[sp.domain.xb.length - 1] * 0.95;
  const key = S.field, norm = CUR.norm, lut = CUR.lut, white = S.pcolor === 'white';
  const bpr = CUR.sol.op.bpr, fc = 1 / (1 + bpr);
  const phi = S.phi * DEG, w = S.wedge * DEG;
  const exIdx = {}; m.exits.forEach((e, k) => exIdx[e.key] = 10 + k);
  const o = {};
  for (let i = 0; i < P.n; i++) {
    if (P.age[i] < 0) { P.age[i] += dt; if (!warm) al[i] = 0; continue; }
    let x = P.x[i];
    let r = particleR(i, x);
    let vx = gridLookup(G, map, x, r, 'Vx'), vth = gridLookup(G, map, x, r, 'Vth');
    if (!(vx === vx)) { m.sample(x, r, P.th[i], o); vx = o.solid ? 20 : o.Vx; vth = o.solid ? 0 : o.Vth; }
    x += vx * kv * dt;
    P.th[i] += (vth / Math.max(r, 0.02)) * kv * dt;
    P.age[i] += dt;
    // 流道轉換
    const st = P.st[i];
    if (st === 0 && x >= sp.lip.x) P.st[i] = 1;
    else if (st >= 1 && st < 10) {
      const key2 = sp.order[st - 1], s = sp.streams[key2];
      if (x >= s.x1) {
        if (sp.split && key2 === sp.split.from) {
          if (P.psi[i] < fc) { P.st[i] = 1 + sp.order.indexOf('core'); P.psi[i] = P.psi[i] / fc; }
          else { P.st[i] = 1 + sp.order.indexOf('bypass'); P.psi[i] = (P.psi[i] - fc) / (1 - fc); }
        } else if (sp.type === 'lbtf' && (key2 === 'core' || key2 === 'bypass')) {
          const cf = sp.mixer.coreFrac;
          P.psi[i] = key2 === 'core' ? P.psi[i] * cf : cf + P.psi[i] * (1 - cf);
          P.st[i] = 1 + sp.order.indexOf('ab');
        } else {
          P.st[i] = exIdx[key2 === 'bypass' ? 'bypass' : 'core'];
        }
      }
    }
    if (x > xEnd || P.age[i] > 40 || (P.st[i] >= 10 && Math.abs(vx) * kv < 0.002 && P.age[i] > 8)) { spawn(i, false); x = P.x[i]; }
    // 楔形外的外流粒子重新放入楔形
    if (w > 0.01 && w < 2 * Math.PI - 0.01) {
      let d = P.th[i] - phi; d = ((d % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (d > w) P.th[i] = phi + (((d - w) % w) + w) % w;
    }
    P.x[i] = x;
    if (warm) continue;
    r = particleR(i, x);
    const th = P.th[i];
    pos[i * 3] = x; pos[i * 3 + 1] = r * Math.cos(th); pos[i * 3 + 2] = r * Math.sin(th);
    if (white) { col[i * 3] = 0.93; col[i * 3 + 1] = 0.97; col[i * 3 + 2] = 1; }
    else {
      let v = gridLookup(G, map, x, r, key);
      if (!(v === v)) v = CUR.range[0];
      const li = Math.round(norm(v) * 255) * 3;
      col[i * 3] = lut[li] / 255; col[i * 3 + 1] = lut[li + 1] / 255; col[i * 3 + 2] = lut[li + 2] / 255;
    }
    al[i] = P.st[i] === 20 ? 0.28 : 0.9;
  }
  if (!warm) {
    R3.pts.geometry.attributes.position.needsUpdate = true;
    R3.pts.geometry.attributes.color.needsUpdate = true;
    R3.pts.geometry.attributes.alpha.needsUpdate = true;
  }
}

/* ---------- 標籤與探針 ---------- */
function buildLabels() {
  const L = $('#labels3d'); L.innerHTML = '';
  CUR.labels = [];
  const sp = CUR.spec;
  const keys = [...sp.chartComps];
  if (sp.comps.find(c => c.key === 'byp')) keys.push('byp');
  keys.unshift('inlet');
  let k = 0;
  for (const ck of keys) {
    const c = sp.comps.find(q => q.key === ck); if (!c) continue;
    const e = el('div', { class: 'lbl3d', title: c.en }, c.name.replace(/（.*）/, ''));
    L.append(e);
    const xm = 0.5 * (c.x0 + c.x1);
    const lift = [1.16, 1.36, 1.56][k++ % 3];
    CUR.labels.push({ e, p: new THREE.Vector3(xm, sp.view.Rmax * lift, 0) });
  }
  CUR.pinLabels = [];
}
function defaultPins(sp, m) {
  const mid = (key, x) => { const s = sp.streams[key]; return 0.5 * (s.lo.at(x) + s.hi.at(x)); };
  const th = S.phi * DEG;
  const pins = [];
  const inKey = sp.order[0];
  const f = sp.rows.find(r => r.kind === 'fan' || r.comp === 'comp');
  pins.push({ x: f.x0 - 0.01 * sp.s, r: mid(inKey, f.x0 - 0.01 * sp.s), th });
  const c = sp.comb, xc = lerp(c.xd, c.x1, 0.3);
  pins.push({ x: xc, r: 0.5 * (c.linerIn.at(xc) + c.linerOut.at(xc)), th });
  const ngv = sp.rows.find(r => r.kind === 'ngv');
  pins.push({ x: 0.5 * (ngv.x0 + ngv.x1), r: mid('core', 0.5 * (ngv.x0 + ngv.x1)), th });
  const ex = sp.exitsGeom[sp.exitsGeom.length - 1];
  pins.push({ x: ex.x + 0.6 * ex.R, r: ex.plugTip ? 0.5 * (ex.R + ex.Rin) : 0.3 * ex.R, th });
  return pins;
}
function addPin(x, r, th) {
  if (!S.pins) S.pins = [];
  if (S.pins.length >= 6) S.pins.shift();
  S.pins.push({ x, r, th });
  renderPins();
}
function renderPins() {
  const tb = $('#pins'); if (!tb || !CUR.model) return;
  const m = CUR.model, o = {};
  const key = S.field, f = FIELDS[key];
  tb.innerHTML = '';
  if (!S.pins || !S.pins.length) { tb.append(el('tr', null, el('td', { class: 'empty', colspan: 5 }, '尚無探針'))); }
  else {
    tb.append(el('tr', null, el('th', null, '#'), el('th', null, 'x, r (m)'), el('th', null, 'T (K)'), el('th', null, 'P (kPa)'), el('th', null, 'V · M'), el('th', null, '')));
    S.pins.forEach((p, i) => {
      m.sample(p.x, p.r, p.th, o);
      const row = el('tr', { style: 'cursor:pointer', onclick: () => showProbe(p, i + 1) },
        el('td', { html: `<span class="pn">${i + 1}</span>` }),
        el('td', null, `${p.x.toFixed(2)}, ${p.r.toFixed(3)}`),
        el('td', null, o.solid ? '固體' : fmtN(o.T)),
        el('td', null, o.solid ? '' : fmtN(o.P / 1000, 1)),
        el('td', null, o.solid ? '' : `${fmtN(o.V)} · ${o.M.toFixed(2)}`),
        el('td', null, el('button', { title: '移除', 'aria-label': '移除探針', onclick: (ev) => { ev.stopPropagation(); S.pins.splice(i, 1); renderPins(); } }, '×')));
      tb.append(row);
    });
  }
  // 3D 標記
  disposeGroup(R3.pinGroup);
  for (const pl of (CUR.pinLabels || [])) pl.e.remove();
  CUR.pinLabels = [];
  const sp = CUR.spec, rad = 0.018 * sp.s;
  (S.pins || []).forEach((p, i) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(rad, 14, 10), new THREE.MeshBasicMaterial({ color: 0xd882e6, depthTest: false, toneMapped: false }));
    s.renderOrder = 6; s.position.set(p.x, p.r * Math.cos(p.th), p.r * Math.sin(p.th)); R3.pinGroup.add(s);
    const e = el('div', { class: 'lbl3d', style: 'border-left-color:#d882e6;transform:translate(6px,-50%)' }, String(i + 1));
    $('#labels3d').append(e);
    CUR.pinLabels.push({ e, p: s.position.clone() });
  });
  if (!CUR.hovering) showProbe(S.pins && S.pins.length ? S.pins[S.pins.length - 1] : null, S.pins ? S.pins.length : 0);
}
const ZONE = { primary: '主燃區', dilution: '摻混區', annulus: '襯套外環道（二次空氣）', mixer: '混合區', ab: '後燃火焰區', jet: '噴流剪切層／噴流', shock: '欠膨脹噴流震波胞', free: '外部流場' };
const STREAM = { inlet: '進氣流', core: '核心流', bypass: '外涵流', ab: '混合／後燃段' };
const MATN = { nacelle: '短艙', casing: '機匣', hub: '輪轂／中心體', cowl: '核心整流罩', liner: '燃燒室襯套', fh: '火焰穩定器' };
function showProbe(p, n, hover) {
  const box = $('#probe');
  CUR.lastProbe = [p, n, hover];
  if (!p || !CUR.model) { box.innerHTML = `<h4>探針</h4><div class="hint">移動游標至剖面或橫截面即可讀取該點參數。</div>`; return; }
  const o = CUR.model.sample(p.x, p.r, p.th, {});
  const where = `x ${p.x.toFixed(3)} m · r ${p.r.toFixed(3)} m · θ ${((p.th / DEG % 360) + 360) % 360 | 0}°`;
  const title = (hover ? '探針 · 游標位置' : `探針 #${n}`) + `<button class="pc" aria-label="${S.probeMin ? '展開' : '收合'}探針資訊" aria-expanded="${!S.probeMin}">${S.probeMin ? '＋' : '－'}</button>`;
  if (o.solid) { box.innerHTML = `<h4>${title}</h4><div class="where">固體：${MATN[o.mat] || '結構'}<br>${where}</div>`; return; }
  const cmp = CUR.model.compName(p.x, o.stream || 'x');
  const reg = [o.stream ? STREAM[o.stream] : null, cmp ? cmp.name : null, o.zone ? ZONE[o.zone] : null].filter(Boolean).join(' · ') || ZONE.free;
  if (S.probeMin) { box.innerHTML = `<h4>${title}</h4><div class="where">${reg}</div><dl><dt>T · P</dt><dd>${fmtN(o.T)} K · ${fmtN(o.P / 1000, 1)} kPa</dd><dt>V · M</dt><dd>${fmtN(o.V)} m/s · ${o.M.toFixed(2)}</dd></dl>`; return; }
  box.innerHTML = `<h4>${title}</h4><div class="where">${reg}<br>${where}</div><dl>
    <dt>靜溫 T</dt><dd>${fmtN(o.T)} K <span style="color:var(--ink-3)">(${fmtN(o.T - 273.15)} °C)</span></dd>
    <dt>總溫 Tt</dt><dd>${fmtN(o.Tt)} K</dd>
    <dt>靜壓 P</dt><dd>${fmtN(o.P / 1000, o.P < 1e5 ? 2 : 1)} kPa</dd>
    <dt>總壓 Pt</dt><dd>${fmtN(o.Pt / 1000, o.Pt < 1e5 ? 2 : 1)} kPa</dd>
    <dt>速度 V</dt><dd>${fmtN(o.V)} m/s</dd>
    <dt>軸向 / 周向</dt><dd>${fmtN(o.Vx)} / ${fmtN(o.Vth)} m/s</dd>
    <dt>馬赫數 M</dt><dd>${o.M.toFixed(3)}</dd>
    <dt>音速 a</dt><dd>${fmtN(o.a)} m/s</dd>
    <dt>密度 ρ</dt><dd>${fmtN(o.rho, 3)} kg/m³</dd>
    <dt>γ · c<sub>p</sub></dt><dd>${o.g.toFixed(3)} · ${fmtN(o.cp)} J/(kg·K)</dd></dl>
    ${hover ? '<div class="hint">點擊可釘選此點。</div>' : ''}`;
}

/* ---------- 視角 ---------- */
function setView(kind, instant) {
  const sp = CUR.spec; if (!sp) return;
  const asp = R3.camera.aspect || 1.6;
  const t = new THREE.Vector3(...sp.view.target), d = sp.view.dist * Math.pow(Math.max(1, 1.5 / asp), 0.85);
  const phi = S.phi * DEG, w = S.wedge > 0 ? S.wedge * DEG : Math.PI / 2;
  const b = phi + Math.min(w, Math.PI) / 2;
  let p;
  const rad = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi)), nrm = new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi));
  if (kind === 'iso') p = t.clone().add(new THREE.Vector3(-0.22 * d, 0, 0)).add(rad.clone().multiplyScalar(0.34 * d)).add(nrm.clone().multiplyScalar(0.9 * d));
  else if (kind === 'side') { const n = new THREE.Vector3(0, -Math.sin(phi), Math.cos(phi)); p = t.clone().add(n.multiplyScalar(d * 0.95)); p.y += 0.001; }
  else if (kind === 'front') p = new THREE.Vector3(sp.lip.x - 0.75 * d, 0.22 * d, 0.3 * d);
  else if (kind === 'rear') p = new THREE.Vector3(sp.outerEnd + 0.8 * d, 0.2 * d, 0.3 * d);
  else p = new THREE.Vector3(t.x, d, 0.001);
  const tgt = kind === 'front' ? new THREE.Vector3(sp.lip.x + 0.3 * sp.view.len, 0, 0) : kind === 'rear' ? new THREE.Vector3(sp.outerEnd - 0.2 * sp.view.len, 0, 0) : t;
  if (instant || reduceMotion) { R3.camera.position.copy(p); R3.controls.target.copy(tgt); R3.controls.update(); return; }
  const p0 = R3.camera.position.clone(), t0 = R3.controls.target.clone(), t1 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t1) / 650), e = k * k * (3 - 2 * k);
    R3.camera.position.lerpVectors(p0, p, e); R3.controls.target.lerpVectors(t0, tgt, e);
    if (k < 1) requestAnimationFrame(step);
  };
  step();
}

/* ---------- 面板：EICAS、數據、表、警告 ---------- */
function drawDial(cv, v, o) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = 128, H = 92;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cx = 44, cy = 54, R = 32;
  const a0 = 150 * DEG, sweep = 210 * DEG;
  const ang = val => a0 + sweep * clamp((val - o.min) / (o.max - o.min), 0, 1);
  g.fillStyle = 'rgba(226,232,238,0.13)';
  g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, ang(v)); g.closePath(); g.fill();
  g.lineWidth = 2; g.strokeStyle = '#e2e8ee';
  g.beginPath(); g.arc(cx, cy, R, a0, ang(o.amber)); g.stroke();
  g.strokeStyle = '#f3b43f'; g.beginPath(); g.arc(cx, cy, R, ang(o.amber), ang(o.red)); g.stroke();
  g.strokeStyle = '#f25a4f'; g.lineWidth = 3;
  const ar = ang(o.red); g.beginPath(); g.moveTo(cx + (R - 6) * Math.cos(ar), cy + (R - 6) * Math.sin(ar)); g.lineTo(cx + (R + 5) * Math.cos(ar), cy + (R + 5) * Math.sin(ar)); g.stroke();
  const an = ang(v); g.strokeStyle = '#ffffff'; g.lineWidth = 2.2;
  g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (R - 2) * Math.cos(an), cy + (R - 2) * Math.sin(an)); g.stroke();
  const col = v >= o.red ? '#f25a4f' : v >= o.amber ? '#f3b43f' : '#e2e8ee';
  g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(70.5, 4.5, 54, 21);
  g.fillStyle = col; g.font = '15px "B612 Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle';
  g.fillText(o.fmt(v), 121, 15.5);
  if (o.cmd != null) { const ac = ang(o.cmd); g.strokeStyle = '#45cfe0'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + (R + 2) * Math.cos(ac), cy + (R + 2) * Math.sin(ac)); g.lineTo(cx + (R + 8) * Math.cos(ac), cy + (R + 8) * Math.sin(ac)); g.stroke(); }
}
function updatePanels() {
  const { sol, model, spec } = CUR, op = sol.op, ref = sol.ref;
  const T = ENGINE_TYPES[S.type];
  // 表盤
  const dials = $('#dials');
  const want = S.type === 'tj' ? ['N', 'EGT'] : ['N1', 'N2', 'EGT'];
  if (dials.dataset.k !== want.join()) {
    dials.innerHTML = ''; dials.dataset.k = want.join();
    for (const k of want) dials.append(el('div', { class: 'dial' }, el('canvas', { 'data-d': k }), el('span', null, k === 'EGT' ? 'EGT（Tt5）°C' : k + ' %')));
  }
  const egtRef = ref.Tt5 - 273.15;
  const cv = k => dials.querySelector(`canvas[data-d="${k}"]`);
  const pct = v => (v * 100).toFixed(1);
  if (S.type === 'tj') drawDial(cv('N'), op.N.HP * 100, { min: 0, max: 110, amber: 100.5, red: 105, fmt: v => v.toFixed(1) });
  else {
    drawDial(cv('N1'), op.N.LP * 100, { min: 0, max: 110, amber: 100.5, red: 105, fmt: v => v.toFixed(1) });
    drawDial(cv('N2'), op.N.HP * 100, { min: 0, max: 110, amber: 100.5, red: 105, fmt: v => v.toFixed(1) });
  }
  drawDial(cv('EGT'), op.Tt5 - 273.15, { min: 0, max: Math.ceil((egtRef + 120) / 100) * 100, amber: egtRef + 20, red: egtRef + 60, fmt: v => v.toFixed(0) });
  // 數據
  const n = op.noz, nb = op.nozB;
  const ffh = op.mfuel * 3600;
  const tiles = [
    { k: '淨推力 F', v: `${fmtN(op.F / 1000, 1)}<small>kN</small>`, x: `${fmtN(op.F / 4.44822)} lbf`, cls: 'hero' },
    { k: '推力比油耗 TSFC', v: `${fmtN(op.tsfc * 1e6, 2)}<small>g/(kN·s)</small>`, x: `${(op.tsfc * 3600 * 9.80665).toFixed(3)} lb/(lbf·h)` },
    { k: '燃油流量', v: `${fmtN(ffh)}<small>kg/h</small>`, x: op.mfAB ? `後燃 ${fmtN(op.mfAB * 3600)} kg/h` : `油氣比 f = ${op.f.toFixed(4)}` },
    { k: '空氣流量 ṁ₀', v: `${fmtN(op.mdot, 1)}<small>kg/s</small>`, x: S.type === 'tj' ? `設計 ${fmtN(ref.mdot, 0)} kg/s` : `核心 ${fmtN(op.mcore, 1)} · 外涵 ${fmtN(op.mbyp, 1)}` },
    S.type !== 'tj' ? { k: '涵道比 α', v: op.bpr.toFixed(2), x: `設計 ${ref.bpr.toFixed(2)}` } : { k: '壓氣機出口 Tt3', v: `${fmtN(op.Tt3)}<small>K</small>`, x: `Pt3 ${fmtN(op.Pt3 / 1000)} kPa` },
    { k: '總壓比 OPR', v: op.opr.toFixed(1), x: S.type !== 'tj' ? `風扇 π_f ${op.pif.toFixed(2)}` : `設計 ${ref.opr.toFixed(1)}` },
    { k: '渦輪入口溫度 Tt4', v: `${fmtN(op.Tt4)}<small>K</small>`, x: op.limited ? `指令 ${fmtN(op.Tt4cmd)} K（限轉）` : `${fmtN(op.Tt4 - 273.15)} °C`, cls: op.limited ? 'warn' : '' },
    { k: '熱效率 η_th', v: `${(op.etaTh * 100).toFixed(1)}<small>%</small>`, x: '動能增量 ÷ 燃料熱量' },
    { k: '推進效率 η_p', v: sol.fl.V0 > 1 ? `${(op.etaP * 100).toFixed(1)}<small>%</small>` : '—', x: sol.fl.V0 > 1 ? 'F·V₀ ÷ 動能增量' : '靜止時無定義' },
    { k: '總效率 η_o', v: sol.fl.V0 > 1 ? `${(op.etaO * 100).toFixed(1)}<small>%</small>` : '—', x: 'η_th × η_p' },
    { k: '比推力 F/ṁ₀', v: `${fmtN(op.Fs)}<small>N·s/kg</small>`, x: `衝壓阻力 ${fmtN(op.ramDrag / 1000, 1)} kN` },
    nb ? { k: '噴嘴出口 M₉ · M₁₉', v: `${n.M.toFixed(2)} · ${nb.M.toFixed(2)}`, x: `${fmtN(n.V)} · ${fmtN(nb.V)} m/s` }
      : { k: '噴嘴出口 M₉', v: `${n.M.toFixed(2)}`, x: `${fmtN(n.V)} m/s · A₉/A₈ ${(n.A / n.Athroat).toFixed(2)}` },
  ].filter(Boolean);
  $('#nums').innerHTML = tiles.map(t => `<div class="nm ${t.cls || ''}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="x">${t.x}</div></div>`).join('');
  // 警告與狀態
  const warns = [...op.warn];
  if (op.F < 0) warns.push(`淨推力為負（${fmtN(op.F / 1000, 1)} kN）：此油門下衝壓阻力 ${fmtN(op.ramDrag / 1000, 1)} kN 大於噴流總推力`);
  if (model.chokes.some(c => c.stream === 'ab' || (spec.ab && c.x > spec.ab.xFH))) warns.push('後燃段出現熱壅塞（局部馬赫數達 1）：請降低 Tt7');
  $('#warnbar').innerHTML = warns.map(w => `<div>⚠ ${w}</div>`).join('');
  const chips = [];
  if (op.limited) chips.push(['warn', '轉速限制作動']);
  if (op.abOn) chips.push(['warn', '後燃器點燃']);
  chips.push([n.choked ? 'info' : 'ok', `${S.type === 'hbtf' ? '核心' : ''}噴嘴${n.choked ? '壅塞' : '未壅塞'}`]);
  if (nb) chips.push([nb.choked ? 'info' : 'ok', `外涵噴嘴${nb.choked ? '壅塞' : '未壅塞'}`]);
  if (model.exits.some(e => e.under)) chips.push(['info', '欠膨脹：噴流震波胞']);
  $('#chips').innerHTML = chips.map(([c, t]) => `<span class="chip ${c}"><i></i>${t}</span>`).join('');
  stationTable();
  drawAxial(); drawTS(); renderPins();
}
function stationTable() {
  const { model, spec, sol } = CUR, fl = sol.fl, op = sol.op;
  const rows = [];
  const kk = {};
  rows.push({ id: '0', name: '自由流', x: null, T: fl.T0, P: fl.P0, Tt: fl.Tt0, Pt: fl.Pt0, M: fl.M0, V: fl.V0, m: op.mdot });
  for (const st of spec.stations) {
    const kn = model.kn[st.stream]; if (!kn) continue;
    const k = knotAt(kn, st.x, kk);
    const g = k.g, R = k.R, kf = 1 + 0.5 * (g - 1) * k.M * k.M;
    const T = k.Tt / kf, P = k.Pt / Math.pow(kf, g / (g - 1));
    const cmp = { name: stName(st.id) };
    const mdot = lerp(kn[0].mdot, kn[kn.length - 1].mdot, clamp((st.x - kn[0].x) / (kn[kn.length - 1].x - kn[0].x), 0, 1));
    rows.push({ id: st.id, name: cmp ? cmp.name : '', x: st.x, T, P, Tt: k.Tt, Pt: k.Pt, M: k.M, V: k.M * Math.sqrt(g * R * T), m: stMdot(st) || mdot });
  }
  const t = $('#stTable');
  t.innerHTML = `<thead><tr><th>站位</th><th>位置</th><th>x (m)</th><th>Tt (K)</th><th>Pt (kPa)</th><th>T (K)</th><th>P (kPa)</th><th>M</th><th>V (m/s)</th><th>ṁ (kg/s)</th></tr></thead><tbody>` +
    rows.map(r => `<tr><td><span class="id">${r.id}</span></td><td>${r.name}</td><td class="n">${r.x == null ? '—' : r.x.toFixed(2)}</td><td class="n">${fmtN(r.Tt)}</td><td class="n">${fmtN(r.Pt / 1000, 1)}</td><td class="n">${fmtN(r.T)}</td><td class="n">${fmtN(r.P / 1000, 1)}</td><td class="n">${r.M.toFixed(2)}</td><td class="n">${fmtN(r.V)}</td><td class="n">${fmtN(r.m, 1)}</td></tr>`).join('') + '</tbody>';
}
function stName(id) {
  const tj = S.type === 'tj';
  const N = { '2': tj ? '壓氣機進口' : '風扇進口', '13': '風扇外涵出口', '21': '增壓級進口', '25': '高壓壓氣機進口', '3': tj ? '壓氣機出口' : '高壓壓氣機出口',
    '4': '燃燒室出口／渦輪進口', '45': '高壓渦輪出口', '5': tj ? '渦輪出口' : '低壓渦輪出口', '6': '後燃器進口', '6A': '混合器出口', '16': '外涵混合器進口',
    '7': '後燃器出口', '8': '噴嘴喉部', '9': '噴嘴出口', '19': '外涵噴嘴出口' };
  return N[id] || '';
}
function stMdot(st) {
  const op = CUR.sol.op;
  const m = { '2': op.mdot, '13': op.mbyp, '19': op.mbyp, '16': op.mbyp, '21': op.mcore, '25': op.mcore, '3': op.mcore };
  if (m[st.id] != null) return m[st.id];
  const m4 = (op.mcore || op.mdot) * (1 + op.f);
  if (['4', '45', '5'].includes(st.id)) return m4;
  if (st.id === '6A' || st.id === '6') return S.type === 'lbtf' ? m4 + op.mbyp : m4;
  if (['7', '8', '9'].includes(st.id)) return op.m7 || m4;
  return null;
}

/* ---------- 圖表共用 ---------- */
function setupCanvas(box, hCss) {
  const cv = box.querySelector('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = box.clientWidth || 400, H = hCss;
  cv.style.height = H + 'px';
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return { cv, g, W, H };
}
const INK = '#e2e8ee', INK2 = '#a8b4c0', INK3 = '#6f8091', GRID = '#1f2c39';
function axisFont(g) { g.font = '11px "B612 Mono", ui-monospace, monospace'; }

/* ---------- 軸向分布圖 ---------- */
function axialFamily() {
  const f = S.field, core = S.type === 'tj' ? '主流' : '核心';
  if (f === 'T' || f === 'Tt') return { y: 'K', log: false, s: [{ k: 'Tt', n: `${core}總溫 Tt`, c: '#3987e5' }, { k: 'T', n: `${core}靜溫 T`, c: '#d95926' }, { k: 'Tt', n: '外涵總溫', c: '#199e70', byp: true }] };
  if (f === 'P' || f === 'Pt') return { y: 'kPa', log: true, sc: 1e-3, s: [{ k: 'Pt', n: `${core}總壓 Pt`, c: '#3987e5' }, { k: 'P', n: `${core}靜壓 P`, c: '#d95926' }, { k: 'Pt', n: '外涵總壓', c: '#199e70', byp: true }] };
  if (f === 'V') return { y: 'm/s', log: false, s: [{ k: 'V', n: `${core}速度`, c: '#3987e5' }, { k: 'V', n: '外涵速度', c: '#199e70', byp: true }] };
  if (f === 'M') return { y: '', log: false, ref1: true, s: [{ k: 'M', n: `${core}馬赫數`, c: '#3987e5' }, { k: 'M', n: '外涵馬赫數', c: '#199e70', byp: true }] };
  return { y: 'kg/m³', log: true, s: [{ k: 'rho', n: `${core}密度`, c: '#3987e5' }, { k: 'rho', n: '外涵密度', c: '#199e70', byp: true }] };
}
function axialData() {
  const m = CUR.model;
  const core = [...upstreamSeries(m, 24)];
  for (const k of ['inlet', 'core', 'ab']) if (m.kn[k]) core.push(...axialSeries(m, k));
  core.push(...plumeSeries(m, 48));
  const byp = m.kn.bypass ? axialSeries(m, 'bypass') : null;
  return { core, byp };
}
function chartH() { return window.innerWidth < 760 ? 220 : window.innerWidth < 1180 ? 260 : 318; }
function drawAxial() {
  const box = $('#axChart'); if (!CUR.model) return;
  const H = chartH();
  const { g, W } = setupCanvas(box, H);
  const fam = axialFamily(), D = axialData(), sp = CUR.spec;
  const pl = 64, pr = 12, pt = 26, pb = 30;
  const L = sp.view.len, xe = sp.exitsGeom[sp.exitsGeom.length - 1].x;
  const x0 = Math.max(D.core[0].x, sp.lip.x - 0.28 * L), x1 = Math.min(D.core[D.core.length - 1].x, xe + 0.75 * L);
  D.core = D.core.filter(p => p.x >= x0 - 1e-6 && p.x <= x1 + 1e-6);
  const sc = fam.sc || 1;
  let ymin = Infinity, ymax = -Infinity;
  const series = fam.s.filter(s => !s.byp || D.byp).map(s => ({ ...s, pts: (s.byp ? D.byp : D.core).map(p => [p.x, p[s.k] * sc]).filter(p => isFinite(p[1]) && p[1] > (fam.log ? 0 : -Infinity)) }));
  for (const s of series) for (const p of s.pts) { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }
  if (fam.ref1) { ymin = 0; ymax = Math.max(ymax, 1.2); }
  if (!fam.log) { const pad = (ymax - ymin) * 0.06; ymin = fam.ref1 || ymin - pad < 0 ? Math.max(0, ymin - pad) : ymin - pad; ymax += pad; if (S.field === 'V' || S.field === 'T' || S.field === 'Tt') ymin = Math.max(0, ymin); }
  else { ymin /= 1.25; ymax *= 1.25; }
  const X = x => pl + (x - x0) / (x1 - x0) * (W - pl - pr);
  const Y = fam.log ? v => pt + (1 - (Math.log(v) - Math.log(ymin)) / (Math.log(ymax) - Math.log(ymin))) * (H - pt - pb) : v => pt + (1 - (v - ymin) / (ymax - ymin)) * (H - pt - pb);
  // 元件色帶
  g.font = '10.5px "Noto Sans TC", "PingFang TC", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  let alt = 0;
  for (const ck of sp.chartComps) {
    const c = sp.comps.find(q => q.key === ck); if (!c) continue;
    const a = X(c.x0), b = X(c.x1);
    g.fillStyle = (alt++ % 2) ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.06)';
    g.fillRect(a, pt, b - a, H - pt - pb);
    if (b - a > 14) { g.fillStyle = INK3; const t = c.name.replace(/（.*）/, ''); const t2 = b - a > g.measureText(t).width + 4 ? t : (c.short || t.slice(0, 2)); if (b - a > g.measureText(t2).width) g.fillText(t2, (a + b) / 2, pt - 8); }
  }
  // 格線與刻度
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  const yt = fam.log ? logTicks(ymin, ymax) : niceTicks(ymin, ymax, 5);
  for (const v of yt) {
    const y = Y(v); g.strokeStyle = GRID; g.lineWidth = 1; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke();
    g.fillStyle = INK3; g.fillText(fmtN(v, v < 1 ? 2 : v < 10 && fam.log ? 1 : 0), pl - 6, y);
  }
  g.save(); g.translate(9, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK3; g.fillText(fam.y + (fam.log ? '（對數）' : ''), 0, 0); g.restore();
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const v of niceTicks(x0, x1, 8)) { const x = X(v); if (x > W - pr - 44) continue; g.fillStyle = INK3; g.fillText(v.toFixed(v % 1 ? 1 : 0), x, H - pb + 16); }
  g.textAlign = 'right'; g.fillStyle = INK3; g.fillText('x (m)', W - pr, H - pb + 16);
  // 站位
  g.textAlign = 'center';
  let lastSx = -1e9;
  for (const st of sp.stations) {
    if (st.stream === 'bypass') continue;
    const x = X(st.x); g.strokeStyle = INK3; g.beginPath(); g.moveTo(x, H - pb); g.lineTo(x, H - pb + 4); g.stroke();
    const tw = g.measureText(st.id).width;
    if (x - tw / 2 < lastSx + 3) continue;
    g.fillStyle = '#45cfe0'; g.fillText(st.id, x, H - pb + 4); lastSx = x + tw / 2;
  }
  if (fam.ref1) { const y = Y(1); g.setLineDash([4, 4]); g.strokeStyle = INK2; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.setLineDash([]); g.fillStyle = INK2; g.textAlign = 'left'; g.textBaseline = 'bottom'; g.fillText('M = 1', pl + 4, y - 2); }
  // 橫截面位置
  const xs = secX(); if (xs >= x0 && xs <= x1) { const x = X(xs); g.strokeStyle = 'rgba(69,207,224,0.7)'; g.lineWidth = 1.5; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); }
  // 曲線
  g.lineJoin = 'round'; g.lineCap = 'round';
  for (const s of series) {
    g.strokeStyle = s.c; g.lineWidth = 2; g.setLineDash(s.byp ? [6, 4] : []);
    g.beginPath(); s.pts.forEach((p, i) => { const x = X(p[0]), y = Y(clamp(p[1], ymin, ymax)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
  }
  g.setLineDash([]);
  CUR.ax = { X, Y, x0, x1, pl, pr, pt, pb, W, H, series, fam };
  $('#axKeys').innerHTML = series.map(s => `<span><i class="${s.byp ? 'd' : ''}" style="border-color:${s.c}"></i>${s.n}</span>`).join('');
  $('#axSub').textContent = FIELDS[S.field].name;
}
function interpSeries(pts, x) {
  if (!pts.length || x < pts[0][0] || x > pts[pts.length - 1][0]) return null;
  for (let i = 1; i < pts.length; i++) if (pts[i][0] >= x) { const a = pts[i - 1], b = pts[i]; const t = b[0] - a[0] < 1e-9 ? 1 : (x - a[0]) / (b[0] - a[0]); return lerp(a[1], b[1], t); }
  return null;
}
function axHover(e) {
  const A = CUR.ax; if (!A) return;
  const box = $('#axChart'), rc = box.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
  const tip = box.querySelector('.tip');
  if (mx < A.pl || mx > A.W - A.pr) { tip.hidden = true; return; }
  const x = A.x0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.x1 - A.x0);
  const cmp = CUR.model.compName(x, 'core') || CUR.model.compName(x, 'inlet') || CUR.model.compName(x, 'ab');
  let html = `<b>x = ${x.toFixed(2)} m</b>${cmp ? ' · ' + cmp.name : ''}`;
  for (const s of A.series) { const v = interpSeries(s.pts, x); if (v != null) html += `<div class="r"><span style="color:${s.c}">${s.n}</span><span>${fmtN(v, A.fam.y === '' ? 2 : v < 10 ? 2 : v < 100 ? 1 : 0)} ${A.fam.y}</span></div>`; }
  tip.innerHTML = html; tip.hidden = false;
  const tw = tip.offsetWidth;
  tip.style.left = (mx + 14 + tw > rc.width ? mx - tw - 10 : mx + 14) + 'px'; tip.style.top = Math.max(0, my - 10) + 'px';
  drawAxial();
  const g = box.querySelector('canvas').getContext('2d');
  g.strokeStyle = 'rgba(226,232,238,0.5)'; g.lineWidth = 1; g.beginPath(); g.moveTo(mx, A.pt); g.lineTo(mx, A.H - A.pb); g.stroke();
  for (const s of A.series) { const v = interpSeries(s.pts, x); if (v == null) continue; const y = A.Y(v); g.fillStyle = s.c; g.strokeStyle = '#131c25'; g.lineWidth = 2; g.beginPath(); g.arc(mx, y, 4, 0, 2 * Math.PI); g.fill(); g.stroke(); }
}

/* ---------- T–s 圖 ---------- */
function drawTS() {
  const box = $('#tsChart'); if (!CUR.model) return;
  const H = chartH();
  const { g, W } = setupCanvas(box, H);
  const { pts, byp } = tsPath(CUR.model);
  const pl = 60, pr = 14, pt = 12, pb = 30;
  const all = [...pts, ...(byp || [])];
  let s0 = Math.min(0, ...all.map(p => p.s)), s1 = Math.max(...all.map(p => p.s));
  let T0 = Math.min(...all.map(p => p.T)), T1 = Math.max(...all.map(p => p.T));
  const ds = s1 - s0; s0 -= ds * 0.04; s1 += ds * 0.1;
  T0 = Math.max(0, T0 - 60); T1 += 120;
  const X = s => pl + (s - s0) / (s1 - s0) * (W - pl - pr), Y = T => pt + (1 - (T - T0) / (T1 - T0)) * (H - pt - pb);
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(T0, T1, 5)) { const y = Y(v); g.strokeStyle = GRID; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = INK3; g.fillText(fmtN(v), pl - 6, y); }
  g.textAlign = 'center'; g.textBaseline = 'top';
  for (const v of niceTicks(s0, s1, 5)) { g.fillStyle = INK3; g.fillText(fmtN(v), X(v), H - pb + 6); }
  g.fillText('s (J/(kg·K))', W - pr - 50, H - 13);
  g.save(); g.translate(9, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textBaseline = 'middle'; g.fillText('T (K)', 0, 0); g.restore();
  // 排熱等壓線
  const last = pts[pts.length - 1], first = pts[0];
  const cpe = last.s / Math.log(last.T / first.T);
  g.setLineDash([2, 4]); g.strokeStyle = INK2; g.lineWidth = 1.5; g.beginPath();
  for (let i = 0; i <= 30; i++) { const s = last.s * i / 30, T = first.T * Math.exp(s / cpe); i ? g.lineTo(X(s), Y(T)) : g.moveTo(X(s), Y(T)); }
  g.stroke(); g.setLineDash([]);
  // 外涵
  if (byp) { g.strokeStyle = '#199e70'; g.lineWidth = 2; g.setLineDash([6, 4]); g.beginPath(); byp.forEach((p, i) => i ? g.lineTo(X(p.s), Y(p.T)) : g.moveTo(X(p.s), Y(p.T))); g.stroke(); g.setLineDash([]); }
  // 核心
  g.strokeStyle = '#3987e5'; g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  pts.forEach((p, i) => i ? g.lineTo(X(p.s), Y(p.T)) : g.moveTo(X(p.s), Y(p.T))); g.stroke();
  const lab = [...pts.filter(p => p.id && p.id !== '0t'), ...(byp ? byp.filter(p => p.id) : [])];
  g.font = '10.5px "B612 Mono", monospace'; g.textBaseline = 'middle';
  const placed = [];
  for (const p of lab) {
    const x = X(p.s), y = Y(p.T);
    g.fillStyle = byp && byp.includes(p) ? '#199e70' : '#3987e5'; g.strokeStyle = '#131c25'; g.lineWidth = 2;
    g.beginPath(); g.arc(x, y, 3.5, 0, 2 * Math.PI); g.fill(); g.stroke();
    let tx = x + 6, ty = y - 8;
    if (placed.some(q => Math.abs(q[0] - tx) < 18 && Math.abs(q[1] - ty) < 11)) { tx = x - 22; ty = y + 8; }
    if (placed.some(q => Math.abs(q[0] - tx) < 18 && Math.abs(q[1] - ty) < 11)) continue;
    placed.push([tx, ty]);
    g.fillStyle = INK2; g.textAlign = 'left'; g.fillText(p.id.replace('s', '′'), tx, ty);
  }
  CUR.ts = { X, Y, pts, byp, lab };
  $('#tsKeys').innerHTML = `<span><i style="border-color:#3987e5"></i>核心流程</span>${byp ? '<span><i class="d" style="border-color:#199e70"></i>外涵</span>' : ''}<span><i class="d" style="border-color:${INK2};border-top-style:dotted"></i>P₀ 排熱</span>`;
}
function tsHover(e) {
  const A = CUR.ts; if (!A) return;
  const box = $('#tsChart'), rc = box.getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top;
  const tip = box.querySelector('.tip');
  let best = null, bd = 400;
  for (const p of A.lab) { const d = (A.X(p.s) - mx) ** 2 + (A.Y(p.T) - my) ** 2; if (d < bd) { bd = d; best = p; } }
  if (!best) { tip.hidden = true; return; }
  const nm = { '0': '自由流靜狀態', '9s': '噴嘴出口靜狀態', '19s': '外涵出口靜狀態' };
  tip.innerHTML = `<b>站位 ${best.id.replace('s', '′')}</b>${nm[best.id] ? ' · ' + nm[best.id] : ''}<div class="r"><span>T</span><span>${fmtN(best.T)} K</span></div><div class="r"><span>s</span><span>${fmtN(best.s)} J/(kg·K)</span></div>${best.P ? `<div class="r"><span>P</span><span>${fmtN(best.P / 1000, 1)} kPa</span></div>` : ''}`;
  tip.hidden = false;
  const tw = tip.offsetWidth; tip.style.left = (mx + 12 + tw > rc.width ? mx - tw - 8 : mx + 12) + 'px'; tip.style.top = Math.max(0, my - 12) + 'px';
}

/* ---------- 3D 互動 ---------- */
const ndc = new THREE.Vector2();
let hoverRAF = 0, lastPE = null, downXY = null;
function pick(e) {
  const c = R3.renderer.domElement, rc = c.getBoundingClientRect();
  ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  R3.raycaster.setFromCamera(ndc, R3.camera);
  const objs = [R3.sliceA, R3.sliceB, R3.disk].filter(o => o.visible);
  const hits = R3.raycaster.intersectObjects(objs, false);
  for (const h of hits) {
    const p = h.point;
    const r = Math.hypot(p.y, p.z);
    let th = Math.atan2(p.z, p.y);
    if (h.object === R3.sliceA) th = S.phi * DEG; else if (h.object === R3.sliceB) th = (S.phi + S.wedge) * DEG;
    const o = CUR.model.sample(p.x, r, th, {});
    if (h.object !== R3.disk && o.region === 'ext' && h.object === R3.sliceB && Math.abs(S.wedge - 180) > 1) continue;
    return { x: p.x, r, th, point: p };
  }
  return null;
}
function onVpMove(e) {
  lastPE = e;
  if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0;
    if (!CUR.model || !lastPE) return;
    const h = pick(lastPE);
    if (h) {
      CUR.hovering = true; showProbe(h, 0, true);
      R3.marker.visible = true; R3.marker.position.copy(h.point); R3.marker.scale.setScalar(0.012 * CUR.spec.s);
      R3.renderer.domElement.style.cursor = 'crosshair';
    } else { leaveVp(); }
  });
}
function leaveVp() {
  CUR.hovering = false; R3.marker.visible = false; R3.renderer.domElement.style.cursor = '';
  showProbe(S.pins && S.pins.length ? S.pins[S.pins.length - 1] : null, S.pins ? S.pins.length : 0);
}

/* ---------- 橫截面互動 ---------- */
function secPoint(e) {
  const cv = $('#secChart canvas'), rc = cv.getBoundingClientRect();
  const c = rc.width / 2, Rpx = rc.width / 2 - 30;
  const dx = (e.clientX - rc.left - c) / Rpx, dy = (c - (e.clientY - rc.top)) / Rpx;
  const rr = Math.hypot(dx, dy); if (rr >= 1) return null;
  let th = Math.atan2(dx, dy); if (th < 0) th += 2 * Math.PI;
  return { x: CUR.sec.x, r: rr * CUR.sec.Rsec, th, mx: e.clientX - rc.left, my: e.clientY - rc.top };
}

/* ---------- 主迴圈 ---------- */
const V3 = new THREE.Vector3();
function frame() {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, R3.clock.getDelta());
  R3.controls.update();
  if (CUR.sol) {
    if (S.anim > 0 && !reduceMotion) {
      const N = CUR.sol.op.N;
      R3.spools.LP.rotation.x += (N.LP || 0) * 2.4 * S.anim * dt;
      R3.spools.HP.rotation.x += (N.HP || 0) * 4.2 * S.anim * dt;
      if (S.particles > 0) stepParticles(dt, false);
    } else if (S.particles > 0 && !CUR.pStatic) { stepParticles(0, false); }
    R3.statics.visible = R3.spools.LP.visible = R3.spools.HP.visible = S.blades;
    R3.pts.visible = S.particles > 0;
  }
  const rect = R3.host.getBoundingClientRect();
  const placed = [];
  const proj = (arr, show, pin) => {
    for (const L of arr || []) {
      if (!show) { L.e.hidden = true; continue; }
      V3.copy(L.p).project(R3.camera);
      let vis = V3.z < 1 && Math.abs(V3.x) < 1.05 && Math.abs(V3.y) < 1.05;
      const px = (V3.x + 1) / 2 * rect.width, py = (1 - V3.y) / 2 * rect.height;
      if (vis && !pin) { // 避免標籤互相重疊
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
  if (CUR.model) { drawAxial(); drawTS(); paintSection(); drawLegend(); }
}

/* ---------- 啟動 ---------- */
function boot() {
  // 引擎類型
  const ts = $('#typeSeg');
  for (const k of ['hbtf', 'tj', 'lbtf']) ts.append(el('button', { 'data-t': k, onclick: () => switchType(k) }, ENGINE_TYPES[k].label));
  const fs = $('#fieldSeg');
  for (const k of ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho']) fs.append(el('button', { 'data-f': k, title: FIELDS[k].name, onclick: () => { S.field = k; markSeg(); request('paint', true); } }, `${FIELDS[k].name}`));
  initScene($('#vp'));
  for (const b of $('#tools').querySelectorAll('button')) b.addEventListener('click', () => setView(b.dataset.view));
  const cvs = R3.renderer.domElement;
  cvs.addEventListener('pointermove', onVpMove);
  cvs.addEventListener('pointerleave', () => { lastPE = null; leaveVp(); });
  cvs.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  cvs.addEventListener('pointerup', e => {
    if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4) return;
    const h = pick(e); if (h) addPin(h.x, h.r, h.th);
  });
  const ax = $('#axChart');
  ax.addEventListener('pointermove', axHover);
  ax.addEventListener('pointerleave', () => { ax.querySelector('.tip').hidden = true; drawAxial(); });
  ax.addEventListener('click', e => {
    const A = CUR.ax, rc = ax.getBoundingClientRect(), mx = e.clientX - rc.left;
    if (!A || mx < A.pl || mx > A.W - A.pr) return;
    const x = A.x0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.x1 - A.x0);
    const [a, b] = secRange(); S.secXf = clamp((x - a) / (b - a), 0, 1); request('section', true); drawAxial();
  });
  const ts2 = $('#tsChart'); ts2.addEventListener('pointermove', tsHover); ts2.addEventListener('pointerleave', () => ts2.querySelector('.tip').hidden = true);
  const sx = $('#secX');
  sx.addEventListener('input', () => { S.secXf = sx.value / 1000; request('section', false); drawAxial(); });
  sx.addEventListener('change', () => { request('section', true); });
  const sc = $('#secChart');
  sc.addEventListener('pointermove', e => {
    if (!CUR.sec) return;
    const p = secPoint(e), tip = sc.querySelector('.tip');
    if (!p) { tip.hidden = true; leaveVp(); return; }
    CUR.hovering = true; showProbe(p, 0, true);
    const o = CUR.model.sample(p.x, p.r, p.th, {});
    tip.innerHTML = o.solid ? `<b>固體</b> ${MATN[o.mat] || ''}` : `<b>${FIELDS[S.field].name}</b> ${fmtV(S.field, o[S.field])} ${FIELDS[S.field].unit}<div class="r"><span>r · θ</span><span>${p.r.toFixed(3)} m · ${(p.th / DEG).toFixed(0)}°</span></div>`;
    tip.hidden = false; tip.style.left = (p.mx + 12) + 'px'; tip.style.top = (p.my - 8) + 'px';
    R3.marker.visible = true; R3.marker.position.set(p.x, p.r * Math.cos(p.th), p.r * Math.sin(p.th)); R3.marker.scale.setScalar(0.012 * CUR.spec.s);
  });
  sc.addEventListener('pointerleave', () => { sc.querySelector('.tip').hidden = true; leaveVp(); });
  sc.addEventListener('click', e => { const p = secPoint(e); if (p) addPin(p.x, p.r, p.th); });
  $('#probe').addEventListener('click', e => { if (e.target.closest('.pc')) { S.probeMin = !S.probeMin; if (CUR.lastProbe) showProbe(...CUR.lastProbe); } });
  new ResizeObserver(onResize).observe($('#vp'));
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(onResize, 120); });
  resetType('hbtf');
  switchType('hbtf', true);
  frame();
}
function markSeg() {
  for (const b of $('#typeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.t === S.type ? 'true' : 'false');
  for (const b of $('#fieldSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.f === S.field ? 'true' : 'false');
}
function switchType(t, first) {
  if (!first) resetType(t);
  markSeg();
  solveAll();
  buildRack();
  computeGrids(true); computeSec(true); paintAll(); syncParticles();
  CUR.needReset = false; resetParticles();
  refreshControls(); updatePanels(); onResize();
  setView('iso', !!first);
}
