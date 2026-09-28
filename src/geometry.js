/* ============================================================
 *  geometry.js — 軸對稱流道幾何（單位 m；x 為軸向，r 為半徑）
 *  幾何為代表性示意，尺寸依設計點空氣流量以 √(ṁ/ṁ_ref) 等比縮放。
 * ============================================================ */
function chaikin(pts, iters) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
      q.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}
function Line(ctrl, s, smooth) {
  let pts = ctrl.map(([x, r]) => [x * s, r * s]);
  if (smooth !== 0) pts = chaikin(pts, smooth || 2);
  for (let i = 1; i < pts.length; i++) if (pts[i][0] < pts[i - 1][0]) pts[i][0] = pts[i - 1][0];
  const xs = pts.map(p => p[0]), rs = pts.map(p => p[1]);
  const n = pts.length;
  return {
    pts, x0: xs[0], x1: xs[n - 1],
    at(x) {
      if (x <= xs[0]) return rs[0];
      if (x >= xs[n - 1]) return rs[n - 1];
      let lo = 0, hi = n - 1;
      while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xs[m] <= x) lo = m; else hi = m; }
      const dx = xs[hi] - xs[lo];
      return dx < 1e-12 ? rs[hi] : rs[lo] + (rs[hi] - rs[lo]) * (x - xs[lo]) / dx;
    },
  };
}
function lipArc(cx, cr, ax, ar, s, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = -Math.PI / 2 + Math.PI * i / n;
    out.push([(cx - ax * Math.cos(t)) * s, (cr + ar * Math.sin(t)) * s]);
  }
  return out;
}
function polyFrom(...parts) { const p = []; for (const q of parts) for (const v of q) p.push(v); return p; }
function rev(a) { return a.slice().reverse(); }
function stripPoly(line, x0, x1, th) { // 薄壁（燃燒室襯套等）
  const up = [], dn = [];
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, r = line.at(x);
    up.push([x, r + th / 2]); dn.push([x, r - th / 2]);
  }
  return polyFrom(dn, rev(up));
}
function bbox(poly) {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [x, r] of poly) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, r); d = Math.max(d, r); }
  return [a, b, c, d];
}
function pointInPoly(x, r, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], ri = poly[i][1], xj = poly[j][0], rj = poly[j][1];
    if ((ri > r) !== (rj > r) && x < (xj - xi) * (r - ri) / (rj - ri) + xi) inside = !inside;
  }
  return inside;
}
/* 葉片排：等寬交錯的轉子／靜子 */
function stageRows(x0, x1, nStages, o) {
  const rows = [];
  const nRows = nStages * 2 + (o.igv ? 1 : 0);
  const w = (x1 - x0) / nRows;
  let x = x0, k = 0;
  if (o.igv) { rows.push({ x0: x, x1: x + w * 0.8, rotor: false, n: o.nIgv || 30, kind: 'vane', role: 'igv' }); x += w; }
  for (let i = 0; i < nStages; i++) {
    const nr = Math.round(o.nr0 + (o.nr1 - o.nr0) * (nStages > 1 ? i / (nStages - 1) : 0));
    const ns = Math.round(nr * (o.sRatio || 1.15));
    if (o.turbine) {
      rows.push({ x0: x, x1: x + w * 0.82, rotor: false, n: ns, kind: 'ngv', stage: i });
      x += w;
      rows.push({ x0: x, x1: x + w * 0.82, rotor: true, n: nr, kind: 'turb', stage: i });
      x += w;
    } else {
      rows.push({ x0: x, x1: x + w * 0.82, rotor: true, n: nr, kind: o.kind || 'comp', stage: i });
      x += w;
      rows.push({ x0: x, x1: x + w * 0.82, rotor: false, n: ns, kind: 'vane', stage: i });
      x += w;
    }
    k++;
  }
  for (const r of rows) Object.assign(r, { stream: o.stream, spool: o.spool, comp: o.comp });
  return rows;
}
function scaleRows(rows, s) { for (const r of rows) { r.x0 *= s; r.x1 *= s; } return rows; }

/* ------------------------------------------------------------
 *  各型引擎幾何
 *  noz = { r8, r9 } 由循環計算提供（可變噴嘴），單位 m
 * ------------------------------------------------------------ */
function buildSpec(type, s, noz) {
  if (type === 'hbtf') return specHBTF(s, noz);
  if (type === 'tj') return specTJ(s, noz);
  return specLBTF(s, noz);
}

/* noz（選用）：{ A9, A19 } 設計點核心／外涵噴嘴出口面積（m²，由一維循環設計點提供），用以決定噴嘴出口半徑 */
function specHBTF(s, noz) {
  const hub = Line([[0.30, 0], [0.305, 0.03], [0.34, 0.085], [0.42, 0.155], [0.50, 0.207], [0.58, 0.24], [0.70, 0.262], [0.78, 0.272], [0.90, 0.29], [0.95, 0.305], [1.25, 0.33], [1.29, 0.322], [1.35, 0.228], [1.41, 0.162], [1.46, 0.145], [2.05, 0.212], [2.09, 0.20], [2.12, 0.19], [2.36, 0.19], [2.40, 0.225], [2.42, 0.238], [2.58, 0.242], [2.66, 0.25], [3.08, 0.24], [3.2, 0.232], [3.45, 0.16], [3.62, 0.09], [3.78, 0.028], [3.845, 0]], s);
  // 噴嘴出口半徑：使出口環面積等於一維設計點面積（預設值對應預設設計點）
  const r9h = hub.at(3.45 * s) / s, cowlPts = [[0.90, 0.44], [0.96, 0.462], [1.1, 0.482], [1.4, 0.498], [1.8, 0.50], [2.05, 0.49], [2.2, 0.472], [2.6, 0.425], [2.9, 0.41], [3.2, 0.388]];
  const R9 = noz && noz.A9 > 0 ? clamp(Math.sqrt(noz.A9 / (Math.PI * s * s) + r9h * r9h), 0.22, 0.33) : 0.2853;
  const tip = Line([[0.90, 0.44], [0.95, 0.425], [1.25, 0.392], [1.29, 0.395], [1.35, 0.352], [1.41, 0.29], [1.46, 0.252], [1.55, 0.246], [2.05, 0.232], [2.08, 0.26], [2.12, 0.335], [2.15, 0.345], [2.34, 0.345], [2.39, 0.31], [2.42, 0.282], [2.58, 0.29], [2.66, 0.32], [3.08, 0.375], [3.2, 0.37], [3.45, R9]], s);
  const cowl = Line([...cowlPts, [3.45, R9 + 0.02]], s);
  const r19c = cowl.at(2.2 * s) / s;
  const R19 = noz && noz.A19 > 0 ? clamp(Math.sqrt(noz.A19 / (Math.PI * s * s) + r19c * r19c), 0.62, 0.76) : 0.7063;
  const nacIn = Line([[0.0, 0.843], [0.06, 0.822], [0.18, 0.804], [0.35, 0.80], [0.58, 0.80], [0.80, 0.80], [1.1, 0.797], [1.5, 0.78], [1.9, 0.745 + 0.5 * (R19 - 0.70)], [2.2, R19]], s);
  const nacOut = Line([[0.0, 0.905], [0.1, 0.94], [0.3, 0.968], [0.6, 0.978], [1.0, 0.97], [1.4, 0.93], [1.8, 0.85], [2.1, 0.755 + 0.6 * (R19 - 0.70)], [2.2, R19 + 0.016]], s);
  const lip = lipArc(0, 0.874, 0.035, 0.031, s, 10);
  const linerIn = Line([[2.15, 0.222], [2.20, 0.216], [2.30, 0.222], [2.42, 0.238]], s);
  const linerOut = Line([[2.15, 0.308], [2.20, 0.318], [2.30, 0.305], [2.42, 0.282]], s);
  const nacPoly = polyFrom(lip, nacOut.pts, [[2.2 * s, R19 * s]], rev(nacIn.pts));
  const hubPoly = polyFrom(hub.pts, [[0.30 * s, 0]]);
  const cowlPoly = polyFrom(cowl.pts, rev(tip.pts));
  const rows = scaleRows([
    { x0: 0.585, x1: 0.775, stream: 'inlet', rotor: true, spool: 'LP', n: 24, kind: 'fan', comp: 'fan' },
    { x0: 1.00, x1: 1.10, stream: 'bypass', rotor: false, n: 44, kind: 'vane', comp: 'byp', role: 'ogv' },
    ...stageRows(0.955, 1.25, 3, { stream: 'core', spool: 'LP', nr0: 64, nr1: 76, comp: 'lpc' }),
    ...stageRows(1.465, 2.05, 9, { stream: 'core', spool: 'HP', nr0: 38, nr1: 90, igv: true, nIgv: 40, comp: 'hpc' }),
    { x0: 2.425, x1: 2.48, stream: 'core', rotor: false, n: 38, kind: 'ngv', comp: 'hpt', stage: 0 },
    { x0: 2.50, x1: 2.572, stream: 'core', rotor: true, spool: 'HP', n: 72, kind: 'turb', comp: 'hpt', stage: 0 },
    ...stageRows(2.67, 3.07, 4, { stream: 'core', spool: 'LP', nr0: 110, nr1: 134, turbine: true, sRatio: 0.55, comp: 'lpt' }),
    { x0: 3.10, x1: 3.16, stream: 'core', rotor: false, n: 14, kind: 'strut', comp: 'noz', role: 'trf' },
  ], s);
  return {
    type: 'hbtf', s,
    lines: { hub, tip, cowl, nacIn, nacOut, linerIn, linerOut },
    streams: {
      inlet: { x0: 0, x1: 0.90 * s, lo: hub, hi: nacIn, gas: 'cold' },
      core: { x0: 0.90 * s, x1: 3.45 * s, lo: hub, hi: tip },
      bypass: { x0: 0.90 * s, x1: 2.2 * s, lo: cowl, hi: nacIn, gas: 'cold' },
    },
    order: ['inlet', 'core', 'bypass'],
    split: { x: 0.90 * s, from: 'inlet', inner: 'core', outer: 'bypass' },
    bodies: [
      { key: 'nacelle', poly: nacPoly, mat: 'nacelle' },
      { key: 'hub', poly: hubPoly, mat: 'hub' },
      { key: 'cowl', poly: cowlPoly, mat: 'cowl' },
      { key: 'linerIn', poly: stripPoly(linerIn, 2.15 * s, 2.42 * s, 0.006 * s), mat: 'liner' },
      { key: 'linerOut', poly: stripPoly(linerOut, 2.15 * s, 2.42 * s, 0.006 * s), mat: 'liner' },
      { key: 'dome', poly: [[2.147 * s, 0.222 * s], [2.155 * s, 0.222 * s], [2.155 * s, 0.308 * s], [2.147 * s, 0.308 * s]], mat: 'liner' },
    ],
    rows,
    comb: { x0: 2.08 * s, xd: 2.15 * s, x1: 2.42 * s, linerIn, linerOut, n: 20, cannular: false, stream: 'core', turbEnd: 3.08 * s },
    ab: null, mixer: null,
    comps: [
      { key: 'inlet', name: '進氣道', en: 'Inlet', x0: -0.035 * s, x1: 0.585 * s, stream: 'inlet' },
      { key: 'fan', name: '風扇', en: 'Fan', x0: 0.585 * s, x1: 0.775 * s, stream: 'inlet' },
      { key: 'split', name: '分流段', en: 'Splitter', x0: 0.775 * s, x1: 0.955 * s, stream: '*' },
      { key: 'byp', name: '外涵道', en: 'Bypass duct', x0: 0.90 * s, x1: 2.2 * s, stream: 'bypass' },
      { key: 'lpc', name: '增壓級', short: '增壓', en: 'LPC booster', x0: 0.955 * s, x1: 1.25 * s, stream: 'core' },
      { key: 'duct', name: '過渡段', en: 'Transition duct', x0: 1.25 * s, x1: 1.465 * s, stream: 'core' },
      { key: 'hpc', name: '高壓壓氣機', short: '高壓', en: 'HPC', x0: 1.465 * s, x1: 2.05 * s, stream: 'core' },
      { key: 'comb', name: '燃燒室', short: '燃燒', en: 'Combustor', x0: 2.05 * s, x1: 2.42 * s, stream: 'core' },
      { key: 'hpt', name: '高壓渦輪', short: '高渦', en: 'HPT', x0: 2.42 * s, x1: 2.58 * s, stream: 'core' },
      { key: 'itd', name: '渦輪間過渡段', en: 'Inter-turbine duct', x0: 2.58 * s, x1: 2.67 * s, stream: 'core' },
      { key: 'lpt', name: '低壓渦輪', short: '低渦', en: 'LPT', x0: 2.67 * s, x1: 3.08 * s, stream: 'core' },
      { key: 'noz', name: '核心噴嘴', short: '噴嘴', en: 'Core nozzle', x0: 3.08 * s, x1: 3.45 * s, stream: 'core' },
    ],
    chartComps: ['fan', 'lpc', 'hpc', 'comb', 'hpt', 'lpt', 'noz'],
    stations: [
      { id: '2', x: 0.585 * s, stream: 'inlet' }, { id: '13', x: 0.93 * s, stream: 'bypass' },
      { id: '21', x: 0.955 * s, stream: 'core' }, { id: '25', x: 1.465 * s, stream: 'core' },
      { id: '3', x: 2.05 * s, stream: 'core' }, { id: '4', x: 2.425 * s, stream: 'core' },
      { id: '45', x: 2.62 * s, stream: 'core' }, { id: '5', x: 3.08 * s, stream: 'core' },
      { id: '9', x: 3.45 * s, stream: 'core' }, { id: '19', x: 2.2 * s, stream: 'bypass' },
    ],
    lip: { x: 0, r: 0.843 * s, rOut: 0.905 * s },
    outer: nacOut, outerEnd: 2.2 * s,
    exitsGeom: [
      { key: 'bypass', x: 2.2 * s, R: R19 * s, Rin: cowl.at(2.2 * s) },
      { key: 'core', x: 3.45 * s, R: R9 * s, Rin: hub.at(3.45 * s), plugTip: 3.845 * s },
    ],
    domain: { xb: [-2.0 * s, 0, 4.0 * s, 10 * s], ub: [0, 0.13, 0.66, 1], rb: [0, 1.1 * s, 2.0 * s], vb: [0, 0.8, 1] },
    view: { target: [2.15 * s, 0.05 * s, 0], dist: 6.3 * s, len: 3.85 * s, Rmax: 0.98 * s },
    secR: 1.05 * s,
  };
}

function specTJ(s, noz) {
  const r8 = noz ? noz.r8 : 0.235 * s, r9 = noz ? noz.r9 : 0.255 * s;
  const hub = Line([[0.08, 0], [0.085, 0.02], [0.13, 0.065], [0.22, 0.122], [0.35, 0.16], [0.6, 0.2], [1.0, 0.245], [1.55, 0.281], [1.58, 0.265], [1.62, 0.235], [1.66, 0.22], [2.12, 0.22], [2.17, 0.27], [2.20, 0.29], [2.62, 0.25], [2.9, 0.18], [3.1, 0.08], [3.2, 0.0]], s);
  const casIn = Line([[0.0, 0.445], [0.08, 0.415], [0.2, 0.402], [0.35, 0.40], [0.8, 0.37], [1.2, 0.335], [1.55, 0.319], [1.59, 0.36], [1.63, 0.415], [1.66, 0.42], [2.10, 0.42], [2.16, 0.39], [2.20, 0.37], [2.62, 0.37], [2.9, 0.40], [4.3, 0.40], [4.32, 0.398], [4.6, r8 / s], [4.9, r9 / s]], s, 1);
  const casOut = Line([[0.0, 0.50], [0.12, 0.49], [0.35, 0.465], [1.5, 0.465], [1.66, 0.47], [2.2, 0.47], [2.62, 0.445], [2.9, 0.45], [4.3, 0.45], [4.9, r9 / s + 0.025]], s, 1);
  const lip = lipArc(0, 0.4725, 0.03, 0.0275, s, 10);
  const linerIn = Line([[1.67, 0.26], [1.8, 0.25], [2.0, 0.262], [2.2, 0.29]], s);
  const linerOut = Line([[1.67, 0.38], [1.8, 0.395], [2.0, 0.385], [2.2, 0.37]], s);
  const xe = 4.9 * s;
  const casPoly = polyFrom(lip, casOut.pts, [[xe, r9]], rev(casIn.pts));
  const hubPoly = polyFrom(hub.pts, [[0.08 * s, 0]]);
  const rows = scaleRows([
    ...stageRows(0.36, 1.55, 12, { stream: 'core', spool: 'HP', nr0: 30, nr1: 72, igv: true, nIgv: 30, comp: 'comp' }),
    ...stageRows(2.205, 2.62, 3, { stream: 'core', spool: 'HP', nr0: 80, nr1: 96, turbine: true, sRatio: 0.6, comp: 'turb' }),
    { x0: 2.70, x1: 2.78, stream: 'core', rotor: false, n: 12, kind: 'strut', comp: 'diff', role: 'trf' },
  ], s);
  const abX0 = 3.25 * s;
  const fhRings = [0.14 * s, 0.28 * s];
  const bodies = [
    { key: 'casing', poly: casPoly, mat: 'casing' },
    { key: 'hub', poly: hubPoly, mat: 'hub' },
    { key: 'linerIn', poly: stripPoly(linerIn, 1.67 * s, 2.2 * s, 0.006 * s), mat: 'liner' },
    { key: 'linerOut', poly: stripPoly(linerOut, 1.67 * s, 2.2 * s, 0.006 * s), mat: 'liner' },
    { key: 'dome', poly: [[1.667 * s, 0.26 * s], [1.675 * s, 0.26 * s], [1.675 * s, 0.38 * s], [1.667 * s, 0.38 * s]], mat: 'liner' },
    ...fhRings.map((r, i) => ({ key: 'fh' + i, poly: vGutter(abX0, r, 0.035 * s), mat: 'fh' })),
  ];
  return {
    type: 'tj', s,
    lines: { hub, tip: casIn, casIn, casOut, linerIn, linerOut },
    streams: { core: { x0: 0, x1: xe, lo: hub, hi: casIn } },
    order: ['core'], split: null,
    bodies, rows,
    comb: { x0: 1.58 * s, xd: 1.67 * s, x1: 2.2 * s, linerIn, linerOut, n: 10, cannular: true, stream: 'core', turbEnd: 2.62 * s },
    ab: { stream: 'core', xSpray: 2.95 * s, xFH: abX0, x1: 4.3 * s, rings: fhRings, xNoz: 4.3 * s, xt: 4.6 * s, xe },
    mixer: null,
    comps: [
      { key: 'inlet', name: '進氣道', en: 'Inlet', x0: -0.03 * s, x1: 0.36 * s, stream: 'core' },
      { key: 'comp', name: '壓氣機', en: 'Compressor', x0: 0.36 * s, x1: 1.55 * s, stream: 'core' },
      { key: 'comb', name: '燃燒室', short: '燃燒', en: 'Combustor', x0: 1.55 * s, x1: 2.2 * s, stream: 'core' },
      { key: 'turb', name: '渦輪', en: 'Turbine', x0: 2.2 * s, x1: 2.62 * s, stream: 'core' },
      { key: 'diff', name: '擴散段', en: 'Exhaust diffuser', x0: 2.62 * s, x1: 3.25 * s, stream: 'core' },
      { key: 'ab', name: '後燃器', short: '後燃', en: 'Afterburner', x0: 3.25 * s, x1: 4.3 * s, stream: 'core' },
      { key: 'noz', name: '收斂-擴張噴嘴', short: '噴嘴', en: 'C-D nozzle', x0: 4.3 * s, x1: 4.9 * s, stream: 'core' },
    ],
    chartComps: ['comp', 'comb', 'turb', 'ab', 'noz'],
    stations: [
      { id: '2', x: 0.36 * s, stream: 'core' }, { id: '3', x: 1.55 * s, stream: 'core' },
      { id: '4', x: 2.205 * s, stream: 'core' }, { id: '5', x: 2.62 * s, stream: 'core' },
      { id: '6', x: 2.95 * s, stream: 'core' }, { id: '7', x: 4.3 * s, stream: 'core' },
      { id: '8', x: 4.6 * s, stream: 'core' }, { id: '9', x: 4.9 * s, stream: 'core' },
    ],
    lip: { x: 0, r: 0.445 * s, rOut: 0.50 * s },
    outer: casOut, outerEnd: xe,
    exitsGeom: [{ key: 'core', x: xe, R: r9, Rin: 0 }],
    nozzle: { x0: 4.3 * s, xt: 4.6 * s, xe, r8, r9, rDuct: 0.40 * s },
    domain: { xb: [-1.5 * s, 0, 5.2 * s, 12 * s], ub: [0, 0.1, 0.66, 1], rb: [0, 0.62 * s, 1.3 * s], vb: [0, 0.8, 1] },
    view: { target: [2.3 * s, 0.0, 0], dist: 6.4 * s, len: 4.9 * s, Rmax: 0.5 * s },
    secR: 0.56 * s,
  };
}

function specLBTF(s, noz) {
  const r8 = noz ? noz.r8 : 0.265 * s, r9 = noz ? noz.r9 : 0.29 * s;
  const hub = Line([[0.05, 0], [0.055, 0.02], [0.10, 0.055], [0.2, 0.105], [0.30, 0.14], [0.45, 0.19], [0.60, 0.23], [0.75, 0.25], [0.85, 0.255], [0.95, 0.265], [1.55, 0.287], [1.58, 0.26], [1.62, 0.24], [1.95, 0.24], [1.99, 0.275], [2.00, 0.285], [2.15, 0.285], [2.55, 0.27], [2.75, 0.25], [3.0, 0.17], [3.2, 0.07], [3.28, 0]], s);
  const casIn = Line([[0.0, 0.49], [0.06, 0.47], [0.18, 0.463], [0.30, 0.462], [0.52, 0.43], [0.75, 0.40], [0.85, 0.43], [1.0, 0.44], [1.6, 0.45], [2.0, 0.45], [2.4, 0.44], [2.75, 0.44], [4.3, 0.44], [4.32, 0.438], [4.6, r8 / s], [4.95, r9 / s]], s, 1);
  const tip = Line([[0.85, 0.345], [0.95, 0.335], [1.55, 0.305], [1.58, 0.35], [1.62, 0.395], [1.95, 0.395], [1.99, 0.345], [2.00, 0.335], [2.15, 0.342], [2.20, 0.345], [2.55, 0.37], [2.75, 0.38]], s);
  const coreCas = Line([[0.85, 0.345], [0.92, 0.36], [1.2, 0.37], [1.5, 0.375], [1.62, 0.41], [1.95, 0.41], [2.05, 0.39], [2.4, 0.39], [2.75, 0.385]], s);
  const casOut = Line([[0.0, 0.54], [0.1, 0.525], [0.3, 0.515], [2.75, 0.515], [4.3, 0.515], [4.95, r9 / s + 0.03]], s, 1);
  const lip = lipArc(0, 0.515, 0.03, 0.025, s, 10);
  const linerIn = Line([[1.66, 0.262], [1.8, 0.255], [2.0, 0.285]], s);
  const linerOut = Line([[1.66, 0.375], [1.8, 0.385], [2.0, 0.335]], s);
  const xe = 4.95 * s;
  const casPoly = polyFrom(lip, casOut.pts, [[xe, r9]], rev(casIn.pts));
  const hubPoly = polyFrom(hub.pts, [[0.05 * s, 0]]);
  const corePoly = polyFrom(coreCas.pts, rev(tip.pts));
  const rows = scaleRows([
    ...stageRows(0.30, 0.75, 3, { stream: 'inlet', spool: 'LP', nr0: 28, nr1: 44, igv: true, nIgv: 22, kind: 'fan', sRatio: 1.1, comp: 'fan' }),
    ...stageRows(0.955, 1.55, 7, { stream: 'core', spool: 'HP', nr0: 34, nr1: 72, igv: true, nIgv: 36, comp: 'hpc' }),
    { x0: 2.005, x1: 2.055, stream: 'core', rotor: false, n: 34, kind: 'ngv', comp: 'hpt', stage: 0 },
    { x0: 2.07, x1: 2.14, stream: 'core', rotor: true, spool: 'HP', n: 66, kind: 'turb', comp: 'hpt', stage: 0 },
    ...stageRows(2.20, 2.55, 2, { stream: 'core', spool: 'LP', nr0: 72, nr1: 80, turbine: true, sRatio: 0.6, comp: 'lpt' }),
  ], s);
  const abX0 = 3.35 * s;
  const fhRings = [0.16 * s, 0.32 * s];
  return {
    type: 'lbtf', s,
    lines: { hub, tip, casIn, casOut, coreCas, linerIn, linerOut },
    streams: {
      inlet: { x0: 0, x1: 0.85 * s, lo: hub, hi: casIn, gas: 'cold' },
      core: { x0: 0.85 * s, x1: 2.75 * s, lo: hub, hi: tip },
      bypass: { x0: 0.85 * s, x1: 2.75 * s, lo: coreCas, hi: casIn, gas: 'cold' },
      ab: { x0: 2.75 * s, x1: xe, lo: hub, hi: casIn },
    },
    order: ['inlet', 'core', 'bypass', 'ab'],
    split: { x: 0.85 * s, from: 'inlet', inner: 'core', outer: 'bypass' },
    bodies: [
      { key: 'casing', poly: casPoly, mat: 'casing' },
      { key: 'hub', poly: hubPoly, mat: 'hub' },
      { key: 'coreCase', poly: corePoly, mat: 'cowl' },
      { key: 'linerIn', poly: stripPoly(linerIn, 1.66 * s, 2.0 * s, 0.006 * s), mat: 'liner' },
      { key: 'linerOut', poly: stripPoly(linerOut, 1.66 * s, 2.0 * s, 0.006 * s), mat: 'liner' },
      { key: 'dome', poly: [[1.657 * s, 0.262 * s], [1.665 * s, 0.262 * s], [1.665 * s, 0.375 * s], [1.657 * s, 0.375 * s]], mat: 'liner' },
      ...fhRings.map((r, i) => ({ key: 'fh' + i, poly: vGutter(abX0, r, 0.035 * s), mat: 'fh' })),
    ],
    rows,
    comb: { x0: 1.58 * s, xd: 1.66 * s, x1: 2.0 * s, linerIn, linerOut, n: 18, cannular: false, stream: 'core', turbEnd: 2.55 * s },
    ab: { stream: 'ab', xSpray: 3.15 * s, xFH: abX0, x1: 4.3 * s, rings: fhRings, xNoz: 4.3 * s, xt: 4.6 * s, xe },
    mixer: { x: 2.75 * s, lobes: 16, coreFrac: 0.625 },
    comps: [
      { key: 'inlet', name: '進氣道', en: 'Inlet', x0: -0.03 * s, x1: 0.30 * s, stream: 'inlet' },
      { key: 'fan', name: '風扇（三級）', en: 'Fan', x0: 0.30 * s, x1: 0.75 * s, stream: 'inlet' },
      { key: 'split', name: '分流段', en: 'Splitter', x0: 0.75 * s, x1: 0.955 * s, stream: '*' },
      { key: 'byp', name: '外涵道', en: 'Bypass duct', x0: 0.85 * s, x1: 2.75 * s, stream: 'bypass' },
      { key: 'hpc', name: '高壓壓氣機', short: '高壓', en: 'HPC', x0: 0.955 * s, x1: 1.55 * s, stream: 'core' },
      { key: 'comb', name: '燃燒室', short: '燃燒', en: 'Combustor', x0: 1.55 * s, x1: 2.0 * s, stream: 'core' },
      { key: 'hpt', name: '高壓渦輪', short: '高渦', en: 'HPT', x0: 2.0 * s, x1: 2.15 * s, stream: 'core' },
      { key: 'lpt', name: '低壓渦輪', short: '低渦', en: 'LPT', x0: 2.2 * s, x1: 2.55 * s, stream: 'core' },
      { key: 'mix', name: '混合器', short: '混合', en: 'Mixer', x0: 2.55 * s, x1: 3.0 * s, stream: '*' },
      { key: 'ab', name: '後燃器', short: '後燃', en: 'Afterburner', x0: 3.0 * s, x1: 4.3 * s, stream: 'ab' },
      { key: 'noz', name: '收斂-擴張噴嘴', short: '噴嘴', en: 'C-D nozzle', x0: 4.3 * s, x1: 4.95 * s, stream: 'ab' },
    ],
    chartComps: ['fan', 'hpc', 'comb', 'hpt', 'lpt', 'mix', 'ab', 'noz'],
    stations: [
      { id: '2', x: 0.30 * s, stream: 'inlet' }, { id: '13', x: 0.88 * s, stream: 'bypass' },
      { id: '25', x: 0.955 * s, stream: 'core' }, { id: '3', x: 1.55 * s, stream: 'core' },
      { id: '4', x: 2.005 * s, stream: 'core' }, { id: '45', x: 2.17 * s, stream: 'core' },
      { id: '5', x: 2.55 * s, stream: 'core' }, { id: '16', x: 2.7 * s, stream: 'bypass' },
      { id: '6A', x: 3.0 * s, stream: 'ab' }, { id: '7', x: 4.3 * s, stream: 'ab' },
      { id: '8', x: 4.6 * s, stream: 'ab' }, { id: '9', x: xe, stream: 'ab' },
    ],
    lip: { x: 0, r: 0.49 * s, rOut: 0.54 * s },
    outer: casOut, outerEnd: xe,
    exitsGeom: [{ key: 'core', x: xe, R: r9, Rin: 0 }],
    nozzle: { x0: 4.3 * s, xt: 4.6 * s, xe, r8, r9, rDuct: 0.44 * s },
    domain: { xb: [-1.5 * s, 0, 5.3 * s, 12 * s], ub: [0, 0.1, 0.66, 1], rb: [0, 0.66 * s, 1.35 * s], vb: [0, 0.8, 1] },
    view: { target: [2.35 * s, 0.0, 0], dist: 6.6 * s, len: 4.95 * s, Rmax: 0.54 * s },
    secR: 0.6 * s,
  };
}
function vGutter(x0, r, h) { // 後燃器 V 形火焰穩定器（開口朝下游）
  return [[x0, r], [x0 + h * 1.1, r + h * 0.5], [x0 + h * 1.1, r + h * 0.38], [x0 + h * 0.18, r], [x0 + h * 1.1, r - h * 0.38], [x0 + h * 1.1, r - h * 0.5]];
}

if (typeof module !== 'undefined') module.exports = { buildSpec, Line, pointInPoly, bbox };
