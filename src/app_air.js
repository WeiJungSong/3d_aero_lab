/* ============================================================
 *  app_air.js — 全機氣動實驗室：狀態、控制架、計算管線、剖面與粒子、探針、主迴圈
 * ============================================================ */
const $ = (s, e) => (e || document).querySelector(s);
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
const fmtS = (v, d) => (v == null || !isFinite(v)) ? '—' : (v < 0 ? '−' : '') + fmtN(Math.abs(v), d);
const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ---------- 場變數 ---------- */
CMAPS.cp = { stops: [0, 0.14, 0.3, 0.43, 0.5, 0.57, 0.7, 0.86, 1], cols: ['#b8ecff', '#56b4f2', '#2a6fc4', '#27435f', '#2b3139', '#5a3524', '#b9542a', '#ef8f45', '#ffe0a0'] };
LUTS.cp = buildLUT(CMAPS.cp);
FIELDS.Cp = { name: '壓力係數', sym: 'Cp', unit: '', cmap: 'cp', log: false, sc: 1, dec: 2, cpdiv: true };
const FIELD_ORDER = ['Cp', 'P', 'T', 'Tt', 'M', 'V', 'rho'];
const COMPN = { wing: '機翼', htail: '水平尾翼', vtail: '垂直尾翼', fus: '機身', nac: '引擎短艙' };

/* ---------- 預設工況 ---------- */
const PRESETS = {
  airliner: [
    { k: 'to', name: '起飛', h: 0, M: 0.22, flaps: 'to', gear: true, thrMode: 'max', ab: false, n: 1 },
    { k: 'clb', name: '爬升', h: 4000, M: 0.52, flaps: 'up', gear: false, thrMode: 'max', n: 1 },
    { k: 'crz', name: '巡航', h: 11000, M: 0.78, flaps: 'up', gear: false, thrMode: 'level', n: 1 },
    { k: 'hs', name: '高速巡航', h: 10000, M: 0.85, flaps: 'up', gear: false, thrMode: 'level', n: 1 },
    { k: 'app', name: '進場', h: 450, M: 0.21, flaps: 'ld', gear: true, thrMode: 'level', n: 1 },
  ],
  interceptor: [
    { k: 'to', name: '起飛', h: 0, M: 0.27, flaps: 'to', gear: true, thrMode: 'max', ab: true, n: 1 },
    { k: 'crz', name: '亞音速巡航', h: 11000, M: 0.9, flaps: 'up', gear: false, thrMode: 'level', ab: false, n: 1 },
    { k: 'dash', name: '超音速衝刺', h: 11000, M: 1.8, flaps: 'up', gear: false, thrMode: 'level', ab: true, n: 1 },
    { k: 'zoom', name: '高空攔截', h: 16000, M: 2.0, flaps: 'up', gear: false, thrMode: 'max', ab: true, n: 1 },
    { k: 'app', name: '進場', h: 450, M: 0.25, flaps: 'ld', gear: true, thrMode: 'level', ab: false, n: 1 },
  ],
  fighter: [
    { k: 'to', name: '起飛', h: 0, M: 0.25, flaps: 'to', gear: true, thrMode: 'max', ab: true, n: 1 },
    { k: 'crz', name: '亞音速巡航', h: 10000, M: 0.85, flaps: 'up', gear: false, thrMode: 'level', ab: false, n: 1 },
    { k: 'turn', name: '持續盤旋 5 g', h: 5000, M: 0.8, flaps: 'up', gear: false, thrMode: 'max', ab: true, n: 5 },
    { k: 'dash', name: '超音速衝刺', h: 11000, M: 1.6, flaps: 'up', gear: false, thrMode: 'level', ab: true, n: 1 },
    { k: 'app', name: '進場', h: 450, M: 0.24, flaps: 'ld', gear: true, thrMode: 'level', ab: false, n: 1 },
  ],
};
const DEFAULT_PRESET = { airliner: 'crz', interceptor: 'crz', fighter: 'crz' };
const GEO_RANGES = {
  airliner: { fusL: [28, 60, 0.1], fusD: [3.0, 6.5, 0.05], wS: [80, 240, 1], wB: [26, 56, 0.1], wSweep: [0, 40, 0.5], wTaper: [0.15, 0.6, 0.01], wTcR: [0.09, 0.18, 0.005], wX: [0.26, 0.46, 0.005], wZ: [-0.7, 0.7, 0.05], wDih: [-4, 9, 0.5], hS: [14, 60, 0.5], vS: [10, 45, 0.5], engY: [0.24, 0.46, 0.01] },
  interceptor: { fusL: [12, 22, 0.1], fusD: [1.3, 2.4, 0.02], wS: [14, 42, 0.5], wB: [5.5, 12, 0.05], wSweep: [20, 60, 0.5], wTaper: [0.1, 0.6, 0.01], wTcR: [0.03, 0.08, 0.002], wX: [0.36, 0.56, 0.005], wZ: [-0.6, 0.6, 0.05], wDih: [-8, 6, 0.5], hS: [3, 10, 0.1], vS: [3, 8, 0.1] },
  fighter: { fusL: [12, 20, 0.1], fusD: [1.3, 2.3, 0.02], wS: [18, 45, 0.5], wB: [7, 13, 0.05], wSweep: [20, 55, 0.5], wTaper: [0.1, 0.6, 0.01], wTcR: [0.03, 0.08, 0.002], wX: [0.32, 0.5, 0.005], wZ: [-0.6, 0.6, 0.05], wDih: [-8, 6, 0.5], hS: [3, 10, 0.1], vS: [3, 8, 0.1] },
};
const GEO_LABEL = {
  fusL: ['機身長度', 'L', 'm', 1], fusD: ['機身直徑', 'D', 'm', 2], wS: ['機翼面積', 'S', 'm²', 1], wB: ['翼展', 'b', 'm', 2], wSweep: ['前緣後掠角', 'Λ', '°', 1], wTaper: ['梢根比', 'λ', '', 2],
  wTcR: ['翼根厚度比', 't/c', '', 3], wX: ['機翼前後位置', 'x/L', '', 3], wZ: ['機翼上下位置', 'z/R', '', 2], wDih: ['上反角', 'Γ', '°', 1], hS: ['水平尾翼面積', 'S_h', 'm²', 1], vS: ['垂直尾翼面積', 'S_v', 'm²', 1], engY: ['引擎展向位置', 'y/(b/2)', '', 2],
};
const ENG_RANGES = { hbtf: { mdot: [200, 600, 5], bpr: [3, 12, 0.1], Tt4max: [1400, 1900, 10] }, tj: { mdot: [50, 120, 1], Tt4max: [1100, 1500, 10] }, lbtf: { mdot: [70, 160, 1], fpr: [2.4, 5, 0.05], Tt4max: [1450, 2000, 10] } };
const MBUCKETS = [0, 0.2, 0.35, 0.5, 0.6, 0.68, 0.74, 0.78, 0.82, 0.85];
const bucketOf = M => { const m = Math.min(Math.max(M, 0), 0.85); let b = 0; for (const q of MBUCKETS) if (Math.abs(q - m) < Math.abs(b - m) - 1e-9) b = q; return b; };

const S = {
  type: 'airliner', field: 'Cp', mode: 'panel', geo: {}, eng: {}, preset: null,
  h: 11000, M: 0.78, n: 1, thrMode: 'level', thr: 0.9, ab: false, flaps: 'up', gear: false,
  fuelFrac: 0.8, payload: 15000, cg: 0.25, res: 'medium',
  slice: 'x', sy: 0, sz: null, sx: null, cut: true, xray: false, particles: 1200, pcolor: 'white', anim: 1, contours: true, labels: true, lock: false,
  spanEta: 0.45, probeMin: window.innerWidth < 760, mis: null,
};
const CUR = { ac: null, set: null, areas: null, disp: null, dmap: null, deck: null, ctx: null, eng: null, geomKey: '', pa: null, paCache: new Map(), pend: null, G: null, R: null, cal: null, lastTrim: null, labels: [], range: null, pin: null };

function resetType(t) {
  S.type = t; const T = AIRCRAFT_TYPES[t];
  S.geo = {}; S.eng = { Tt7: T.engine === 'lbtf' ? 2100 : 2000 };
  S.fuelFrac = T.p.fuelFrac; S.payload = T.p.payload; S.cg = T.p.cg;
  S.mis = Object.assign({}, T.mission);
  S.sy = 0; S.sx = null; S.sz = null;
  applyPreset(DEFAULT_PRESET[t], true);
}
function applyPreset(k, silent) {
  const p = PRESETS[S.type].find(q => q.k === k); if (!p) return;
  S.h = p.h; S.M = p.M; S.flaps = p.flaps; S.gear = p.gear; S.thrMode = p.thrMode; S.ab = !!p.ab && AIRCRAFT_TYPES[S.type].internal; S.n = p.n || 1; S.preset = k;
  if (!silent) { refreshControls(); request('cond', true); }
}
const G = () => Object.assign({}, AIRCRAFT_TYPES[S.type].p, S.geo);

/* ---------- 控制元件 ---------- */
const CTRLS = [];
function mkSlider(o) {
  const id = o.id, inp = el('input', { type: 'range', id, min: o.min, max: o.max, step: o.step });
  const out = el('output', { for: id }), sub = o.sub ? el('div', { class: 'sub' }) : null;
  const wrap = el('div', { class: 'ctl' }, el('label', { for: id, html: o.label + (o.sym ? `<span class="sym">${o.sym}</span>` : '') }), out, inp, sub);
  const c = { o, inp, out, sub, wrap };
  const setP = () => inp.style.setProperty('--p', (inp.value - inp.min) / (inp.max - inp.min) * 100 + '%');
  c.refresh = () => {
    inp.min = typeof o.min === 'function' ? o.min() : o.min; inp.max = typeof o.max === 'function' ? o.max() : o.max;
    inp.value = o.get(); out.textContent = o.fmt(+inp.value); setP();
    if (sub) sub.textContent = o.sub();
    const dis = o.disabled ? o.disabled() : false; inp.disabled = dis; wrap.classList.toggle('dis', dis);
  };
  inp.addEventListener('input', () => {
    o.set(+inp.value); out.textContent = o.fmt(+inp.value); setP();
    if (o.flight) { S.preset = null; updatePresetButtons(); }
    if (!o.lazy) request(o.level || 'cond', false);
  });
  inp.addEventListener('change', () => request(o.level || 'cond', true));
  CTRLS.push(c);
  return wrap;
}
function mkSwitch(o) {
  const inp = el('input', { type: 'checkbox', id: o.id });
  const lab = el('label', { class: 'sw' + (o.cls ? ' ' + o.cls : ''), for: o.id }, el('span', { html: o.label }), inp);
  const c = { o, inp, wrap: lab, refresh: () => { inp.checked = !!o.get(); const d = o.disabled ? o.disabled() : false; inp.disabled = d; lab.style.opacity = d ? 0.45 : ''; } };
  inp.addEventListener('change', () => { o.set(inp.checked); if (o.flight) { S.preset = null; updatePresetButtons(); } request(o.level || 'cond', true); });
  CTRLS.push(c); return lab;
}
function mkSelect(o) {
  const sel = el('select', { id: o.id });
  for (const [v, t] of o.options) sel.append(el('option', { value: v }, t));
  const wrap = el('div', { class: 'ctl' }, el('label', { for: o.id, html: o.label }), sel);
  const c = { o, inp: sel, wrap, refresh: () => { sel.value = o.get(); sel.disabled = o.disabled ? o.disabled() : false; } };
  sel.addEventListener('change', () => { o.set(sel.value); if (o.flight) { S.preset = null; updatePresetButtons(); } request(o.level || 'cond', true); });
  CTRLS.push(c); return wrap;
}
function grp(title, en, ...kids) { return el('section', { class: 'grp' }, el('h3', { html: `${title}<small>${en}</small>` }), ...kids); }
function updatePresetButtons() { for (const b of document.querySelectorAll('.presets.pre button')) b.setAttribute('aria-pressed', b.dataset.k === S.preset ? 'true' : 'false'); }

function sliceExt() {
  const ac = CUR.ac; if (!ac) return null;
  const L = ac.fus.L, b = ac.ref.b, Yh = Math.max(0.64 * b, 0.32 * L);
  return { L, b, Yh, x0: -0.2 * L, x1: 1.34 * L, Zy: 0.27 * L, Zx: 0.5 * Yh };
}
function buildRack() {
  CTRLS.length = 0;
  const rack = $('#rack'); rack.innerHTML = '';
  const T = AIRCRAFT_TYPES[S.type], et = T.engine, E = ENGINE_TYPES[et], ER = ENG_RANGES[et], GR = GEO_RANGES[S.type];
  if (S.mode === 'cfd') rack.append(grp('3D CFD 求解器', 'EULER · GPU',
    el('p', { class: 'note' }, '以面元法配平攻角、平尾偏轉與目前引擎工作點（進氣吸入、噴流出口）為邊界條件；表面壓力積分得 C_L、C_m 與壓力阻力（含波阻、誘導阻力，不含摩擦）'),
    el('div', { class: 'presets' }, el('button', { onclick: () => { CFD3.running = !CFD3.running; CFD3.conv = false; refreshControls(); updateSolverBar(); } }, CFD3.running ? '暫停求解' : '繼續求解'), el('button', { onclick: () => { CFD3.build(); CFD3.running = true; paintAll(); drawCfdCard(); updateSolverBar(); } }, '重新起始')),
    mkSelect({ id: 'cfdg', label: '網格', options: Object.entries(CFD_GRIDS).map(([k, v]) => [k, `${v.label}（約 ${fmtN(v.cells / 1e4)} 萬格）`]), get: () => CFD3.level, set: v => { CFD3.level = v; CFD3.build(); CFD3.running = true; }, level: 'none' }),
    mkSlider({ id: 'cfdcfl', label: 'CFL 數', min: 0.3, max: 0.9, step: 0.05, get: () => CFD3.cfl, set: v => { CFD3.cfl = v; if (CFD3.solver) CFD3.solver.opt.cfl = v; }, fmt: v => v.toFixed(2), level: 'none' }),
    mkSelect({ id: 'cfdo', label: '空間精度', options: [['2', '二階（MUSCL）'], ['1', '一階（較穩健）']], get: () => String(CFD3.order), set: v => { CFD3.order = +v; if (CFD3.solver) { CFD3.solver.opt.order = +v; CFD3.conv = false; } }, level: 'none' }),
  ));
  const pres = el('div', { class: 'presets pre' });
  for (const p of PRESETS[S.type]) pres.append(el('button', { 'data-k': p.k, onclick: () => applyPreset(p.k) }, p.name));
  const Mmax = T.internal ? Math.min(2.4, T.limits.Mmo + 0.2) : 0.95, hmax = Math.round(T.limits.hmax * 1.25 / 500) * 500;
  rack.append(grp('飛行條件', 'FLIGHT', pres,
    mkSlider({ id: 'h', label: '氣壓高度', sym: 'h', min: 0, max: hmax, step: 50, get: () => S.h, set: v => S.h = v, fmt: v => fmtN(v) + ' m', flight: true, sub: () => `${fmtN(S.h * 3.28084)} ft · ISA ${fmtN(isa(S.h).T - 273.15, 1)} °C · ${fmtN(isa(S.h).P / 1000, 1)} kPa` }),
    mkSlider({ id: 'M', label: '飛行馬赫數', sym: 'M∞', min: 0, max: Mmax, step: 0.005, get: () => S.M, set: v => S.M = v, fmt: v => v.toFixed(3), flight: true, sub: () => { const a = isa(S.h).a, V = S.M * a; return `TAS ${fmtN(V)} m/s（${fmtN(V * 1.94384)} kt）· CAS ${fmtN(casFromTas(V, S.h) * 1.94384)} kt`; } }),
    mkSlider({ id: 'n', label: '負載因數', sym: 'n', min: 1, max: T.limits.nmax, step: 0.1, get: () => S.n, set: v => S.n = v, fmt: v => v.toFixed(1) + ' g', flight: true, sub: () => S.n > 1.01 ? `水平盤旋坡度 ${fmtN(Math.acos(1 / S.n) / DEG, 1)}°` : '直線平飛' }),
    mkSelect({ id: 'thrMode', label: '油門模式', options: [['level', '平飛配平（推力 = 阻力）'], ['max', '最大推力'], ['manual', '手動']], get: () => S.thrMode, set: v => S.thrMode = v, flight: true }),
    mkSlider({ id: 'thr', label: '油門 Tt4 / Tt4,max', min: 0.4, max: 1, step: 0.005, get: () => S.thrMode === 'manual' ? S.thr : (CUR.R && CUR.R.r ? Math.min(1, CUR.R.r.thr) : S.thr), set: v => S.thr = v, fmt: v => (v * 100).toFixed(1) + ' %', flight: true, disabled: () => S.thrMode !== 'manual', sub: () => S.thrMode === 'level' ? '由平飛條件自動求得' : S.thrMode === 'max' ? '最大推力（轉速上限 105 %）' : '' }),
    T.internal ? mkSwitch({ id: 'ab', label: '後燃器', cls: 'ab', get: () => S.ab, set: v => S.ab = v, flight: true }) : null,
    el('div', { class: 'row2' },
      mkSelect({ id: 'flaps', label: '襟翼', options: [['up', '收起'], ['to', '起飛'], ['ld', '降落']], get: () => S.flaps, set: v => S.flaps = v, flight: true }),
      mkSelect({ id: 'gear', label: '起落架', options: [['0', '收起'], ['1', '放下']], get: () => S.gear ? '1' : '0', set: v => S.gear = v === '1', flight: true })),
  ));
  const mW = T.p.MTOW - T.p.OEW;
  rack.append(grp('重量與重心', 'MASS · CG',
    mkSlider({ id: 'fuel', label: '燃油', min: 0, max: 1, step: 0.01, get: () => S.fuelFrac, set: v => S.fuelFrac = v, fmt: v => `${fmtN(v * CUR.acP().fuelMax)} kg`, level: 'mass', sub: () => `油箱容量 ${fmtN(CUR.acP().fuelMax)} kg（${fmtN(S.fuelFrac * 100)} %）` }),
    mkSlider({ id: 'pay', label: '酬載', min: 0, max: Math.round(mW * 0.8 / 100) * 100, step: 100, get: () => S.payload, set: v => S.payload = v, fmt: v => `${fmtN(v)} kg`, level: 'mass', sub: () => { const W = weight(); return `總重 ${fmtN(W)} kg · 最大起飛重量 ${fmtN(CUR.acP().MTOW)} kg`; } }),
    mkSlider({ id: 'cg', label: '重心位置', sym: 'x_cg', min: 0.05, max: 0.45, step: 0.01, get: () => S.cg, set: v => S.cg = v, fmt: v => (v * 100).toFixed(0) + ' % MAC', level: 'mass', sub: () => CUR.cal ? `中性點 ${(CUR.cal.xnp * 100).toFixed(1)} % MAC` : '' }),
  ));
  const geo = [el('p', { class: 'note' }, '放開滑桿後重建面元網格並重新求解（約 1–3 秒）；外形為通用設計，非特定真實機型')];
  for (const k in GR) {
    const [lab, sym, unit, dec] = GEO_LABEL[k], R = GR[k];
    geo.push(mkSlider({ id: 'g_' + k, label: lab, sym, min: R[0], max: R[1], step: R[2], lazy: true, level: 'geom', get: () => G()[k], set: v => { S.geo[k] = v; if (k === 'wTcR') S.geo.wTcT = v * T.p.wTcT / T.p.wTcR; }, fmt: v => v.toFixed(dec) + (unit ? ' ' + unit : ''),
      sub: k === 'wB' ? () => `展弦比 A = ${(G().wB ** 2 / G().wS).toFixed(2)}` : k === 'fusD' && T.internal ? () => CUR.ac ? `實際 ${CUR.ac.p.fusD.toFixed(2)} m（需容納引擎）` : '' : null }));
  }
  geo.push(el('div', null, el('button', { class: 'btn', onclick: () => { S.geo = {}; refreshControls(); request('geom', true); } }, '恢復預設尺寸')));
  rack.append(grp('機體尺寸', 'GEOMETRY', ...geo));
  const d0 = E.design, ed = k => (S.eng[k] !== undefined ? S.eng[k] : d0[k]);
  const eg = [el('p', { class: 'note' }, `${E.label}（${E.short}）× ${T.nEng}，${T.internal ? '裝於機身尾段' : '裝於翼下短艙'}；改變後重新計算循環與幾何`)];
  eg.push(mkSlider({ id: 'e_mdot', label: '設計空氣流量', sym: 'ṁ', min: ER.mdot[0], max: ER.mdot[1], step: ER.mdot[2], lazy: true, level: 'geom', get: () => ed('mdot'), set: v => S.eng.mdot = v, fmt: v => fmtN(v) + ' kg/s', sub: () => `引擎尺寸比例 ${Math.sqrt(ed('mdot') / d0.mdot).toFixed(2)}` }));
  if (ER.bpr) eg.push(mkSlider({ id: 'e_bpr', label: '涵道比', sym: 'α', min: ER.bpr[0], max: ER.bpr[1], step: ER.bpr[2], lazy: true, level: 'geom', get: () => ed('bpr'), set: v => S.eng.bpr = v, fmt: v => v.toFixed(1) }));
  if (ER.fpr) eg.push(mkSlider({ id: 'e_fpr', label: '風扇壓比', sym: 'π_f', min: ER.fpr[0], max: ER.fpr[1], step: ER.fpr[2], lazy: true, level: 'geom', get: () => ed('fpr'), set: v => S.eng.fpr = v, fmt: v => v.toFixed(2) }));
  eg.push(mkSlider({ id: 'e_t4', label: '最大渦輪入口溫度', sym: 'Tt4,max', min: ER.Tt4max[0], max: ER.Tt4max[1], step: ER.Tt4max[2], lazy: true, level: 'geom', get: () => ed('Tt4max'), set: v => S.eng.Tt4max = v, fmt: v => fmtN(v) + ' K' }));
  if (E.hasAB) eg.push(mkSlider({ id: 'e_t7', label: '後燃器出口總溫', sym: 'Tt7', min: 1700, max: 2300, step: 10, lazy: true, level: 'geom', get: () => S.eng.Tt7, set: v => S.eng.Tt7 = v, fmt: v => fmtN(v) + ' K' }));
  rack.append(grp('引擎', 'ENGINE', ...eg));
  const ext = () => sliceExt() || { Yh: 20, Zy: 10, Zx: 10, x0: 0, x1: 1 };
  rack.append(grp('計算與顯示', 'SOLVER · VIEW',
    mkSelect({ id: 'res', label: '面元網格', options: [['coarse', '粗（約 700 面元）'], ['medium', '中（約 1,400 面元）'], ['fine', '細（約 2,300 面元）']], get: () => S.res, set: v => S.res = v, level: 'geom' }),
    mkSelect({ id: 'slice', label: '流場剖面', options: [['y', '縱向剖面（x–z，y 固定）'], ['z', '水平剖面（x–y，z 固定）'], ['x', '橫截面（y–z，x 固定）'], ['off', '關閉']], get: () => S.slice, set: v => S.slice = v, level: 'slice' }),
    mkSlider({ id: 'spos', label: '剖面位置', min: () => S.slice === 'y' ? 0 : S.slice === 'z' ? -ext().Zx : 0, max: () => S.slice === 'y' ? +(ext().Yh * 0.95).toFixed(2) : S.slice === 'z' ? +ext().Zx.toFixed(2) : 1, step: 0.01, lazy: true, level: 'slice',
      get: () => S.slice === 'y' ? S.sy : S.slice === 'z' ? sliceZ() : sliceXf(), set: v => { if (S.slice === 'y') S.sy = v; else if (S.slice === 'z') S.sz = v; else S.sx = v; },
      fmt: v => S.slice === 'x' ? `x = ${fmtN(lerp(ext().x0, ext().x1, v), 1)} m` : S.slice === 'y' ? `y = ${v.toFixed(2)} m` : `z = ${v.toFixed(2)} m`, disabled: () => S.slice === 'off' }),
    el('div', { class: 'presets', id: 'sliceBtns' }),
    mkSwitch({ id: 'cut', label: '沿剖面剖開機體', get: () => S.cut, set: v => S.cut = v, level: 'view' }),
    mkSwitch({ id: 'xray', label: '透視機體（顯示裝機引擎）', get: () => S.xray, set: v => S.xray = v, level: 'view' }),
    mkSlider({ id: 'np', label: '流線數量', min: 0, max: 5000, step: 100, get: () => S.particles, set: v => S.particles = v, fmt: v => fmtN(v), level: 'view' }),
    mkSelect({ id: 'pcol', label: '流線著色', options: [['white', '白色（噴流為暖色）'], ['field', '依場變數']], get: () => S.pcolor, set: v => S.pcolor = v, level: 'none' }),
    mkSlider({ id: 'anim', label: '動畫速度', min: 0, max: 3, step: 0.1, get: () => S.anim, set: v => S.anim = v, fmt: v => v === 0 ? '暫停' : v.toFixed(1) + '×', level: 'none' }),
    mkSwitch({ id: 'swC', label: '等值線', get: () => S.contours, set: v => S.contours = v, level: 'paint' }),
    mkSwitch({ id: 'swL', label: '元件標籤', get: () => S.labels, set: v => S.labels = v, level: 'none' }),
    mkSwitch({ id: 'swK', label: '鎖定色階範圍', get: () => S.lock, set: v => S.lock = v, level: 'paint' }),
  ));
  const m = S.mis;
  const mg = [
    mkSlider({ id: 'm_rng', label: '任務航程', min: T.internal ? 300 : 800, max: T.internal ? 2500 : 6000, step: 50, get: () => m.range, set: v => m.range = v, fmt: v => fmtN(v) + ' km', level: 'mission', lazy: true }),
    mkSlider({ id: 'm_h', label: '巡航高度', min: 3000, max: T.limits.hmax, step: 250, get: () => m.cruiseH, set: v => m.cruiseH = v, fmt: v => fmtN(v) + ' m', level: 'mission', lazy: true }),
    mkSlider({ id: 'm_M', label: '巡航馬赫數', min: 0.5, max: T.internal ? 0.95 : 0.86, step: 0.01, get: () => m.cruiseM, set: v => m.cruiseM = v, fmt: v => v.toFixed(2), level: 'mission', lazy: true }),
  ];
  if (T.internal) {
    mg.push(mkSlider({ id: 'm_d', label: '超音速衝刺距離', min: 0, max: 400, step: 10, get: () => m.dash, set: v => m.dash = v, fmt: v => fmtN(v) + ' km', level: 'mission', lazy: true }));
    mg.push(mkSlider({ id: 'm_dM', label: '衝刺馬赫數', min: 1.1, max: Math.min(2.2, T.limits.Mmo), step: 0.05, get: () => m.dashM, set: v => m.dashM = v, fmt: v => v.toFixed(2), level: 'mission', lazy: true }));
  }
  rack.append(grp('任務剖面', 'MISSION', el('p', { class: 'note' }, '以目前重量、燃油與機型計算；結果見下方任務剖面圖'), ...mg));
  refreshControls();
}
function sliceXf() { if (S.sx == null && CUR.ac) { const e = sliceExt(), w = CUR.ac.wing; S.sx = +((w.xLE(w.semi) + w.ct + 0.05 * e.L - e.x0) / (e.x1 - e.x0)).toFixed(3); } return S.sx == null ? 0.55 : S.sx; }
function sliceZ() { if (S.sz == null && CUR.ac) { const w = CUR.ac.wing; S.sz = +w.pt(0.55 * w.semi, 0.4, 0, 0)[2].toFixed(2); } return S.sz || 0; }
function refreshControls() {
  for (const c of CTRLS) c.refresh();
  updatePresetButtons();
  const sb = $('#sliceBtns'); if (!sb) return;
  const ac = CUR.ac, btns = [];
  if (ac && S.slice === 'y') { btns.push(['對稱面', () => S.sy = 0]); if (!ac.T.internal) btns.push(['引擎中心線', () => S.sy = +ac.engines[0].y.toFixed(2)]); btns.push(['翼中段', () => S.sy = +(0.5 * ac.wing.semi).toFixed(2)]); btns.push(['翼尖外', () => S.sy = +(ac.wing.semi * 1.05).toFixed(2)]); }
  if (ac && S.slice === 'x') { const e = sliceExt(), f = x => (x - e.x0) / (e.x1 - e.x0); const w = ac.wing, xm = w.xLE(w.sMac) + 0.5 * w.mac; btns.push(['機翼弦中', () => S.sx = f(xm)]); btns.push(['機翼後緣後', () => S.sx = f(w.xLE(w.semi) + w.ct + 0.08 * e.L)]); btns.push(['尾翼後', () => S.sx = f(ac.fus.L + 0.12 * e.L)]); }
  if (ac && S.slice === 'z') { btns.push(['機翼平面', () => { S.sz = null; sliceZ(); }]); if (!ac.T.internal) btns.push(['引擎軸線', () => S.sz = +ac.engines[0].z.toFixed(2)]); btns.push(['機身軸線', () => S.sz = 0]); }
  sb.innerHTML = '';
  for (const [t, f] of btns) sb.append(el('button', { onclick: () => { f(); refreshControls(); request('slice', true); } }, t));
}

/* ---------- 排程 ---------- */
const LV = { none: 0, view: 1, paint: 2, cond: 3, slice: 4, mass: 5, mission: 5, geom: 7 };
let pend = null, raf = 0, dragging = false;
function request(level, hi) {
  if (!pend) pend = { level: 0, hi: false, mission: false, slice: false };
  pend.level = Math.max(pend.level, LV[level] || 0); pend.hi = pend.hi || hi;
  if (level === 'mission' || level === 'mass') pend.mission = true;
  if (level === 'slice') pend.slice = true;
  if (!raf) raf = requestAnimationFrame(runPending);
}
document.addEventListener('pointerdown', e => { if (e.target && e.target.type === 'range') dragging = true; });
document.addEventListener('pointerup', () => { if (dragging) { dragging = false; request('cond', true); } });
function runPending() {
  raf = 0; const p = pend; pend = null; if (!p) return;
  const final = p.hi && !dragging;
  if (p.level >= LV.geom) { rebuildGeometry(); return; }
  if (p.level >= LV.mass && CUR.ac) { applyMass(); invalidatePerf(true); }
  else if (p.mission) invalidatePerf(false);
  if (p.slice || p.level >= LV.slice) setupSlice();
  if (p.level >= LV.view) applyView();
  if (p.level >= LV.cond) updateCondition(final);
  else if (p.level >= LV.paint) paintAll();
  refreshControls();
}

/* ============================================================
 *  幾何與引擎
 * ============================================================ */
CUR.acP = () => Object.assign({}, AIRCRAFT_TYPES[S.type].p, S.geo);
function weight() { const p = CUR.acP(); return p.OEW + S.payload + S.fuelFrac * p.fuelMax; }
function engineParams() {
  const T = AIRCRAFT_TYPES[S.type], et = T.engine, E = ENGINE_TYPES[et];
  const design = Object.assign({}, E.design); for (const k of ['mdot', 'bpr', 'fpr', 'Tt4max']) if (S.eng[k] !== undefined) design[k] = S.eng[k];
  return { type: et, design, eff: Object.assign({}, DEFAULT_EFF), alt: 0, M0: 0, thr: 1, ab: false, Tt7: S.eng.Tt7 || 2000, nozzleType: E.nozzle };
}
function applyMass() { const ac = CUR.ac; if (!ac) return; ac.ref.xcg = ac.wing.xMac + S.cg * ac.wing.mac; ac.mass.payload = S.payload; ac.mass.fuel = S.fuelFrac * ac.mass.fuelMax; ac.mass.W = weight(); CUR.lastTrim = null; }
function rebuildGeometry() {
  const t0 = performance.now();
  const T = AIRCRAFT_TYPES[S.type], P = engineParams(), E = ENGINE_TYPES[P.type];
  const ekey = JSON.stringify(P.design) + P.Tt7;
  if (!CUR.eng || CUR.eng.key !== S.type + ekey) {
    const sol = solveEngine(P), nz = sol.op.noz;
    const spec = buildSpec(P.type, Math.sqrt(P.design.mdot / E.design.mdot), { r8: Math.sqrt(nz.Athroat / Math.PI), r9: Math.sqrt(Math.max(nz.A, nz.Athroat) / Math.PI), A9: sol.ref.noz && sol.ref.noz.A, A19: sol.ref.nozB && sol.ref.nozB.A });
    CUR.eng = { key: S.type + ekey, P, sol, spec, deck: new EngineDeck(P.type, P.design, P.eff, { Tt7: P.Tt7, nozzleType: P.nozzleType }) };
  }
  const ac = buildAircraft(S.type, S.geo, CUR.eng);
  const set = aircraftPanels(ac, S.res), areas = aircraftAreas(ac, set), disp = aircraftPanels(ac, 'display');
  Object.assign(CUR, { ac, set, areas, disp, deck: CUR.eng.deck, dmap: surfaceMap(disp, set), G: new AirGeom(ac), ctx: null, cal: null, pa: null, lastTrim: null, R: null });
  if (CUR.pend) { CUR.pend.pa.solver.cancel = true; CUR.pend = null; }
  CUR.paCache.clear();
  CUR.geomKey = S.type + '|' + S.res + '|' + JSON.stringify(S.geo) + '|' + CUR.eng.key;
  applyMass();
  // 顯示特殊面元（引擎進氣面、出口面）
  const sp = ac.spec, exB = sp.exitsGeom.find(g => g.key === 'bypass'), exC = sp.exitsGeom.find(g => g.key !== 'bypass');
  CUR.dSpecial = disp.P.map(p => {
    if (!p.vn) return null;
    if (p.comp === 'fus') return 'core';
    const e = ac.engines[0], xe = p.cen[0] - e.x0;
    if (p.vn < 0) return 'in';
    return exB && Math.abs(xe - exB.x) < Math.abs(xe - exC.x) ? 'byp' : 'core';
  });
  buildAirMesh(disp); buildEngineGroups(ac); CHT.strips = null;
  R3.floor.position.y = -0.32 * ac.fus.L;
  setupSlice(); setupGrid3();
  invalidatePerf(true);
  CUR.geoT = performance.now() - t0;
  ensureAero(true);
  updateCondition(true);
  if (S.mode === 'cfd') { CFD3.build(); CFD3.running = true; }
  applyView();
  refreshControls();
  showProbe(CUR.pin, false);
}

/* ---------- 面元解（依馬赫數分組，分時組裝） ---------- */
function ensureAero(final) {
  if (!CUR.ac) return;
  const Mb = bucketOf(S.M), key = CUR.geomKey + '|' + Mb;
  if (CUR.paCache.has(key)) { const pa = CUR.paCache.get(key); if (CUR.pa !== pa) { CUR.pa = pa; CUR.lastTrim = null; onNewPa(pa); } return; }
  // 暫用最接近的已完成解
  let best = null; for (const [k, pa] of CUR.paCache) if (k.startsWith(CUR.geomKey + '|') && (!best || Math.abs(pa.Mp - Mb) < Math.abs(best.Mp - Mb))) best = pa;
  if (best && CUR.pa !== best) { CUR.pa = best; CUR.lastTrim = null; onNewPa(best); }
  if (CUR.pend && CUR.pend.key === key) return;
  if (!final && CUR.pa) return; // 拖曳中不啟動新組裝
  if (CUR.pend) { CUR.pend.pa.solver.cancel = true; CUR.pend = null; }
  const pa = new PanelAero(CUR.ac, CUR.set, Mb), job = { key, pa, prog: 0, t0: performance.now(), geomKey: CUR.geomKey };
  CUR.pend = job; updateSolverBar();
  pa.prepareAsync(p => { job.prog = p; updateSolverBar(); }).then(() => {
    if (CUR.pend === job) CUR.pend = null;
    if (job.geomKey !== CUR.geomKey) return;
    job.dt = performance.now() - job.t0; pa.prepT = job.dt;
    CUR.paCache.set(key, pa);
    if (CUR.paCache.size > 4) { for (const k of CUR.paCache.keys()) { if (k !== key && CUR.paCache.get(k) !== CUR.pa) { CUR.paCache.delete(k); break; } } }
    if (!CUR.ctx) calibrate(pa);
    if (bucketOf(S.M) === Mb || !CUR.pa) { CUR.pa = pa; CUR.lastTrim = null; onNewPa(pa); }
    updateCondition(true); updateSolverBar();
  }).catch(() => { if (CUR.pend === job) CUR.pend = null; updateSolverBar(); });
}
function onNewPa(pa) { if (SL.pts) SL.job = new PertJob(pa, SL.pts, SL.skip); if (G3.pts) G3.job = new PertJob(pa, G3.pts, G3.skip); SL.painted = 0; }
/* 以面元法校正工程估算：升力線斜率、展向效率、配平阻力 */
function calibrate(pa) {
  const ac = CUR.ac, m = ac.T.mission, at = isa(m.cruiseH), q = 0.5 * at.rho * (m.cruiseM * at.a) ** 2;
  const CL = Math.min(0.9, weight() * G0 / (q * ac.ref.S));
  const tr = pa.trim(CL);
  const kA = tr.CLa / liftSlope(ac, pa.Mp);
  const CLt = tr.r.byc.htail || 0, trimK = Math.min(0.2, (CLt / CL) ** 2 * ac.ref.S / (Math.PI * ac.htail.A * 0.9 * ac.htail.S));
  CUR.cal = { kA, e: tr.r.e, trimK, CLa: tr.CLa, Cma: tr.Cma, xnp: S.cg - tr.Cma / tr.CLa, Mp: pa.Mp };
  CUR.ctx = new PerfCtx(ac, CUR.areas, CUR.deck, { kA, eInv: Math.min(0.98, tr.r.e), trimK });
  invalidatePerf(true);
}

/* ============================================================
 *  工況計算（每次參數變動）
 * ============================================================ */
const PLAIN = ['Cp', 'P', 'T', 'Tt', 'Pt', 'M', 'V', 'rho', 'Taw'];
function updateCondition(final) {
  const ac = CUR.ac; if (!ac) return;
  ensureAero(final);
  const W = weight(), fs = fsState(S.h, S.M), T = ac.T, R = { W, fs, warn: [] };
  const ctx = CUR.ctx, pa = CUR.pa;
  // 性能點
  const thr = S.thrMode === 'level' ? 'level' : S.thrMode === 'max' ? 1 : S.thr;
  const ab = S.ab && T.internal;
  if (ctx && fs.V > 1) {
    R.r = ctx.point(S.h, S.M, W, { thr, ab, n: S.n, flaps: S.flaps, gear: S.gear });
    R.op = CUR.deck.at(S.h, S.M, Math.min(1, R.r.thr), ab);
  } else R.op = CUR.deck.at(S.h, S.M, S.thrMode === 'manual' ? S.thr : 1, ab);
  // 引擎場模型（目前工作點）
  try { R.fm = new FieldModel(ac.spec, { op: R.op.op, fl: flightState(S.h, S.M), ref: CUR.deck.ref }, CUR.deck.p(S.h, S.M, R.op.op.thr || 1, ab)); } catch (e) { R.fm = null; }
  // 配平與表面 Cp
  if (pa && ctx && fs.V > 10) {
    const aero = T.aero, CLmax = ctx.CLmax(S.flaps), CLreq = R.r.CL;
    R.stall = CLreq > CLmax;
    const flapInc = S.flaps === 'to' ? 0.8 * aero.dClTO : S.flaps === 'ld' ? 0.8 * aero.dClLD : 0;
    R.CLp = Math.max(-0.4, Math.min(CLreq, CLmax) - flapInc);
    const guess = CUR.lastTrim && CUR.lastTrim.pa === pa ? CUR.lastTrim.tr : null;
    const tr = pa.trim(R.CLp, guess); CUR.lastTrim = { pa, tr };
    R.tr = tr;
    const a0 = tr.alpha - R.CLp / tr.CLa / DEG;
    const kA = CUR.cal ? CUR.cal.kA : 1;
    R.alpha = a0 + (tr.alpha - a0) * liftSlope(ac, pa.Mp, kA) / liftSlope(ac, S.M, kA);
    R.delta = tr.delta;
    R.sol = pa.combine(tr.alpha, tr.delta);
    R.co = pa.coeffs(R.sol, true);
    R.SM = -tr.Cma / tr.CLa;
    R.e = R.co.e;
    surfaceCp(R, pa);
  } else if (pa) {
    R.alpha = 0; R.delta = 0; R.sol = pa.combine(0, 0); R.co = pa.coeffs(R.sol, true); R.static = true;
    R.cpS = new Float32Array(pa.solver.N);
  }
  // 各面元狀態量
  if (R.cpS) {
    const N = R.cpS.length, st = {}; for (const k of PLAIN) st[k] = new Float32Array(N);
    const o = {};
    for (let k = 0; k < N; k++) { stateFromCp(fs, R.cpS[k], o); for (const q of PLAIN) st[q][k] = o[q]; }
    R.st = st;
  }
  // 引擎面（進氣面、出口）
  R.faces = engineFaces(R);
  CUR.R = R;
  warnings(R);
  if (S.mode === 'cfd' && CFD3.solver) { if (final && R.delta != null && Math.abs(R.delta - (CFD3.delta || 0)) > 3) CFD3.build(); else CFD3.applyCond(); }
  paintAll();
  updatePanels(final);
  if (S.mode === 'cfd') drawCfdCard();
}
/* 表面 Cp：M ≤ 0.85 面元法（Göthert）；M ≥ 1.15 局部傾角法；之間線性內插 */
function surfaceCp(R, pa) {
  const set = CUR.set, N = pa.solver.N, M = S.M, cpP = R.co.cp, out = new Float32Array(N);
  const lo = cpVac(Math.max(M, 0.05)), hi = cpStag(M);
  let t = 0; if (M > 0.85) t = Math.min(1, (M - 0.85) / 0.3);
  const Mli = Math.max(M, 1.15), a = R.alpha * DEG, V = [Math.cos(a), 0, Math.sin(a)], ad = (R.alpha + R.delta) * DEG, Vh = [Math.cos(ad), 0, Math.sin(ad)];
  for (let k = 0; k < N; k++) {
    const p = set.P[k];
    let c = Math.max(lo, Math.min(hi, cpP[k]));
    if (t > 0 && !p.vn) {
      const body = p.comp === 'fus' || p.comp === 'nac';
      const ci = localInclinationCp(Mli, p.n, p.comp === 'htail' ? Vh : V, body);
      c = (1 - t) * c + t * ci;
    }
    out[k] = c;
  }
  R.cpS = out; R.cpMode = t === 0 ? 'panel' : t >= 1 ? 'li' : 'blend';
}
function engineFaces(R) {
  const fm = R.fm; if (!fm) return {};
  const sp = CUR.ac.spec, s = sp.s, exB = sp.exitsGeom.find(g => g.key === 'bypass'), exC = sp.exitsGeom.find(g => g.key !== 'bypass');
  const smp = (x, r) => { const o = fm.sample(x, r, 0, {}); if (o.solid) return null; o.Cp = R.fs.q > 1 ? (o.P - R.fs.P) / R.fs.q : 0; o.Taw = o.Tt; return o; };
  const f = { in: smp(sp.lip.x + 0.06 * s, 0.6 * sp.lip.r), core: exC ? smp(exC.x - 0.02 * s, 0.5 * (exC.R + (exC.Rin || 0))) : null };
  if (exB) f.byp = smp(exB.x - 0.02 * s, 0.5 * (exB.R + exB.Rin));
  return f;
}
/* 顯示面元的某場變數值 */
function dispValues(key) {
  const R = CUR.R, D = CUR.disp, n = D.P.length, out = new Float32Array(n).fill(NaN);
  if (!R || !R.st) return out;
  const src = R.st[key], m = CUR.dmap, sp = CUR.dSpecial;
  for (let q = 0; q < n; q++) {
    if (sp[q]) { const f = R.faces[sp[q]]; out[q] = f ? f[key] : NaN; continue; }
    let v = 0, ws = 0;
    for (let j = 0; j < 4; j++) { const k = m.idx[4 * q + j]; if (k < 0) continue; v += m.w[4 * q + j] * src[k]; ws += m.w[4 * q + j]; }
    out[q] = ws > 0 ? v / ws : NaN;
  }
  return out;
}

/* ============================================================
 *  剖面（面元場點速度，三組單位解）
 * ============================================================ */
const SL = { pts: null };
function setupSlice() {
  const ac = CUR.ac; if (!ac) return;
  SL.pts = null; SL.job = null; SL.kind = S.slice;
  R3.slice.visible = R3.sliceEdge.visible = S.slice !== 'off';
  if (S.slice === 'off') { applyView(); return; }
  const e = sliceExt(), k = S.slice;
  let U, V, to3, nu, nv;
  if (k === 'y') { const y0 = S.sy; U = [e.x0, e.x1]; V = [-e.Zy, e.Zy]; to3 = (u, v) => [u, y0, v]; nu = 157; nv = 2 * Math.round(78 * e.Zy / (e.x1 - e.x0)) + 1; SL.pos = y0; }
  else if (k === 'z') { const z0 = sliceZ(); U = [e.x0, e.x1]; V = [-e.Yh, e.Yh]; to3 = (u, v) => [u, v, z0]; nu = 151; nv = 2 * Math.round(75 * e.Yh / (e.x1 - e.x0)) + 1; SL.pos = z0; }
  else { const x0 = lerp(e.x0, e.x1, sliceXf()); U = [-e.Yh, e.Yh]; V = [-e.Zx, e.Zx]; to3 = (u, v) => [x0, u, v]; nu = 121; nv = 2 * Math.round(60 * e.Zx / e.Yh) + 1; SL.pos = x0; }
  Object.assign(SL, { U, V, to3, nu, nv });
  // 場點（y ≥ 0 才計算，y < 0 取鏡像）
  const n = nu * nv, src = new Int32Array(n), sgn = new Int8Array(n), code = new Uint8Array(n), list = [];
  const du = (U[1] - U[0]) / (nu - 1), dv = (V[1] - V[0]) / (nv - 1), eo = {};
  const mapIdx = new Map();
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const g = j * nu + i, p = to3(U[0] + i * du, V[0] + j * dv);
    code[g] = CUR.G.code(p[0], p[1], p[2], eo);
    const neg = p[1] < -1e-9, key = Math.round(p[0] * 1e3) + ',' + Math.round(Math.abs(p[1]) * 1e3) + ',' + Math.round(p[2] * 1e3);
    let s = mapIdx.get(key);
    if (s === undefined) { s = list.length / 3; list.push(p[0], Math.abs(p[1]), p[2]); mapIdx.set(key, s); }
    src[g] = s; sgn[g] = neg ? -1 : 1;
  }
  const pts = new Float64Array(list), nc = pts.length / 3, skip = new Uint8Array(nc);
  for (let g = 0; g < n; g++) if (code[g]) skip[src[g]] = code[g] ? 1 : 0;
  for (let g = 0; g < n; g++) if (!code[g]) skip[src[g]] = 0;
  Object.assign(SL, { pts, skip, src, sgn, code, du, dv, painted: 0 });
  // 貼圖解析度 3×
  const TW = 3 * (nu - 1) + 1, TH = 3 * (nv - 1) + 1, tcode = new Uint8Array(TW * TH), eng = [];
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const p = to3(U[0] + tx * du / 3, V[0] + ty * dv / 3), c = CUR.G.code(p[0], p[1], p[2], eo);
    tcode[ty * TW + tx] = c;
    if (c === 3) eng.push(ty * TW + tx, eo.xe, eo.r, eo.th);
  }
  Object.assign(SL, { TW, TH, tcode, eng: Float32Array.from(eng), gval: new Float32Array(n), gx: new Float32Array(3 * n) });
  resizeTex(R3.sliceTex, TW, TH);
  setSliceGeometry(SL);
  if (CUR.pa) SL.job = new PertJob(CUR.pa, pts, skip);
  applyView();
}
/* 以目前配平組合剖面速度，疊加噴流，換算狀態 */
const _o = {}, _v = [0, 0, 0], _j = {};
function paintSlice() {
  if (!SL.pts || !CUR.R) return;
  const R = CUR.R, fs = R.fs, key = S.field, nu = SL.nu, nv = SL.nv, n = nu * nv, gval = SL.gval, gx = SL.gx, job = SL.job;
  const c = CUR.pa && R.sol ? combCoef(CUR.pa, R.sol.alpha, R.sol.delta) : null;
  const done = job ? job.i : 0, fm = R.fm, G = CUR.G, ca = Math.cos(R.alpha * DEG), sa = Math.sin(R.alpha * DEG);
  // 格點：外流速度（以 V∞ 正規化）
  for (let g = 0; g < n; g++) {
    const s = SL.src[g];
    let vx = ca, vy = 0, vz = sa;
    if (!SL.code[g] && c && job && s < done) { combVel(job.res, s, c, _v); vx = _v[0]; vy = _v[1] * SL.sgn[g]; vz = _v[2]; }
    gx[3 * g] = vx; gx[3 * g + 1] = vy; gx[3 * g + 2] = vz;
  }
  // 貼圖點：速度雙線性內插（僅外流格點）＋噴流疊加 → 狀態量
  const TW = SL.TW, TH = SL.TH, tc = SL.tcode, tv = SL.tval && SL.tval.length === TW * TH ? SL.tval : (SL.tval = new Float32Array(TW * TH));
  const engMap = new Map(); for (let q = 0; q < SL.eng.length / 4; q++) engMap.set(SL.eng[4 * q], q);
  for (let ty = 0; ty < TH; ty++) for (let tx = 0; tx < TW; tx++) {
    const t = ty * TW + tx, cc = tc[t];
    if (cc === 1 || cc === 2) { tv[t] = NaN; continue; }
    if (cc === 3) {
      const q = engMap.get(t); if (!fm || q === undefined) { tv[t] = NaN; continue; }
      const o = fm.sample(SL.eng[4 * q + 1], SL.eng[4 * q + 2], SL.eng[4 * q + 3], _o); if (o.solid) { tv[t] = NaN; continue; }
      tv[t] = key === 'Cp' ? (fs.q > 1 ? (o.P - fs.P) / fs.q : 0) : o[key]; continue;
    }
    const fx = tx / 3, fy = ty / 3, i0 = Math.min(nu - 2, Math.floor(fx)), j0 = Math.min(nv - 2, Math.floor(fy)), ux = fx - i0, uy = fy - j0;
    let wx = 0, wy = 0, wz = 0, ws = 0;
    for (let k = 0; k < 4; k++) {
      const i = i0 + (k & 1), j = j0 + (k >> 1), w = ((k & 1) ? ux : 1 - ux) * ((k >> 1) ? uy : 1 - uy), g = j * nu + i;
      if (w <= 0 || SL.code[g]) continue;
      wx += w * gx[3 * g]; wy += w * gx[3 * g + 1]; wz += w * gx[3 * g + 2]; ws += w;
    }
    if (ws > 1e-6) { wx /= ws; wy /= ws; wz /= ws; } else { wx = ca; wy = 0; wz = sa; }
    const p = SL.to3(SL.U[0] + fx * SL.du, SL.V[0] + fy * SL.dv);
    G.jetAt(fm, p[0], p[1], p[2], _j);
    stateFromVel(fs, fs.V * wx + _j.dU, fs.V * wy, fs.V * wz, _o, _j.dTt, _j.zone ? _j.P : 0);
    tv[t] = _o[key];
  }
  for (let g = 0; g < n; g++) { const i = g % nu, j = (g / nu) | 0; gval[g] = tv[3 * j * TW + 3 * i]; }
  SL.painted = done;
}
function texPaint(norm) {
  if (!SL.pts || !SL.tval) return;
  const TW = SL.TW, TH = SL.TH, tex = R3.sliceTex, data = tex.image.data, lut = LUTS[FIELDS[S.field].cmap], tc = SL.tcode, tv = SL.tval;
  const lev = new Int16Array(TW * TH).fill(-1);
  for (let t = 0; t < TW * TH; t++) {
    const c = tc[t], o = 4 * t;
    if (c === 1 || c === 2) { const h = HATCH_AIR[c], tx = t % TW, ty = (t / TW) | 0, st = ((tx + ty) % 7 === 0) ? 1.25 : 1; data[o] = h[0] * st; data[o + 1] = h[1] * st; data[o + 2] = h[2] * st; data[o + 3] = 255; continue; }
    const v = tv[t];
    if (!(v === v)) { data[o] = 30; data[o + 1] = 36; data[o + 2] = 44; data[o + 3] = 255; continue; }
    const nv = norm(v), li = Math.round(nv * 255) * 3;
    data[o] = lut[li]; data[o + 1] = lut[li + 1]; data[o + 2] = lut[li + 2]; data[o + 3] = 238;
    lev[t] = Math.floor(nv * 16);
  }
  if (S.contours) for (let ty = 0; ty < TH - 1; ty++) for (let tx = 0; tx < TW - 1; tx++) {
    const t = ty * TW + tx, l = lev[t]; if (l < 0) continue;
    const r = lev[t + 1], d = lev[t + TW];
    if ((r >= 0 && r !== l) || (d >= 0 && d !== l)) { const o = 4 * t; data[o] *= 0.66; data[o + 1] *= 0.66; data[o + 2] *= 0.66; }
  }
  tex.needsUpdate = true;
}

/* ============================================================
 *  3D 速度網格（流線粒子）
 * ============================================================ */
const G3 = { pts: null };
function setupGrid3() {
  const ac = CUR.ac, e = sliceExt();
  const nx = 52, ny = 18, nz = 20, x0 = e.x0 - 0.05 * e.L, x1 = e.x1, Y = e.Yh, Z = Math.max(e.Zy, 0.45 * e.Yh);
  const pts = new Float64Array(nx * ny * nz * 3), skip = new Uint8Array(nx * ny * nz), eo = {};
  let q = 0;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = lerp(x0, x1, i / (nx - 1)), y = Y * j / (ny - 1), z = lerp(-Z, Z, k / (nz - 1));
    pts[3 * q] = x; pts[3 * q + 1] = y; pts[3 * q + 2] = z; skip[q] = CUR.G.code(x, y, z, eo) ? 1 : 0; q++;
  }
  Object.assign(G3, { nx, ny, nz, x0, x1, Y, Z, pts, skip, vel: new Float32Array(3 * nx * ny * nz), job: CUR.pa ? new PertJob(CUR.pa, pts, skip) : null, combined: -1 });
  resetParticles();
}
function combineGrid3() {
  const R = CUR.R; if (!G3.job || !R || !R.sol) return;
  const c = combCoef(CUR.pa, R.sol.alpha, R.sol.delta), n = G3.nx * G3.ny * G3.nz, v = G3.vel, done = G3.job.i;
  for (let q = 0; q < n; q++) { if (q < done && !G3.skip[q]) { combVel(G3.job.res, q, c, _v); v[3 * q] = _v[0]; v[3 * q + 1] = _v[1]; v[3 * q + 2] = _v[2]; } else { v[3 * q] = c.cA; v[3 * q + 1] = 0; v[3 * q + 2] = c.sA; } }
  G3.combined = done;
}
function g3Vel(x, y, z, out) {
  if (S.mode === 'cfd' && CFD3.H && cfdVelAt(x, y, z, out)) return out;
  const fx = (x - G3.x0) / (G3.x1 - G3.x0) * (G3.nx - 1), fy = Math.abs(y) / G3.Y * (G3.ny - 1), fz = (z + G3.Z) / (2 * G3.Z) * (G3.nz - 1);
  if (fx < 0 || fy > G3.ny - 1 || fz < 0 || fz > G3.nz - 1 || fx > G3.nx - 1) { const a = (CUR.R ? CUR.R.alpha : 0) * DEG; out[0] = Math.cos(a); out[1] = 0; out[2] = Math.sin(a); return out; }
  const i = Math.min(G3.nx - 2, Math.floor(fx)), j = Math.min(G3.ny - 2, Math.floor(fy)), k = Math.min(G3.nz - 2, Math.floor(fz)), tx = fx - i, ty = fy - j, tz = fz - k;
  out[0] = out[1] = out[2] = 0;
  const V = G3.vel, nx = G3.nx, nxy = nx * G3.ny;
  for (let c = 0; c < 8; c++) {
    const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2, w = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz), q = (k + dk) * nxy + (j + dj) * nx + i + di;
    out[0] += w * V[3 * q]; out[1] += w * V[3 * q + 1]; out[2] += w * V[3 * q + 2];
  }
  if (y < 0) out[1] = -out[1];
  return out;
}
function spawnParticle(i) {
  const P = R3.P, e = sliceExt(), ac = CUR.ac;
  const exh = CUR.R && CUR.R.fm && Math.random() < 0.14;
  if (exh) {
    const eng = ac.engines[0], sp = ac.spec, ex = sp.exitsGeom[Math.floor(Math.random() * sp.exitsGeom.length)], th = Math.random() * 2 * Math.PI, r = Math.sqrt(lerp((ex.Rin || 0) ** 2, ex.R ** 2, Math.random()));
    const side = eng.y > 0.01 && Math.random() < 0.5 ? -1 : 1;
    P.x[i] = eng.x0 + ex.x + 0.02; P.y[i] = side * eng.y + r * Math.cos(th); P.z[i] = eng.z + r * Math.sin(th); P.ex[i] = 1;
  } else {
    const Z = G3.Z || e.Zy;
    P.x[i] = e.x0 - 0.02 * e.L * Math.random(); P.y[i] = (Math.random() * 2 - 1) * (G3.Y || e.Yh) * 0.85; P.z[i] = (Math.random() * 2 - 1) * Z * 0.8;
    // 偏向機體附近取樣
    if (Math.random() < 0.55) { const s = ac.wing.semi * 1.15; P.y[i] = (Math.random() * 2 - 1) * s; P.z[i] = (Math.random() * 2 - 1) * Math.max(ac.fus.R0 * 2.2, 0.2 * s); }
    P.ex[i] = 0;
  }
  P.age[i] = 0; P.life[i] = 5 + 4 * Math.random();
}
function resetParticles() { const P = R3.P; P.n = 0; }
function stepParticles(dt) {
  const P = R3.P, n = Math.min(APMAX, S.particles), R = CUR.R, e = sliceExt(); if (!R || !e) return;
  while (P.n < n) { spawnParticle(P.n); P.age[P.n] = Math.random() * P.life[P.n] * 0.8; if (!P.ex[P.n]) P.x[P.n] = lerp(e.x0, e.x1, Math.random() * 0.9); P.n++; }
  P.n = n;
  const fs = R.fs, Vref = Math.max(fs.V, 60), k = e.L / 3.2 / Vref * Vref, tmpv = [0, 0, 0], o = {}, jo = {};
  const pos = R3.pts.geometry.attributes.position.array, col = R3.pts.geometry.attributes.color.array, al = R3.pts.geometry.attributes.alpha.array;
  const f = FIELDS[S.field], lut = LUTS[f.cmap], norm = CUR.norm, G = CUR.G, fm = R.fm, a = R.alpha * DEG;
  for (let i = 0; i < n; i++) {
    g3Vel(P.x[i], P.y[i], P.z[i], tmpv);
    if (S.mode === 'cfd' && CFD3.H) { jo.dU = 0; jo.dTt = 0; jo.zone = null; } else G.jetAt(fm, P.x[i], P.y[i], P.z[i], jo);
    let ux = tmpv[0] * fs.V + jo.dU, uy = tmpv[1] * fs.V, uz = tmpv[2] * fs.V;
    if (fs.V < 1 && !jo.zone) { ux = 0; uy = 0; uz = 0; }
    const sc = k / Vref;
    P.x[i] += ux * sc * dt; P.y[i] += uy * sc * dt; P.z[i] += uz * sc * dt; P.age[i] += dt;
    let dead = P.age[i] > P.life[i] || P.x[i] > e.x1 || Math.abs(P.y[i]) > (G3.Y || e.Yh) * 1.05 || Math.abs(P.z[i]) > (G3.Z || e.Zy) * 1.1;
    if (!dead && !P.ex[i] && (i + (frameN & 3)) % 4 === 0 && G.code(P.x[i], P.y[i], P.z[i], o)) dead = true;
    if (dead) { spawnParticle(i); }
    const tl = 0.09 * sc; // 流線段長度（視覺時間 0.09 s）
    pos[6 * i] = P.x[i]; pos[6 * i + 1] = P.y[i]; pos[6 * i + 2] = P.z[i];
    pos[6 * i + 3] = P.x[i] - ux * tl; pos[6 * i + 4] = P.y[i] - uy * tl; pos[6 * i + 5] = P.z[i] - uz * tl;
    let cr = 0.9, cg = 0.95, cb = 1;
    if (S.pcolor === 'field' && norm) {
      stateFromVel(fs, ux, uy, uz, o, jo.dTt, jo.zone ? jo.P : 0);
      const li = Math.round(clamp(norm(o[S.field]), 0, 1) * 255) * 3; cr = lut[li] / 255; cg = lut[li + 1] / 255; cb = lut[li + 2] / 255;
    } else if (P.ex[i] || jo.zone) { const h = clamp(jo.dTt / 600, 0, 1); cr = 1; cg = 0.85 - 0.35 * h; cb = 0.6 - 0.45 * h; }
    col[6 * i] = cr; col[6 * i + 1] = cg; col[6 * i + 2] = cb; col[6 * i + 3] = cr; col[6 * i + 4] = cg; col[6 * i + 5] = cb;
    const t = P.age[i] / P.life[i]; al[2 * i] = Math.min(1, t * 6) * Math.min(1, (1 - t) * 4) * 0.7; al[2 * i + 1] = 0;
  }
  R3.pts.geometry.setDrawRange(0, 2 * n);
  R3.pts.geometry.attributes.position.needsUpdate = true; R3.pts.geometry.attributes.color.needsUpdate = true; R3.pts.geometry.attributes.alpha.needsUpdate = true;
}

/* ============================================================
 *  著色（表面、剖面、圖例）
 * ============================================================ */
function fieldRange(key) {
  const vals = [];
  const R = CUR.R; if (!R) return [0, 1];
  const dv = CUR.qv || dispValues(key);
  for (let q = 0; q < dv.length; q += 2) if (dv[q] === dv[q]) vals.push(dv[q]);
  if (SL.pts && SL.gval) for (let g = 0; g < SL.gval.length; g += 3) { const v = SL.gval[g]; if (v === v) vals.push(v); }
  if (!vals.length) return [0, 1];
  vals.sort((a, b) => a - b);
  let lo = vals[Math.floor(vals.length * 0.004)], hi = vals[Math.floor(vals.length * 0.996)];
  if (key === 'Cp') { lo = Math.max(Math.min(lo, -0.3), -3); hi = Math.min(Math.max(hi, 0.3), cpStag(S.M) + 0.05); return [lo, hi]; }
  if (key === 'Tt' || key === 'T') { hi = vals[vals.length - 1]; }
  if (hi - lo < 1e-6 * Math.max(1, Math.abs(hi))) { const m = Math.abs(hi) * 0.02 + 1e-3; lo -= m; hi += m; }
  return [lo, hi];
}
function normFor(key, [a, b]) {
  if (key === 'Cp') return v => v < 0 ? clamp(0.5 - 0.5 * v / a, 0, 1) : clamp(0.5 + 0.5 * v / b, 0, 1);
  if (key === 'M') { const hi = Math.max(1.05, b); return v => v <= 1 ? 0.5 * clamp(v / Math.max(1e-3, 1), 0, 1) * (1) : 0.5 + 0.5 * clamp((v - 1) / (hi - 1), 0, 1); }
  if (FIELDS[key].log && a > 0) { const la = Math.log(a), lb = Math.log(b); return v => clamp((Math.log(v) - la) / (lb - la), 0, 1); }
  return v => clamp((v - a) / (b - a), 0, 1);
}
function paintAll() {
  if (!CUR.R) return;
  const key = S.field, cfd = S.mode === 'cfd' && CFD3.H; CUR.qvAll = null;
  CUR.qv = cfd ? cfdDispValues(key) : dispValues(key);
  if (SL.pts) { if (!cfd || !paintSliceCFD()) paintSlice(); }
  if (!S.lock || !CUR.range || CUR.rangeKey !== key) { CUR.range = fieldRange(key); CUR.rangeKey = key; }
  if (key === 'M') CUR.range = [0, Math.max(1.2, CUR.range[1])];
  CUR.norm = normFor(key, CUR.range);
  paintAirMesh(CUR.qv, CUR.norm, FIELDS[key].cmap);
  if (SL.pts) texPaint(CUR.norm);
  combineGrid3();
  drawLegend();
  buildLabels();
}
function drawLegend() {
  const key = S.field, f = FIELDS[key], [a, b] = CUR.range;
  $('#lgName').innerHTML = `<b>${f.name} ${f.sym}</b>${key === 'Cp' ? '（以 0 為中點）' : key === 'M' ? '（以 M = 1 為中點）' : f.log ? '（對數色階）' : ''}${S.lock ? ' · 已鎖定' : ''}`;
  $('#lgUnit').textContent = f.unit;
  const cv = $('#lgCanvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.round(cv.clientWidth * dpr) || 280, H = Math.round(30 * dpr);
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d'), lut = LUTS[f.cmap], norm = CUR.norm, bh = 10 * dpr;
  for (let x = 0; x < W; x++) { const li = Math.round(x / (W - 1) * 255) * 3; g.fillStyle = `rgb(${lut[li]},${lut[li + 1]},${lut[li + 2]})`; g.fillRect(x, 0, 1, bh); }
  let ticks;
  if (key === 'Cp') ticks = [...niceTicks(a, 0, 3), ...niceTicks(0, b, 3).filter(v => v > 0)];
  else if (key === 'M') ticks = [0, 0.5, 1, ...niceTicks(1, Math.max(1.05, b), 2).filter(v => v > 1)];
  else if (f.log && a > 0) { ticks = logTicks(a, b); if (ticks.length < 3) ticks = niceTicks(a, b, 4); if (ticks.length > 7) ticks = ticks.filter((_, i) => i % 2 === 0); }
  else ticks = niceTicks(a, b, 5);
  g.fillStyle = '#a8b4c0'; g.font = `${10 * dpr}px "B612 Mono", monospace`; g.textBaseline = 'top';
  let lastX = -1e9;
  for (const v of ticks) {
    const t = norm(v); if (t < 0 || t > 1) continue;
    const x = Math.round(t * (W - 1)) + 0.5;
    g.fillRect(x - 0.5 * dpr, bh, dpr, 3 * dpr);
    const vv = v * f.sc, s = key === 'Cp' || key === 'M' ? (Math.abs(v) < 1e-9 ? '0' : String(+v.toFixed(2))) : fmtN(vv, Math.abs(vv) < 1 ? 3 : Math.abs(vv) < 10 ? 2 : Math.abs(vv) < 100 ? 1 : 0);
    const tw = g.measureText(s).width, tx = clamp(x - tw / 2, 0, W - tw);
    if (tx < lastX + 4 * dpr) continue;
    g.fillText(s, tx, bh + 5 * dpr); lastX = tx + tw;
  }
}
function niceTicks(a, b, n) {
  const span = b - a; if (!(span > 0)) return [a];
  const step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0))), err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = []; for (let v = Math.ceil(a / step - 1e-9) * step; v <= b + 1e-9 * span; v += step) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(a, b) { const out = []; for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= a * 0.999 && v <= b * 1.001) out.push(v); } return out; }

/* ---------- 視圖：剖切、透視 ---------- */
function applyView() {
  if (!CUR.ac) return;
  const on = S.cut && S.slice !== 'off';
  if (!on) setCut(false);
  else if (S.slice === 'y') setCut(true, [0, -1, 0], SL.pos || 0);
  else if (S.slice === 'z') setCut(true, [0, 0, -1], SL.pos || 0);
  else setCut(true, [-1, 0, 0], SL.pos || 0);
  setXray(S.xray);
  R3.engs.visible = S.xray || on || !CUR.ac.T.internal;
  R3.pts.visible = S.particles > 0;
}
function setView(kind, instant) {
  const ac = CUR.ac; if (!ac) return;
  const L = ac.fus.L, b = ac.ref.b, asp = R3.camera.aspect || 1.6, D = Math.max(L, b) * (kind === 'iso' ? 1.45 : 1.75) * Math.pow(Math.max(1, 1.5 / asp), 0.8);
  const c = [0.5 * L, 0, 0];
  const dirs = { iso: [-0.62, 0.72, 0.42], side: [0, 1, 0.02], front: [-1, 0.02, 0.06], top: [0.001, 0, 1], under: [0.001, 0.25, -1], rear: [1, 0.3, 0.25] };
  let d = dirs[kind] || dirs.iso;
  if (kind === 'iso' && S.slice === 'y') d = [-0.5, 0.78, 0.38];
  if (kind === 'iso' && S.slice === 'x') d = [-0.78, 0.46, 0.42];
  if (kind === 'iso' && S.slice === 'z') d = [-0.45, 0.45, 0.78];
  const len = Math.hypot(...d), pA = [c[0] + d[0] / len * D, c[1] + d[1] / len * D, c[2] + d[2] / len * D];
  const p = new THREE.Vector3(...pA).applyMatrix4(R3.world.matrixWorld), tgt = new THREE.Vector3(...c).applyMatrix4(R3.world.matrixWorld);
  if (instant || reduceMotion) { R3.camera.position.copy(p); R3.controls.target.copy(tgt); R3.controls.update(); return; }
  const p0 = R3.camera.position.clone(), t0 = R3.controls.target.clone(), t1 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t1) / 650), e = k * k * (3 - 2 * k); R3.camera.position.lerpVectors(p0, p, e); R3.controls.target.lerpVectors(t0, tgt, e); if (k < 1) requestAnimationFrame(step); };
  step();
}

/* ---------- 3D 標籤 ---------- */
function buildLabels() {
  const host = $('#labels3d'), ac = CUR.ac; if (!ac) return;
  const R = CUR.R, list = [];
  const w = ac.wing, h = ac.htail, v = ac.vtail, E = ENGINE_TYPES[ac.spec.type];
  list.push({ t: '機翼', s: `S ${fmtN(ac.ref.S)} m² · A ${ac.ref.A.toFixed(1)}`, p: w.pt(0.62 * w.semi, 0.4, 1, 0) });
  list.push({ t: '水平尾翼', p: h.pt(0.7 * h.semi, 0.4, 1, 0) });
  list.push({ t: '垂直尾翼', p: [v.xLE(0.8 * v.semi) + 0.4 * v.chord(0.8 * v.semi), 0, v.o.z0 + 0.8 * v.semi] });
  list.push({ t: '機身', s: `L ${ac.fus.L.toFixed(1)} m`, p: [0.22 * ac.fus.L, 0, ac.fus.R0 * 1.02] });
  const e = ac.engines[0];
  list.push({ t: E.short + (ac.T.nEng > 1 ? ' ×' + ac.T.nEng : ''), s: E.label, p: e.internal ? [e.x0 + 0.5 * ac.spec.outerEnd, 0, -ac.fus.R0 * 0.2] : [e.x0 + 0.3 * ac.spec.outerEnd, e.y, e.z - ac.spec.view.Rmax] });
  if (R && R.st && R.fs.V > 10) {
    const dv = CUR.qvCp = S.field === 'Cp' ? CUR.qv : dispValues('Cp');
    let kmin = -1, vmin = Infinity; const P = CUR.disp.P, tipW = 0.96 * w.semi, tipH = 0.96 * h.semi;
    for (let q = 0; q < dv.length; q++) { if (CUR.dSpecial[q] || !(dv[q] < vmin)) continue; const p = P[q], ay = Math.abs(p.cen[1]); if ((p.comp === 'wing' && ay > tipW) || (p.comp === 'htail' && ay > tipH)) continue; vmin = dv[q]; kmin = q; } // 翼尖零厚度邊緣略過
    if (kmin >= 0) list.push({ t: '最低 Cp', s: vmin.toFixed(2), p: CUR.disp.P[kmin].cen, mk: true });
  }
  host.innerHTML = '';
  CUR.labels = list.map(L => { const e2 = el('div', { class: 'lbl3d' + (L.mk ? ' mk' : ''), html: `${L.t}${L.s ? `<small>${L.s}</small>` : ''}` }); host.append(e2); return { e: e2, p: new THREE.Vector3(...L.p) }; });
}

/* ============================================================
 *  探針
 * ============================================================ */
const ndc = new THREE.Vector2();
function toAir(pW) { return R3.world.worldToLocal(pW.clone()); }
function pick(e) {
  const c = R3.renderer.domElement, rc = c.getBoundingClientRect();
  ndc.set(((e.clientX - rc.left) / rc.width) * 2 - 1, -((e.clientY - rc.top) / rc.height) * 2 + 1);
  R3.raycaster.setFromCamera(ndc, R3.camera);
  const objs = [...R3.air.children]; if (R3.slice.visible) objs.push(R3.slice);
  const hits = R3.raycaster.intersectObjects(objs, false);
  for (const h of hits) {
    const pA = toAir(h.point);
    if (R3.clipOn) { const n = R3.cutA; if (n && n[0] * pA.x + n[1] * pA.y + n[2] * pA.z + n[3] < -1e-4) continue; }
    if (h.object === R3.slice) return { kind: 'slice', p: [pA.x, pA.y, pA.z], w: h.point };
    if (S.xray) continue;
    const q = R3.airV.triQ[h.faceIndex]; return { kind: 'surf', q, p: [pA.x, pA.y, pA.z], w: h.point };
  }
  return null;
}
function probeAt(h) {
  const R = CUR.R; if (!R) return null;
  const fs = R.fs;
  if (h.kind === 'surf') {
    const q = h.q, sp = CUR.dSpecial[q], d = CUR.disp.P[q];
    const o = {}; for (const k of PLAIN) { let v = 0, ws = 0; if (sp) { const f = R.faces[sp]; o[k] = f ? f[k] : NaN; continue; } for (let j = 0; j < 4; j++) { const i = CUR.dmap.idx[4 * q + j]; if (i < 0 || !R.st) continue; v += CUR.dmap.w[4 * q + j] * R.st[k][i]; ws += CUR.dmap.w[4 * q + j]; } o[k] = ws ? v / ws : NaN; }
    const comp = COMPN[d.comp] || d.comp;
    const side = d.comp === 'wing' || d.comp === 'htail' ? (d.n[2] > 0 ? '上表面' : '下表面') : d.comp === 'vtail' ? '側面' : '';
    if (!sp && S.mode === 'cfd' && CFD3.H) { const vals = CUR.qvAll || {}; for (const k of PLAIN) { const a = k === S.field ? CUR.qv : (vals[k] || (vals[k] = cfdDispValues(k))); o[k] = a[q]; } CUR.qvAll = vals; }
    o.where = sp ? ({ in: '進氣面（風扇面）', byp: '外涵噴嘴出口', core: '核心噴嘴出口' }[sp]) : `${comp}${side ? ' · ' + side : ''}${S.mode === 'cfd' && CFD3.H ? '（3D CFD）' : ''}`;
    o.surf = true; o.special = !!sp;
    // 局部雷諾數（由前緣或機鼻起算）
    if (!sp) { const ac = CUR.ac, y = Math.abs(h.p[1]); let xl = h.p[0]; if (d.comp === 'wing') xl = h.p[0] - ac.wing.xLE(Math.min(y, ac.wing.semi)); else if (d.comp === 'htail') xl = h.p[0] - ac.htail.xLE(Math.min(y, ac.htail.semi)); else if (d.comp === 'vtail') xl = h.p[0] - ac.vtail.xLE(clamp(h.p[2] - ac.vtail.o.z0, 0, ac.vtail.semi)); else if (d.comp === 'nac') xl = h.p[0] - ac.engines[0].x0; o.Rex = fs.rho * fs.V * Math.max(0.01, xl) / fs.mu; }
    return o;
  }
  const p = h.p, eo = {}, c = CUR.G.code(p[0], p[1], p[2], eo);
  if (c === 1 || c === 2) return { solid: true, where: c === 1 ? '機體內部' : '引擎實體' };
  if (c === 3) { if (!R.fm) return null; const o = R.fm.sample(eo.xe, eo.r, eo.th, {}); o.Cp = fs.q > 1 ? (o.P - fs.P) / fs.q : 0; const cm = R.fm.compName(eo.xe, o.stream || 'x'); o.where = '引擎內部流道' + (cm ? ' · ' + cm.name : ''); o.eng = true; return o; }
  if (S.mode === 'cfd' && CFD3.H) {
    const idx = new Int32Array(8), w = new Float32Array(8), W = [0, 0, 0, 0, 0];
    cfdStencil(CFD3.g, CFD3.mask.t, p[0], p[1], p[2], idx, w, 0);
    if (cfdSample(CFD3.H, idx, w, 0, p[1] < 0 ? -1 : 1, W)) { const o = cfdState(fs, W, {}); o.where = '機外流場（3D CFD）'; o.eps = fs.V > 1 ? Math.atan2(o.Vz, o.Vx) / DEG - R.alpha : 0; o.sig = fs.V > 1 ? Math.atan2(o.Vy, o.Vx) / DEG : 0; return o; }
  }
  let v = [Math.cos(R.alpha * DEG), 0, Math.sin(R.alpha * DEG)];
  if (CUR.pa && R.sol) { const job = new PertJob(CUR.pa, new Float64Array([p[0], Math.abs(p[1]), p[2]]), null); job.step(50); v = combVel(job.res, 0, combCoef(CUR.pa, R.sol.alpha, R.sol.delta), [0, 0, 0]); if (p[1] < 0) v[1] = -v[1]; }
  const j = {}; CUR.G.jetAt(R.fm, p[0], p[1], p[2], j);
  const o = stateFromVel(fs, fs.V * v[0] + j.dU, fs.V * v[1], fs.V * v[2], {}, j.dTt, j.zone ? j.P : 0);
  o.where = j.zone ? '引擎噴流' : '機外流場';
  o.eps = fs.V > 1 ? (Math.atan2(v[2], v[0]) / DEG - R.alpha) : 0; o.sig = fs.V > 1 ? Math.atan2(v[1], v[0]) / DEG : 0;
  return o;
}
function showProbe(h, hover) {
  const box = $('#probe'); CUR.lastProbe = [h, hover];
  if (!h || !CUR.R) { box.innerHTML = `<h4>探針</h4><div class="hint">移動游標至機體表面或流場剖面即可讀取；點擊可釘選。</div>`; return; }
  const o = probeAt(h);
  const title = (hover ? '探針 · 游標位置' : '探針 · 已釘選') + `<button class="pc" aria-label="${S.probeMin ? '展開' : '收合'}探針資訊">${S.probeMin ? '＋' : '－'}</button>`;
  const where = `x ${h.p[0].toFixed(2)} · y ${h.p[1].toFixed(2)} · z ${h.p[2].toFixed(2)} m`;
  if (!o || o.solid) { box.innerHTML = `<h4>${title}</h4><div class="where">${o ? o.where : '—'}<br>${where}</div>`; return; }
  const C = v => fmtS(v - 273.15, 1);
  if (S.probeMin) { box.innerHTML = `<h4>${title}</h4><div class="where">${o.where}</div><dl><dt>Cp · P</dt><dd>${fmtS(o.Cp, 3)} · ${fmtN(o.P / 1000, 2)} kPa</dd><dt>T · M</dt><dd>${fmtN(o.T, 1)} K · ${fmtN(o.M, 3)}</dd></dl>`; return; }
  let rows = `<dt>壓力係數 Cp</dt><dd>${fmtS(o.Cp, 3)}</dd><dt>靜壓 P</dt><dd>${fmtN(o.P / 1000, 2)} kPa</dd><dt>靜溫 T</dt><dd>${fmtN(o.T, 1)} K（${C(o.T)} °C）</dd>`;
  if (o.surf && !o.special) rows += `<dt>絕熱壁溫 T<sub>aw</sub></dt><dd>${fmtN(o.Taw, 1)} K（${C(o.Taw)} °C）</dd>`;
  rows += `<dt>總溫 Tt</dt><dd>${fmtN(o.Tt, 1)} K</dd><dt>總壓 Pt</dt><dd>${fmtN(o.Pt / 1000, 2)} kPa</dd><dt>${o.surf ? '邊界層外緣速度' : '速度 V'}</dt><dd>${fmtN(o.V, 1)} m/s</dd><dt>局部馬赫數</dt><dd>${fmtN(o.M, 3)}</dd><dt>密度 ρ</dt><dd>${fmtN(o.rho, 4)} kg/m³</dd>`;
  if (o.Rex) rows += `<dt>局部雷諾數 Re<sub>x</sub></dt><dd>${o.Rex.toExponential(2)}</dd>`;
  if (o.eps !== undefined && !o.eng) rows += `<dt>下洗角 ε · 側洗角</dt><dd>${fmtS(-o.eps, 2)}° · ${fmtS(o.sig, 2)}°</dd>`;
  box.innerHTML = `<h4>${title}</h4><div class="where">${o.where}<br>${where}</div><dl>${rows}</dl>${hover ? '<div class="hint">點擊可釘選此點。</div>' : ''}`;
}
let hoverRAF = 0, lastPE = null, downXY = null;
function onVpMove(e) {
  lastPE = e; if (hoverRAF) return;
  hoverRAF = requestAnimationFrame(() => {
    hoverRAF = 0; if (!CUR.R || !lastPE) return;
    const h = pick(lastPE);
    if (h) { CUR.hovering = true; showProbe(h, true); R3.marker.visible = true; R3.marker.position.set(...h.p); R3.marker.scale.setScalar(0.004 * CUR.ac.fus.L); R3.renderer.domElement.style.cursor = 'crosshair'; }
    else leaveVp();
  });
}
function leaveVp() { CUR.hovering = false; R3.marker.visible = false; R3.renderer.domElement.style.cursor = ''; showProbe(CUR.pin, false); }

/* ============================================================
 *  主迴圈
 * ============================================================ */
const V3 = new THREE.Vector3();
let frameN = 0, slPaintT = 0, pumpT = 0, g3T = 0;
/* 背景工作（剖面 → 3D 速度網格）：以 setTimeout 分段執行，與繪圖交錯 */
function pumpJobs() {
  if (pumpT) return;
  const busy = (SL.job && !SL.job.done) || (G3.job && !G3.job.done);
  if (!busy) return;
  pumpT = setTimeout(() => {
    pumpT = 0;
    const t0 = performance.now();
    if (SL.job && !SL.job.done) { SL.job.step(14); if (SL.job.done || t0 - slPaintT > 250) { slPaintT = t0; paintAll(); } updateSolverBar(); }
    else if (G3.job && !G3.job.done) { G3.job.step(14); if (G3.job.done || t0 - g3T > 400) { g3T = t0; combineGrid3(); updateSolverBar(); } }
    pumpJobs();
  }, 0);
}
function frame() {
  requestAnimationFrame(frame); frameN++;
  const dt = Math.min(0.05, R3.clock.getDelta());
  R3.controls.update();
  pumpJobs();
  if (CFD3 && CFD3.tick) CFD3.tick();
  if (CUR.R) {
    if (S.anim > 0 && !reduceMotion) {
      const N = CUR.R.op ? CUR.R.op.N : {};
      for (const s of R3.spools || []) { s.LP.rotation.x += (N.LP || N.HP || 0) * 2.2 * S.anim * dt; s.HP.rotation.x += (N.HP || 0) * 3.6 * S.anim * dt; }
      if (S.particles > 0 && G3.combined >= 0) stepParticles(dt * S.anim);
    }
  }
  const rect = R3.host.getBoundingClientRect(), placed = [];
  for (const id of ['probe', 'tools', 'solverbar', 'legend', 'chips']) {
    const e = document.getElementById(id); if (!e || !e.offsetParent) continue;
    const b = e.getBoundingClientRect(); if (b.width && b.height) placed.push([b.left - rect.left, b.top - rect.top, b.right - rect.left, b.bottom - rect.top]);
  }
  const camA = R3.world.worldToLocal(R3.camera.position.clone()), ax = { x: 0, y: 1, z: 2 }[S.slice];
  for (const L of CUR.labels || []) {
    if (!S.labels) { L.e.hidden = true; continue; }
    V3.copy(L.p).applyMatrix4(R3.world.matrixWorld).project(R3.camera);
    let vis = V3.z < 1 && Math.abs(V3.x) < 1.05 && Math.abs(V3.y) < 1.05;
    if (vis && ax !== undefined && SL.pts) { // 被剖面遮住或位於剖除側則隱藏
      const c = [camA.x, camA.y, camA.z], l = [L.p.x, L.p.y, L.p.z], p = SL.pos, dc = c[ax] - p, dl = l[ax] - p;
      if (R3.cutA && R3.cutA[0] * l[0] + R3.cutA[1] * l[1] + R3.cutA[2] * l[2] + R3.cutA[3] < -1e-3) vis = false;
      else if (dc * dl < 0) { const t = dc / (dc - dl), q = [c[0] + t * (l[0] - c[0]), c[1] + t * (l[1] - c[1]), c[2] + t * (l[2] - c[2])]; const uv = S.slice === 'x' ? [q[1], q[2]] : S.slice === 'y' ? [q[0], q[2]] : [q[0], q[1]]; if (uv[0] >= SL.U[0] && uv[0] <= SL.U[1] && uv[1] >= SL.V[0] && uv[1] <= SL.V[1]) vis = false; }
    }
    const px = (V3.x + 1) / 2 * rect.width, py = (1 - V3.y) / 2 * rect.height;
    if (vis) {
      if (!L.w) { L.e.hidden = false; L.w = L.e.offsetWidth || 60; L.h = L.e.offsetHeight || 16; }
      const bx = [px - L.w / 2 - 2, py - L.h - 2, px + L.w / 2 + 2, py + 2];
      if (placed.some(q => bx[0] < q[2] && bx[2] > q[0] && bx[1] < q[3] && bx[3] > q[1])) vis = false; else placed.push(bx);
    }
    L.e.hidden = !vis; if (vis) { L.e.style.left = px + 'px'; L.e.style.top = py + 'px'; }
  }
  R3.renderer.render(R3.scene, R3.camera);
}
function onResize() {
  const r = R3.host.getBoundingClientRect();
  R3.renderer.setSize(r.width, r.height, false);
  R3.camera.aspect = r.width / Math.max(1, r.height); R3.camera.updateProjectionMatrix();
  if (CUR.R) { drawLegend(); updatePanels(true); }
}

/* ---------- 啟動 ---------- */
function markSeg() {
  for (const b of $('#typeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.t === S.type ? 'true' : 'false');
  for (const b of $('#fieldSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.f === S.field ? 'true' : 'false');
  for (const b of $('#modeSeg').querySelectorAll('button')) b.setAttribute('aria-pressed', b.dataset.m === S.mode ? 'true' : 'false');
}
function switchType(t, first) {
  if (!first) resetType(t);
  markSeg();
  CUR.pin = null; R3.pin.visible = false;
  buildRack();
  rebuildGeometry();
  onResize();
  setView('iso', true);
}
function boot() {
  const ts = $('#typeSeg');
  for (const k of ['airliner', 'interceptor', 'fighter']) ts.append(el('button', { 'data-t': k, onclick: () => { if (S.type !== k) switchType(k); } }, AIRCRAFT_TYPES[k].label));
  const fsg = $('#fieldSeg');
  for (const k of FIELD_ORDER) fsg.append(el('button', { 'data-f': k, title: FIELDS[k].name, onclick: () => { S.field = k; markSeg(); paintAll(); updatePanels(true); if (CUR.lastProbe) showProbe(...CUR.lastProbe); } }, FIELDS[k].name));
  const ms = $('#modeSeg');
  for (const [k, t] of [['panel', '面元法＋工程估算'], ['cfd', '3D CFD（Euler）']]) ms.append(el('button', { 'data-m': k, onclick: () => setMode(k) }, t));
  initAirScene($('#vp'));
  for (const b of $('#tools').querySelectorAll('button')) b.addEventListener('click', () => setView(b.dataset.view));
  const cvs = R3.renderer.domElement;
  cvs.addEventListener('pointermove', onVpMove);
  cvs.addEventListener('pointerleave', () => { lastPE = null; leaveVp(); });
  cvs.addEventListener('pointerdown', e => { downXY = [e.clientX, e.clientY]; });
  cvs.addEventListener('pointerup', e => { if (!downXY || Math.hypot(e.clientX - downXY[0], e.clientY - downXY[1]) > 4) return; const h = pick(e); if (h) { CUR.pin = h; R3.pin.visible = true; R3.pin.position.set(...h.p); R3.pin.scale.setScalar(0.005 * CUR.ac.fus.L); showProbe(h, false); } });
  $('#probe').addEventListener('click', e => { if (e.target.closest('.pc')) { S.probeMin = !S.probeMin; if (CUR.lastProbe) showProbe(...CUR.lastProbe); } });
  initCharts();
  new ResizeObserver(onResize).observe($('#vp'));
  let rt = 0; window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(onResize, 120); });
  resetType('airliner');
  switchType('airliner', true);
  requestAnimationFrame(frame);
}
