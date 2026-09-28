/* ============================================================
 *  cfd_grid.js — 軸對稱 CFD 網格、固體遮罩、體積力／熱源區域、初始場
 * ============================================================ */
const RGAS = 287.05;
const gamOfY = Y => 1.4 - 0.07 * Y;          // 空氣 1.40 → 燃燒產物 1.33
const COMP_ID = { fan: 1, lpc: 2, hpc: 3, comp: 3, comb: 4, hpt: 5, turb: 5, lpt: 6, ab: 7 };
const COMP_NAME = { 1: '風扇', 2: '增壓級', 3: '高壓壓氣機', 4: '燃燒室', 5: '高壓渦輪', 6: '低壓渦輪', 7: '後燃器' };
const GRID_LEVELS = { xcoarse: { nx: 120, nr: 70, label: '極粗' }, coarse: { nx: 190, nr: 110, label: '粗' }, medium: { nx: 320, nr: 200, label: '中' }, fine: { nx: 460, nr: 290, label: '細' } };

/* 單軸面座標：多個加密帶 [a,b,h]，帶外以比例 g 增長，上限 hmax */
function axisFaces(lo, hi, bands, g, hmax) {
  const hAt = x => {
    let h = hmax;
    for (const [a, b, hb] of bands) { const d = x < a ? a - x : x > b ? x - b : 0; h = Math.min(h, hb + (g - 1) * d); }
    return h;
  };
  const f = [lo];
  let x = lo;
  while (x < hi - 1e-9) {
    const h = hAt(x + 0.5 * hAt(x));
    x += h;
    if (hi - x < 0.35 * h) x = hi;
    f.push(Math.min(x, hi));
  }
  return Float64Array.from(f);
}

function buildCFDGrid(spec, level) {
  const L = GRID_LEVELS[level] || GRID_LEVELS.medium;
  const s = spec.s, dom = spec.domain, len = spec.view.len, Rm = spec.view.Rmax;
  const x0 = dom.xb[0], x1 = dom.xb[dom.xb.length - 1];
  const r1 = dom.rb[dom.rb.length - 1];
  const hx = len / L.nx, hr = Rm / L.nr;
  const xf = axisFaces(x0, x1, [[-0.04 * len, 1.04 * len, hx]], 1.045, 16 * hx);
  // 高涵道渦扇：核心流道半徑帶加密（核心通道遠小於風扇）
  const rb = spec.type === 'hbtf' ? [[0, 1.06 * Rm, hr * 1.5], [0.11 * s, 0.43 * s, hr * 0.55]] : [[0, 1.06 * Rm, hr]];
  const rf = axisFaces(0, r1, rb, 1.05, 14 * hr);
  const W = xf.length - 1, H = rf.length - 1;
  const xc = new Float64Array(W), dx = new Float64Array(W), rc = new Float64Array(H), dr = new Float64Array(H);
  for (let i = 0; i < W; i++) { xc[i] = 0.5 * (xf[i] + xf[i + 1]); dx[i] = xf[i + 1] - xf[i]; }
  for (let j = 0; j < H; j++) { rc[j] = 0.5 * (rf[j] + rf[j + 1]); dr[j] = rf[j + 1] - rf[j]; }
  return { W, H, N: W * H, xf, rf, xc, rc, dx, dr, level };
}

/* 沿垂直線 x 的固體區間（物體多邊形內、且不屬於任何流道） */
function solidIntervals(spec, bodies, x) {
  const segs = [];
  for (const b of bodies) {
    const bb = b.bb; if (x < bb[0] || x > bb[1]) continue;
    const P = b.poly, cr = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
      const x1 = P[j][0], r1 = P[j][1], x2 = P[i][0], r2 = P[i][1];
      if ((x1 > x) !== (x2 > x)) cr.push(r1 + (r2 - r1) * (x - x1) / (x2 - x1));
    }
    cr.sort((p, q) => p - q);
    for (let k = 0; k + 1 < cr.length; k += 2) segs.push([cr[k], cr[k + 1]]);
  }
  // 扣除流道
  let out = segs;
  for (const key of spec.order) {
    const st = spec.streams[key]; if (x < st.x0 || x > st.x1) continue;
    const lo = st.lo.at(x), hi = st.hi.at(x), nx = [];
    for (const [a, c] of out) {
      if (c <= lo || a >= hi) { nx.push([a, c]); continue; }
      if (a < lo) nx.push([a, lo]);
      if (c > hi) nx.push([hi, c]);
    }
    out = nx;
  }
  return out;
}
function solidLen(iv, r0, r1, rw) { // [r0,r1] 內固體長度（rw：以 r 加權）
  let s = 0;
  for (const [a, c] of iv) { const lo = Math.max(a, r0), hi = Math.min(c, r1); if (hi > lo) s += rw ? 0.5 * (hi * hi - lo * lo) : hi - lo; }
  return s;
}
function isSolidAt(iv, r) { for (const [a, c] of iv) if (r > a && r < c) return true; return false; }

/* 區域：切割格（體積分率 φ、東面／北面開口分率 αE、αN）、流道、元件編號、權重（1/m）、混合長度 */
let zonesSplitCount = 0;
function buildZones(grid, spec, model, op, P) {
  const { W, H, N, xc, rc, dx, dr, xf, rf } = grid, s = spec.s;
  const solid = new Uint8Array(N), mat = new Uint8Array(N), stream = new Int8Array(N);
  const comp = new Uint8Array(N), wgt = new Float32Array(N), lmix = new Float32Array(N);
  const phi = new Float32Array(N), ae = new Float32Array(N), an = new Float32Array(N);
  const matId = { nacelle: 1, casing: 1, hub: 2, cowl: 3, liner: 4, fh: 4 };
  const bodies = model.bodies.filter(b => b.mat !== 'liner' && b.mat !== 'fh');
  const NS = 8, split = new Uint8Array(N), splitFr = new Float32Array(N);
  for (let i = 0; i < W; i++) {
    const ivF = solidIntervals(spec, bodies, xf[i + 1]);
    const ivs = [];
    for (let q = 0; q < NS; q++) ivs.push(solidIntervals(spec, bodies, xf[i] + dx[i] * (q + 0.5) / NS));
    const ivC = solidIntervals(spec, bodies, xc[i]);
    for (let j = 0; j < H; j++) {
      const k = j * W + i, r0 = rf[j], r1 = rf[j + 1], vr = 0.5 * (r1 * r1 - r0 * r0);
      let f = 0; for (const iv of ivs) f += 1 - solidLen(iv, r0, r1, true) / vr;
      phi[k] = f / NS;
      ae[k] = 1 - solidLen(ivF, r0, r1, false) / (r1 - r0);
      let o = 0; for (const iv of ivs) if (!isSolidAt(iv, r1)) o++;
      an[k] = o / NS;
      // 流道歸屬：取格內流體點
      let rs = rc[j];
      if (isSolidAt(ivC, rs)) { for (let q = 1; q <= 6; q++) { const rr = r0 + (r1 - r0) * q / 7; if (!isSolidAt(ivC, rr)) { rs = rr; break; } } }
      // 薄壁（整段落在格內、不觸及上下面）：格只保留較大的一側，並關閉另一側的徑向面，避免兩流道經同一格互通
      let nIn = 0, aS = 0, cS = 0;
      for (const iv of ivs) for (const [a, c] of iv) if (a > r0 + 1e-9 && c < r1 - 1e-9) { nIn++; aS += a; cS += c; break; }
      if (nIn * 2 >= NS) {
        const a = aS / nIn, c = cS / nIn, lo = 0.5 * (a * a - r0 * r0) / vr, up = 0.5 * (r1 * r1 - c * c) / vr;
        const keepLow = lo >= up;
        split[k] = keepLow ? 1 : 2; splitFr[k] = keepLow ? (a - r0) / (r1 - r0) : (r1 - c) / (r1 - r0);
        phi[k] = keepLow ? lo : up; ae[k] = Math.min(ae[k], splitFr[k]);
        rs = keepLow ? 0.5 * (r0 + a) : 0.5 * (c + r1);
      }
      const cl = model.classify(xc[i], rs);
      stream[k] = cl.kind === 'stream' ? spec.order.indexOf(cl.key) : cl.kind === 'solid' ? -1 : -1;
      const cc = model.classify(xc[i], rc[j]);
      mat[k] = cc.kind === 'solid' ? (matId[cc.mat] || 1) : 1;
    }
  }
  for (let k = 0; k < N; k++) if (split[k]) {
    const i = k % W, j = (k / W) | 0;
    if (split[k] === 1) an[k] = 0; else if (j > 0) an[k - W] = 0;
    if (i > 0) ae[k - 1] = Math.min(ae[k - 1], splitFr[k]);
  }
  zonesSplitCount = split.reduce((a, v) => a + (v ? 1 : 0), 0);
  // 過小的切割格併入固體；關閉相鄰面
  for (let k = 0; k < N; k++) if (phi[k] < 0.08) { phi[k] = 0; solid[k] = 1; stream[k] = -2; }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (solid[k] || i === W - 1 || solid[k + 1]) ae[k] = i === W - 1 && !solid[k] ? 1 : 0;
    if (solid[k] || j === H - 1 || solid[k + W]) an[k] = j === H - 1 && !solid[k] ? 1 : 0;
    ae[k] = Math.min(ae[k], 1); an[k] = Math.min(an[k], 1);
  }
  // 流道標記補齊：與外部遠場不連通、但未落在任何流道內的流體格（燃燒室穹頂、切割格等），
  // 以多源廣度優先搜尋指定為相鄰流道（經開口面連通）。
  {
    const open = (k, d) => d === 0 ? ae[k] > 0 : d === 1 ? ae[k - 1] > 0 : d === 2 ? an[k] > 0 : an[k - W] > 0; // 0 東 1 西 2 北 3 南
    const nb = (k, d) => { const i = k % W, j = (k / W) | 0; if (d === 0) return i < W - 1 ? k + 1 : -1; if (d === 1) return i > 0 ? k - 1 : -1; if (d === 2) return j < H - 1 ? k + W : -1; return j > 0 ? k - W : -1; };
    const ext = new Uint8Array(N); let q = [];
    for (let k = 0; k < N; k++) { const i = k % W, j = (k / W) | 0; if (!solid[k] && stream[k] < 0 && (i === 0 || i === W - 1 || j === H - 1)) { ext[k] = 1; q.push(k); } }
    while (q.length) { const nq = []; for (const k of q) for (let d = 0; d < 4; d++) { const m = nb(k, d); if (m < 0 || solid[m] || ext[m] || stream[m] >= 0 || !open(k, d)) continue; ext[m] = 1; nq.push(m); } q = nq; }
    q = []; for (let k = 0; k < N; k++) if (!solid[k] && stream[k] >= 0) q.push(k);
    while (q.length) { const nq = []; for (const k of q) for (let d = 0; d < 4; d++) { const m = nb(k, d); if (m < 0 || solid[m] || ext[m] || stream[m] >= 0 || !open(k, d)) continue; stream[m] = stream[k]; nq.push(m); } q = nq; }
  }
  // 葉片排（僅轉子做功）
  const rot = spec.rows.filter(r => r.rotor);
  const nRot = {};
  for (const r of rot) nRot[r.comp] = (nRot[r.comp] || 0) + 1;
  for (const r of rot) {
    const id = COMP_ID[r.comp]; if (!id) continue;
    const si = spec.order.indexOf(r.stream);
    for (let i = 0; i < W; i++) {
      const ov = Math.min(r.x1, grid.xf[i + 1]) - Math.max(r.x0, grid.xf[i]);
      if (ov <= 0) continue;
      const w = (ov / dx[i]) / ((r.x1 - r.x0) * nRot[r.comp]);
      for (let j = 0; j < H; j++) { const k = j * W + i; if (!solid[k] && stream[k] === si) { comp[k] = id; wgt[k] += w; } }
    }
  }
  // 燃燒室與後燃器：以目標總溫鬆弛的熱源（逐格 tgt、rate、yRate）
  const tgt = new Float32Array(N), rate = new Float32Array(N), yrate = new Float32Array(N);
  const cb = spec.comb, ci = spec.order.indexOf(cb.stream);
  for (let i = 0; i < W; i++) {
    if (xc[i] < cb.xd || xc[i] > cb.x1) continue;
    for (let j = 0; j < H; j++) { const k = j * W + i; if (!solid[k] && stream[k] === ci) comp[k] = 4; }
  }
  if (spec.ab) {
    const ab = spec.ab, ai = spec.order.indexOf(ab.stream);
    for (let i = 0; i < W; i++) {
      if (xc[i] < ab.xFH || xc[i] > ab.x1) continue;
      for (let j = 0; j < H; j++) { const k = j * W + i; if (!solid[k] && stream[k] === ai) comp[k] = 7; }
    }
  }
  const zones = { solid, mat, stream, comp, wgt, lmix, tgt, rate, yrate, mfd: new Float32Array(N), phi, ae, an };
  updateHeatZones(grid, zones, spec, op);
  // 混合長度（Prandtl）：噴流剪切層 l = 0.075·δ，δ 自出口起線性成長
  const ex = spec.exitsGeom;
  const xe0 = Math.min(...ex.map(e => e.x)), Rj = Math.max(...ex.map(e => e.R));
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; if (solid[k]) continue;
    const x = xc[i];
    if (stream[k] >= 0) {
      const st = spec.streams[spec.order[stream[k]]];
      const h = Math.max(1e-4, st.hi.at(x) - st.lo.at(x));
      lmix[k] = (comp[k] === 4 || comp[k] === 7 ? 0.07 : 0.025) * h;
    } else {
      const dxe = x - xe0;
      lmix[k] = dxe > 0 ? 0.075 * (0.05 * Rj + 0.12 * dxe) : 0.004 * s;
    }
  }
  return zones;
}

/* 熱源目標場：燃燒室目標總溫分布（主燃區→摻混→出口溫度剖面），後燃器火焰面 */
function updateHeatZones(grid, zones, spec, op) {
  const { W, H, xc, rc } = grid, s = spec.s;
  const { comp, tgt, rate, yrate, solid } = zones;
  const cb = spec.comb, Tt3 = op.Tt3, Tt4 = op.Tt4, dT = Math.max(1, Tt4 - Tt3);
  const Tpz = Math.min(Tt3 + 1.9 * dT, 2480, Tt3 + 1800);
  const tauC = 0.1 * (cb.x1 - cb.xd);  // 鬆弛長度 (m)
  const ab = spec.ab, tauA = ab ? 0.08 * (ab.x1 - ab.xFH) : 1;
  const mStream = streamMassFlows(spec, op);
  const colMfd = {};
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; tgt[k] = 0; rate[k] = 0; yrate[k] = 0; zones.mfd[k] = 0;
    if (solid[k]) continue;
    const x = xc[i], r = rc[j];
    if (comp[k] && comp[k] !== 4 && comp[k] !== 7) { // 葉片排：設計質量通量（循環流量 ÷ 幾何環面積）
      const key = spec.order[zones.stream[k]], st = spec.streams[key];
      const lo = st.lo.at(x), hi = st.hi.at(x), A = Math.PI * (hi * hi - lo * lo);
      const m = key === 'core' && comp[k] >= 5 ? mStream.core4 : mStream[key];
      zones.mfd[k] = m / Math.max(A, 1e-6);
    }
    if (comp[k] === 4) {
      const st = spec.streams[cb.stream], lo = st.lo.at(x), hi = st.hi.at(x);
      const sN = (x - cb.xd) / (cb.x1 - cb.xd), psi = clamp((r - lo) / Math.max(1e-6, hi - lo), 0, 1);
      const li = cb.linerIn.at(x), lu = cb.linerOut.at(x);
      const pl = (r - li) / Math.max(1e-6, lu - li);
      const Tline = sN < 0.3 ? Tt3 + (Tpz - Tt3) * smooth(0.0, 0.26, sN) : Tt4 + (Tpz - Tt4) * Math.exp(-3.4 * (sN - 0.3) / 0.7);
      const gP = pl < 0 || pl > 1 ? 0 : 0.25 + 0.75 * Math.exp(-(((pl - 0.5) / 0.26) ** 2));
      const gE = 1 + 0.3 * (Math.sin(Math.PI * psi) - 2 / Math.PI);
      const G = lerp(gP, gE, smooth(0.3, 1, sN));
      tgt[k] = Tt3 + (Tline - Tt3) * G;
      rate[k] = 1 / tauC;
      yrate[k] = G > 0.35 ? 1 / tauC : 0;
    } else if (comp[k] === 7 && op.abOn) {
      const t = (x - ab.xFH) / (ab.x1 - ab.xFH);
      const spread = (x - ab.xFH) * Math.tan(7 * DEG) + 0.006 * s;
      let F = 0;
      for (const rg of ab.rings) F = Math.max(F, 1 - smooth(spread * 0.5, spread, Math.abs(r - rg)));
      F = Math.max(F, smooth(0.5, 1.0, t));
      tgt[k] = op.Tt7; rate[k] = F / tauA; yrate[k] = F / tauA;
    }
  }
}

function streamMassFlows(spec, op) {
  if (spec.type === 'tj') return { core: op.mdot, core4: op.mdot * (1 + op.f) };
  const m4 = op.mcore * (1 + op.f);
  return { inlet: op.mdot, core: op.mcore, core4: m4, bypass: op.mbyp, ab: op.m7 || m4 + op.mbyp };
}
/* 以幾何環面積求一維馬赫數（使初始場質量守恆） */
function streamState1D(model, key, x) {
  const kn = model.kn[key], sp = model.spec, st = sp.streams[key];
  let lo = 0, hi = kn.length - 1;
  if (x <= kn[0].x) hi = 0; else if (x >= kn[hi].x) lo = hi;
  else while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kn[m].x <= x) lo = m; else hi = m; }
  const a = kn[lo], b = kn[hi], t = hi === lo || b.x - a.x < 1e-9 ? 0 : (x - a.x) / (b.x - a.x);
  const Tt = lerp(a.Tt, b.Tt, t), Pt = a.Pt * Math.pow(b.Pt / a.Pt, t), g = lerp(a.g, b.g, t), R = lerp(a.R, b.R, t);
  const md = lerp(a.mdot, b.mdot, t);
  const A = Math.PI * (st.hi.at(x) ** 2 - st.lo.at(x) ** 2);
  let M;
  if (a.noz >= 0 && b.noz >= 0) M = lerp(a.M, b.M, t);
  else M = invMfp(md * Math.sqrt(Tt) / (Pt * Math.max(A, 1e-6)), g, R, false);
  M = Math.min(M, 0.95);
  const k = 1 + 0.5 * (g - 1) * M * M, T = Tt / k, p = Pt / Math.pow(k, g / (g - 1));
  return { T, p, u: M * Math.sqrt(g * R * T), Tt };
}

/* 元件參數：每元件 [ln τ（總溫比）, 多變效率 e, 型別 1 壓縮／2 膨脹, 0] */
function compParams(type, op, P) {
  const e = P.eff;
  const c = new Float64Array(8 * 4);
  const set = (id, tau, ek, ty) => { c[id * 4] = Math.log(tau); c[id * 4 + 1] = ek; c[id * 4 + 2] = ty; };
  // 熱源（型別 0）：[基準總溫, 控制係數 K]；目標 = 基準 + (逐格目標 − 基準)·K
  c[4 * 4] = op.Tt3; c[4 * 4 + 1] = 1; c[7 * 4] = op.Tt6 || op.Tt5 || 0; c[7 * 4 + 1] = 1;
  if (type === 'hbtf') {
    set(1, op.Tt13 / op.Tt2, e.ef, 1); set(2, op.Tt25 / op.Tt13, e.ec, 1); set(3, op.Tt3 / op.Tt25, e.ec, 1);
    set(5, op.Tt45 / op.Tt4, e.et, 2); set(6, op.Tt5 / op.Tt45, e.et, 2);
  } else if (type === 'tj') {
    set(3, op.Tt3 / op.Tt2, e.ec, 1); set(5, op.Tt5 / op.Tt4, e.et, 2);
  } else {
    set(1, op.Tt13 / op.Tt2, e.ef, 1); set(3, op.Tt3 / op.Tt13, e.ec, 1);
    set(5, op.Tt45 / op.Tt4, e.et, 2); set(6, op.Tt5 / op.Tt45, e.et, 2);
  }
  return c;
}

/* 初始場：以循環重建場為起點（或均勻自由流） */
function initialState(grid, zones, spec, model, fl, uniform) {
  const { W, H, N, xc, rc } = grid;
  const Q = [new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N), new Float64Array(N)];
  const o = {};
  const cb = spec.comb, c = model.c;
  const hotEx = model.exits.reduce((a, e) => (e.dTt > (a ? a.dTt : -1e9) ? e : a), null);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    let rho, u, p, Y = 0;
    if (uniform || zones.solid[k]) { p = fl.P0; rho = fl.P0 / (RGAS * fl.T0); u = uniform ? fl.V0 : 0; }
    else {
      model.sample(xc[i], rc[j], 0, o);
      if (o.solid) { p = fl.P0; rho = fl.P0 / (RGAS * fl.T0); u = 0; }
      else {
        const st = zones.stream[k] >= 0 ? spec.order[zones.stream[k]] : null;
        if (st) { const q = streamState1D(model, st, xc[i]); o.P = q.p; o.T = q.T; o.Vx = q.u; o.Tt = q.Tt; }
        p = o.P; rho = o.P / (RGAS * o.T); u = o.Vx;
        if (st === cb.stream && xc[i] > cb.xd) Y = smooth(cb.xd, cb.x1, xc[i]);
        if (st === 'ab') Y = clamp((o.Tt - c.Tt13) / Math.max(1, c.Tt5 - c.Tt13), 0, 1);
        if (!st && hotEx && hotEx.dTt > 50 && xc[i] > hotEx.x) Y = clamp((o.Tt - fl.Tt0) / hotEx.dTt, 0, 1);
      }
    }
    const g = gamOfY(Y);
    Q[0][k] = rho; Q[1][k] = rho * u; Q[2][k] = 0; Q[3][k] = p / (g - 1) + 0.5 * rho * u * u; Q[4][k] = rho * Y;
  }
  return Q;
}

if (typeof module !== 'undefined') module.exports = { buildCFDGrid, buildZones, updateHeatZones, compParams, streamState1D, initialState, gamOfY, RGAS, COMP_ID, COMP_NAME, GRID_LEVELS };
