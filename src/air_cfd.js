/* ============================================================
 *  air_cfd.js — 全機 3D CFD：可壓縮 Euler 方程
 *  - 對稱半域（y ≥ 0）、直角伸展網格（機體附近等間距，外圍等比放大）
 *  - 有限體積：MUSCL（minmod，原始變數）＋ HLLC 通量、Heun 二階 Runge–Kutta、局部時間步
 *  - 邊界：遠場（自由流虛格）、對稱面（鏡射）、機體（切割格：體積分率與面開口率，薄翼以隔板面表示）、
 *          引擎進氣面（固定狀態吸入格）、噴嘴出口（固定狀態噴流格，由一維循環出口條件給定）
 *  - GPU：WebGL2 片段著色器，z 切片拼貼於 2D 紋理、MRT 兩張 RGBA32F；CPU：相同演算法（後備與驗證）
 *  無因次化：ρ∞ = 1、a∞ = 1、p∞ = 1/γ，長度以公尺計
 * ============================================================ */
const CFD_GRIDS = { coarse: { cells: 150e3, label: '粗' }, medium: { cells: 380e3, label: '中' }, fine: { cells: 820e3, label: '細' } };
const CG = 1.4;

/* ---------- 網格 ---------- */
function cfdAxis(c0, c1, h, lo, hi, r) {
  const n = Math.max(1, Math.round((c1 - c0) / h)), hh = (c1 - c0) / n, f = [];
  for (let i = 0; i <= n; i++) f.push(c0 + i * hh);
  if (lo < c0 - 1e-9) { let d = hh, x = c0; const L = []; while (x > lo + 1e-9) { d *= r; x -= d; L.push(x); } L[L.length - 1] = lo; if (L.length > 1 && (L[L.length - 2] - lo) < 0.5 * (L.length > 2 ? L[L.length - 3] - L[L.length - 2] : hh)) L.splice(L.length - 2, 1); f.unshift(...L.reverse()); }
  if (hi > c1 + 1e-9) { let d = hh, x = c1; const R = []; while (x < hi - 1e-9) { d *= r; x += d; R.push(x); } R[R.length - 1] = hi; if (R.length > 1 && (hi - R[R.length - 2]) < 0.5 * (R.length > 2 ? R[R.length - 2] - R[R.length - 3] : hh)) R.splice(R.length - 2, 1); f.push(...R); }
  return f;
}
function cfdGrid(ac, level) {
  const L = ac.fus.L, w = ac.wing, ht = ac.htail, vt = ac.vtail, sp = ac.spec, Lc = Math.max(L, ac.ref.b);
  let x0 = -0.02 * L, x1 = Math.max(L, ht.xLE(ht.semi) + ht.ct, vt.xLE(vt.semi) + vt.ct) + 0.03 * L;
  let y1 = Math.max(w.semi, ht.semi) + 0.03 * Lc, z0 = -ac.fus.R0 - 0.03 * L, z1 = vt.o.z0 + vt.semi + 0.02 * L;
  for (const e of ac.engines) { x0 = Math.min(x0, e.x0 - 0.02 * L); x1 = Math.max(x1, e.x0 + sp.exitsGeom[sp.exitsGeom.length - 1].x + 0.05 * L); if (!e.internal) { y1 = Math.max(y1, e.y + sp.view.Rmax + 0.03 * Lc); z0 = Math.min(z0, e.z - sp.view.Rmax - 0.03 * L); } }
  z0 = Math.min(z0, w.pt(w.semi, 0.5, 0, 0)[2] - 0.05 * L, ht.o.z0 - 0.05 * L);
  const lim = { x0: x0 - 0.55 * Lc, x1: x1 + 0.9 * Lc, y1: y1 + 0.6 * Lc, z0: z0 - 0.6 * Lc, z1: z1 + 0.6 * Lc };
  const target = CFD_GRIDS[level].cells, r = 1.14;
  let h = Math.cbrt((x1 - x0) * y1 * (z1 - z0) / (target * 0.6)), ax;
  for (let it = 0; it < 6; it++) {
    ax = [cfdAxis(x0, x1, h, lim.x0, lim.x1, r), cfdAxis(0, y1, h, 0, lim.y1, r), cfdAxis(z0, z1, h, lim.z0, lim.z1, r)];
    const n = (ax[0].length - 1) * (ax[1].length - 1) * (ax[2].length - 1);
    h *= Math.cbrt(n / target); if (Math.abs(n / target - 1) < 0.04) break;
  }
  ax = [cfdAxis(x0, x1, h, lim.x0, lim.x1, r), cfdAxis(0, y1, h, 0, lim.y1, r), cfdAxis(z0, z1, h, lim.z0, lim.z1, r)];
  const mk = f => { const n = f.length - 1, c = new Float32Array(n), d = new Float32Array(n); for (let i = 0; i < n; i++) { c[i] = 0.5 * (f[i] + f[i + 1]); d[i] = f[i + 1] - f[i]; } return { f: Float64Array.from(f), c, d, n }; };
  const X = mk(ax[0]), Y = mk(ax[1]), Z = mk(ax[2]);
  const g = { X, Y, Z, NX: X.n, NY: Y.n, NZ: Z.n, N: X.n * Y.n * Z.n, h, level, core: { x0, x1, y1, z0, z1 } };
  // 紋理拼貼：寬 cols·NX、高 rows·NY
  let cols = Math.max(1, Math.round(Math.sqrt(g.NZ * g.NY / g.NX)));
  while (cols * g.NX > 4096 && cols > 1) cols--;
  g.cols = cols; g.rows = Math.ceil(g.NZ / cols); g.TW = cols * g.NX; g.TH = g.rows * g.NY;
  return g;
}
const cidx = (g, i, j, k) => (k * g.NY + j) * g.NX + i;

/* ---------- 幾何：格型別、流體體積分率 φ、面開口率（+ 面）----------
 *  型別：0 流體、1 實體、3 進氣吸入、4 外涵噴流、5 核心噴流
 *  短艙以子午線外包絡為實體（進氣面、出口面為固定狀態格）；翼與平尾中弧面另設「隔板」面（薄翼） */
function cfdGeom(ac, G, g, deltaDeg) {
  const NX = g.NX, NY = g.NY, NZ = g.NZ, N = g.N, X = g.X, Y = g.Y, Z = g.Z, sp = ac.spec;
  const envs = ac.engines.filter(e => !e.internal && e.meridian).map(e => {
    const mer = e.meridian, xmax = mer[mer.length - 1][0], n = 300, R = new Float32Array(n + 1);
    for (let k = 0; k <= n; k++) { const xe = xmax * k / n; let r = 0; for (let q = 0; q < mer.length - 1; q++) { const [xa, ra] = mer[q], [xb, rb] = mer[q + 1]; if (xe >= Math.min(xa, xb) - 1e-9 && xe <= Math.max(xa, xb) + 1e-9) r = Math.max(r, xb > xa ? ra + (rb - ra) * (xe - xa) / (xb - xa) : Math.max(ra, rb)); } R[k] = r; }
    return { e, xmax, n, R };
  });
  const ht = ac.htail, dR = (deltaDeg || 0) * DEG, hp = [ht.xLE(0) + 0.25 * ht.cr, ht.o.z0], cR = Math.cos(dR), sR = Math.sin(dR);
  // 升力面平均厚度小於 1.5 格時僅以隔板表示（避免次格厚度造成的虛假壓力阻力）
  const thick = Sx => 0.5 * (Sx.o.tcR * Sx.cr + Sx.o.tcT * Sx.ct) >= 1.5 * g.h, volW = thick(ac.wing), volH = thick(ht), volV = thick(ac.vtail); // 垂尾位於對稱面：薄時由對稱面代表
  const solidAt = (x, y, z) => {
    const ay = Math.abs(y);
    for (const v of envs) { const xe = x - v.e.x0; if (xe < 0 || xe > v.xmax) continue; const f = xe / v.xmax * v.n, k = Math.min(v.n - 1, Math.floor(f)), r = v.R[k] + (v.R[k + 1] - v.R[k]) * (f - k); if (Math.hypot(ay - v.e.y, z - v.e.z) < r) return true; }
    if (G.inFus(x, ay, z)) return true;
    if (volW && ay >= G.sW * 0.9 && G.inLift(ac.wing, G.sW, G.bW, x, ay, z)) return true;
    if (volH && ay >= G.sH * 0.9) { const dx = x - hp[0], dz = z - hp[1]; if (G.inLift(ht, G.sH, G.bH, hp[0] + dx * cR - dz * sR, ay, hp[1] + dx * sR + dz * cR)) return true; }
    return volV && G.inVt(x, ay, z);
  };
  const NX1 = NX + 1, NXY1 = NX1 * (NY + 1), cin = new Uint8Array(NXY1 * (NZ + 1));
  for (let k = 0; k <= NZ; k++) for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) cin[k * NXY1 + j * NX1 + i] = solidAt(X.f[i], Y.f[j], Z.f[k]) ? 1 : 0;
  const cn = (i, j, k) => cin[k * NXY1 + j * NX1 + i];
  const t = new Uint8Array(N), phi = new Float32Array(N), ap = [new Float32Array(N).fill(1), new Float32Array(N).fill(1), new Float32Array(N).fill(1), new Float32Array(N)];
  const SUB = [1 / 6, 0.5, 5 / 6];
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const q = cidx(g, i, j, k);
    let s = 0; for (let c = 0; c < 8; c++) s += cn(i + (c & 1), j + ((c >> 1) & 1), k + (c >> 2));
    if (s === 0) phi[q] = 1; else if (s === 8) phi[q] = 0;
    else { let n = 0; for (const a of SUB) for (const b of SUB) for (const c of SUB) if (!solidAt(X.f[i] + a * X.d[i], Y.f[j] + b * Y.d[j], Z.f[k] + c * Z.d[k])) n++; phi[q] = n / 27; }
    // + 面開口率
    for (let d = 0; d < 3; d++) {
      const fc = d === 0 ? [[i + 1, j, k], [i + 1, j + 1, k], [i + 1, j, k + 1], [i + 1, j + 1, k + 1]] : d === 1 ? [[i, j + 1, k], [i + 1, j + 1, k], [i, j + 1, k + 1], [i + 1, j + 1, k + 1]] : [[i, j, k + 1], [i + 1, j, k + 1], [i, j + 1, k + 1], [i + 1, j + 1, k + 1]];
      let m = 0; for (const c of fc) m += cn(c[0], c[1], c[2]);
      if (m === 0) continue; if (m === 4) { ap[d][q] = 0; continue; }
      let n = 0;
      for (const a of SUB) for (const b of SUB) {
        const x = d === 0 ? X.f[i + 1] : X.f[i] + a * X.d[i], y = d === 1 ? Y.f[j + 1] : Y.f[j] + (d === 0 ? a : b) * Y.d[j], z = d === 2 ? Z.f[k + 1] : Z.f[k] + b * Z.d[k];
        if (!solidAt(x, y, z)) n++;
      }
      ap[d][q] = n / 9;
    }
  }
  // 薄翼隔板：最接近中弧面的 z 面，依平面形覆蓋率關閉
  const zMean = (S, sA, x, ay) => { if (ay > S.semi || ay < sA) return null; const c = S.chord(ay), xc = (x - S.xLE(ay)) / c; if (xc < 0 || xc > 1) return null; return S.o.z0 + (ay - sA) * Math.tan((S.o.dih || 0) * DEG) + nacaC(S.o.camber || 0, xc) * c - (xc - 0.25) * c * Math.tan((S.o.inc || 0) * DEG); };
  // 隔板面另存中弧面斜率 dz/dx（含安裝角、弧度、平尾偏轉），以穿透流速 w = u·dz/dx 表示薄翼切線條件
  const baffle = (S, sA, rot) => {
    for (let j = 0; j < NY; j++) {
      if (Y.f[j] > S.semi || Y.f[j + 1] < sA) continue;
      for (let i = 0; i < NX; i++) {
        let cov = 0, zs = 0, ss = 0;
        for (const a of SUB) for (const b of SUB) {
          const x = X.f[i] + a * X.d[i], y = Y.f[j] + b * Y.d[j]; let zm = zMean(S, sA, x, y); if (zm === null) continue;
          const e = 0.02 * S.chord(Math.min(y, S.semi)), z1 = zMean(S, sA, x + e, y), z0 = zMean(S, sA, x - e, y);
          let sl = z1 !== null && z0 !== null ? (z1 - z0) / (2 * e) : z1 !== null ? (z1 - zm) / e : z0 !== null ? (zm - z0) / e : 0;
          if (rot) { zm -= (x - hp[0]) * Math.tan(dR); sl -= Math.tan(dR); }
          cov++; zs += zm; ss += sl;
        }
        if (!cov) continue;
        const zm = zs / cov; let k = 0; while (k < NZ - 2 && Z.c[k + 1] <= zm) k++;
        const q = cidx(g, i, j, k); ap[2][q] = Math.min(ap[2][q], 1 - cov / 9); ap[3][q] = ss / cov;
      }
    }
  };
  baffle(ac.wing, G.sW, false); baffle(ht, G.sH, true);
  // 實體判定（φ < 0.2）與面清理
  for (let q = 0; q < N; q++) t[q] = phi[q] < 0.2 ? 1 : 0;
  const nb = (q, d) => d === 0 ? q + 1 : d === 1 ? q + NX : q + NX * NY;
  const inDom = (i, j, k, d) => d === 0 ? i + 1 < NX : d === 1 ? j + 1 < NY : k + 1 < NZ;
  // 固定狀態格：噴嘴出口（出口面上游一層）、短艙進氣面（入口面下游一層）
  const fixed = [];
  const layerAt = xv => { let i = 0; while (i < NX - 1 && X.f[i + 1] <= xv) i++; return i; };
  for (const e of ac.engines) {
    for (const ex of sp.exitsGeom) {
      const ty = ex.key === 'bypass' ? 4 : 5, i = layerAt(e.x0 + ex.x - 1e-3);
      const mark = pad => { let n = 0; for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) { const r = Math.hypot(Y.c[j] - e.y, Z.c[k] - e.z); if (r <= ex.R + pad && r >= (ex.Rin || 0) - pad) { const q = cidx(g, i, j, k); t[q] = ty; phi[q] = 1; fixed.push([q, 0, 1]); n++; } } return n; };
      if (!mark(0)) mark(0.55 * Math.max(Y.d[0], Z.d[0], g.h));
    }
    if (!e.internal) {
      const i = layerAt(e.x0 + sp.lip.x + 1e-3);
      const mark = pad => { let n = 0; for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) { const r = Math.hypot(Y.c[j] - e.y, Z.c[k] - e.z); if (r <= 0.9 * sp.lip.r + pad) { const q = cidx(g, i, j, k); t[q] = 3; phi[q] = 1; fixed.push([q, 0, -1]); n++; } } return n; };
      if (!mark(0)) mark(0.55 * g.h);
    }
  }
  for (let k = 0; k < NZ; k++) for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    const q = cidx(g, i, j, k);
    for (let d = 0; d < 3; d++) { if (!inDom(i, j, k, d)) { if (d === 2) ap[3][q] = 0; continue; } const q2 = nb(q, d); if (t[q] === 1 || t[q2] === 1) { ap[d][q] = 0; if (d === 2) ap[3][q] = 0; } }
    if (t[q] >= 3 || (k + 1 < NZ && t[q + NX * NY] >= 3)) ap[3][q] = 0;
  }
  // 固定狀態格的出流面／入流面必須開啟
  for (const [q, d, s] of fixed) { if (s > 0) { const q2 = nb(q, d); if (t[q2] === 0) ap[d][q] = 1; } else { const q0 = q - 1; if (t[q0] === 0) ap[0][q0] = 1; } }
  let nS = 0, nC = 0; for (let q = 0; q < N; q++) { if (t[q] === 1) nS++; else if (t[q] === 0 && (phi[q] < 1 || ap[0][q] < 1 || ap[1][q] < 1 || ap[2][q] < 1)) nC++; }
  return { t, phi, ap, nSolid: nS, nCut: nC, volW, volH };
}
/* 受力清單：流體格 (a⁺ − a⁻)·A ≠ 0 者 */
function cfdForceList(g, geo) {
  const L = [], NX = g.NX, NXY = NX * g.NY;
  for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) for (let i = 0; i < g.NX; i++) {
    const q = cidx(g, i, j, k); if (geo.t[q] !== 0) continue;
    const axm = i > 0 ? geo.ap[0][q - 1] : 1, azm = k > 0 ? geo.ap[2][q - NXY] : 1;
    const cx = (geo.ap[0][q] - axm) * g.Y.d[j] * g.Z.d[k], cz = (geo.ap[2][q] - azm) * g.X.d[i] * g.Y.d[j];
    if (cx !== 0 || cz !== 0) L.push({ q, cx, cz, x: g.X.c[i], z: g.Z.c[k] });
  }
  return L;
}

/* ============================================================
 *  CPU 求解器（與 GPU 著色器逐式對應）
 * ============================================================ */
function CfdCPU(g, geo) {
  this.kind = 'cpu'; this.g = g; this.geo = geo; this.t = geo.t; this.it = 0;
  const N = g.N; this.Q = [0, 1, 2, 3, 4].map(() => new Float32Array(N));
  this.B = [0, 1, 2, 3, 4].map(() => new Float32Array(N)); this.S1 = [0, 1, 2, 3, 4].map(() => new Float32Array(N));
  this.W = [0, 1, 2, 3, 4].map(() => new Float64Array(N)); this.dts = new Float64Array(N);
  this.opt = { cfl: 0.7, order: 2 }; this.F = [1, 0, 0, 0, 1 / (CG * (CG - 1))]; this.fix = [this.F, this.F, this.F];
  this._P = new Float64Array(25); this._T = new Int8Array(5); this._A = new Float64Array(4); this._s = new Float64Array(15);
  this._L = new Float64Array(5); this._R = new Float64Array(5); this._f = new Float64Array(5); this._res = new Float64Array(5);
}
CfdCPU.prototype.setFree = function (F) { this.F = F.slice(); };
CfdCPU.prototype.setFix = function (fx) { this.fix = fx.map(a => a.slice()); };
CfdCPU.prototype.reset = function () { const N = this.g.N; for (let q = 0; q < N; q++) for (let c = 0; c < 5; c++) this.Q[c][q] = this.F[c]; this.it = 0; };
function cfdPrim5(a0, a1, a2, a3, a4, o, off) { const r = Math.max(a0, 1e-6), u = a1 / r, v = a2 / r, w = a3 / r; o[off] = r; o[off + 1] = u; o[off + 2] = v; o[off + 3] = w; o[off + 4] = Math.max((CG - 1) * (a4 - 0.5 * r * (u * u + v * v + w * w)), 1e-7); }
CfdCPU.prototype.prims = function (Q) {
  const N = this.g.N, W = this.W, t = this.t, tmp = new Float64Array(5);
  for (let q = 0; q < N; q++) {
    if (t[q] >= 3) { const f = this.fix[t[q] - 3]; cfdPrim5(f[0], f[1], f[2], f[3], f[4], tmp, 0); }
    else cfdPrim5(Q[0][q], Q[1][q], Q[2][q], Q[3][q], Q[4][q], tmp, 0);
    W[0][q] = tmp[0]; W[1][q] = tmp[1]; W[2][q] = tmp[2]; W[3][q] = tmp[3]; W[4][q] = tmp[4];
  }
};
/* HLLC 通量：L、R 為原始變數 (ρ,u,v,w,p)，d 為法向分量索引 */
function cfdHLLC(L, R, d, out) {
  const gm = CG - 1, rL = L[0], rR = R[0], pL = L[4], pR = R[4], uL = L[1 + d], uR = R[1 + d];
  const aL = Math.sqrt(CG * pL / rL), aR = Math.sqrt(CG * pR / rR);
  const EL = pL / gm + 0.5 * rL * (L[1] * L[1] + L[2] * L[2] + L[3] * L[3]), ER = pR / gm + 0.5 * rR * (R[1] * R[1] + R[2] * R[2] + R[3] * R[3]);
  const SL = Math.min(uL - aL, uR - aR), SR = Math.max(uL + aL, uR + aR);
  let K, S, uK, rK, pK, EK;
  if (SL >= 0 || SR <= 0) { K = SL >= 0 ? L : R; uK = K[1 + d]; const E = SL >= 0 ? EL : ER; out[0] = K[0] * uK; out[1] = K[0] * K[1] * uK; out[2] = K[0] * K[2] * uK; out[3] = K[0] * K[3] * uK; out[1 + d] += K[4]; out[4] = uK * (E + K[4]); return out; }
  const SM = (pR - pL + rL * uL * (SL - uL) - rR * uR * (SR - uR)) / (rL * (SL - uL) - rR * (SR - uR));
  if (SM >= 0) { K = L; S = SL; uK = uL; rK = rL; pK = pL; EK = EL; } else { K = R; S = SR; uK = uR; rK = rR; pK = pR; EK = ER; }
  const f = rK * (S - uK) / (S - SM);
  const Fm = [rK * uK, rK * K[1] * uK, rK * K[2] * uK, rK * K[3] * uK]; Fm[1 + d] += pK;
  const Um = [rK, rK * K[1], rK * K[2], rK * K[3]], Us = [f, f * K[1], f * K[2], f * K[3]]; Us[1 + d] = f * SM;
  const Es = f * (EK / rK + (SM - uK) * (SM + pK / (rK * (S - uK))));
  for (let c = 0; c < 4; c++) out[c] = Fm[c] + S * (Us[c] - Um[c]);
  out[4] = uK * (EK + pK) + S * (Es - EK);
  return out;
}
const mmod = (a, b) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);
/* 單一流體格殘差（含開口率與壁面壓力源項），回傳於 R（已除以 φ） */
CfdCPU.prototype.cellResidual = function (i, j, k, R) {
  const g = this.g, t = this.t, W = this.W, geo = this.geo, NX = g.NX, NY = g.NY, NZ = g.NZ, o2 = this.opt.order === 2;
  const q0 = (k * NY + j) * NX + i, P = this._P, T = this._T, A = this._A, s = this._s, L = this._L, Rr = this._R, fl = this._f;
  for (let c = 0; c < 5; c++) R[c] = 0;
  const pC = W[4][q0];
  for (let d = 0; d < 3; d++) {
    const st = d === 0 ? 1 : d === 1 ? NX : NX * NY, ic = d === 0 ? i : d === 1 ? j : k, nd = d === 0 ? NX : d === 1 ? NY : NZ, h = d === 0 ? g.X.d[i] : d === 1 ? g.Y.d[j] : g.Z.d[k], apd = geo.ap[d];
    for (let m = -2; m <= 2; m++) {
      const c = ic + m, o = 5 * (m + 2);
      if (c >= nd || c < 0 && d !== 1) { T[m + 2] = -1; cfdPrim5(this.F[0], this.F[1], this.F[2], this.F[3], this.F[4], P, o); continue; }
      if (c < 0) { const qm = q0 + (-1 - c - ic) * st; T[m + 2] = -2; for (let v = 0; v < 5; v++) P[o + v] = W[v][qm]; P[o + 2] = -P[o + 2]; continue; }
      const q = q0 + m * st; T[m + 2] = t[q]; for (let v = 0; v < 5; v++) P[o + v] = W[v][q];
    }
    for (let m = -2; m <= 1; m++) { const c = ic + m; A[m + 2] = (c < 0 || c >= nd) ? 1 : apd[q0 + m * st]; }
    // 斜率：x = -1, 0, 1（需三格皆流體、兩面全開）
    for (let x = -1; x <= 1; x++) {
      const ok = o2 && T[x + 1] === 0 && T[x + 2] === 0 && T[x + 3] === 0 && A[x + 1] === 1 && A[x + 2] === 1;
      for (let v = 0; v < 5; v++) s[5 * (x + 1) + v] = ok ? mmod(P[5 * (x + 2) + v] - P[5 * (x + 1) + v], P[5 * (x + 3) + v] - P[5 * (x + 2) + v]) : 0;
    }
    for (let sg = 1; sg >= -1; sg -= 2) {
      const a = sg > 0 ? A[2] : A[1]; if (a <= 0) continue;
      const lo = sg > 0 ? 0 : -1; // 面左側格偏移
      for (let v = 0; v < 5; v++) { L[v] = P[5 * (lo + 2) + v] + 0.5 * s[5 * (lo + 1) + v]; Rr[v] = P[5 * (lo + 3) + v] - 0.5 * s[5 * (lo + 2) + v]; }
      if (L[0] <= 0 || L[4] <= 0 || Rr[0] <= 0 || Rr[4] <= 0) for (let v = 0; v < 5; v++) { L[v] = P[5 * (lo + 2) + v]; Rr[v] = P[5 * (lo + 3) + v]; }
      cfdHLLC(L, Rr, d, fl);
      for (let c = 0; c < 5; c++) R[c] -= sg * a * fl[c] / h;
    }
    R[1 + d] += pC * (A[2] - A[1]) / h;
    if (d === 2) { // 隔板穿透：上方格（面在下）流入 ρ·w_t、下方格（面在上）流出
      const sUp = geo.ap[3][q0], sDn = k > 0 ? geo.ap[3][q0 - NX * NY] : 0;
      if (sUp !== 0 || sDn !== 0) {
        const r = W[0][q0], u = W[1][q0], v = W[2][q0], w = W[3][q0], Hh = (pC / (CG - 1) + 0.5 * r * (u * u + v * v + w * w) + pC) / r;
        const m = (sDn !== 0 ? (1 - A[1]) * r * u * sDn : 0) - (sUp !== 0 ? (1 - A[2]) * r * u * sUp : 0);
        R[0] += m / h; R[1] += m * u / h; R[2] += m * v / h; R[3] += m * w / h; R[4] += m * Hh / h;
      }
    }
  }
  const ph = geo.phi[q0]; for (let c = 0; c < 5; c++) R[c] /= ph;
};
CfdCPU.prototype.stage = function (Qin, Bse, Out, wa, wb, first) {
  const g = this.g, t = this.t, R = this._res, W = this.W, dts = this.dts, phi = this.geo.phi;
  this.prims(Qin);
  for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) for (let i = 0; i < g.NX; i++) {
    const q = cidx(g, i, j, k);
    if (t[q] !== 0) { if (t[q] >= 3) { const f = this.fix[t[q] - 3]; for (let c = 0; c < 5; c++) Out[c][q] = f[c]; } else for (let c = 0; c < 5; c++) Out[c][q] = Bse[c][q]; continue; }
    if (first) { const a = Math.sqrt(CG * W[4][q] / W[0][q]); dts[q] = this.opt.cfl * Math.max(phi[q], 0.25) / ((Math.abs(W[1][q]) + a) / g.X.d[i] + (Math.abs(W[2][q]) + a) / g.Y.d[j] + (Math.abs(W[3][q]) + a) / g.Z.d[k]); }
    this.cellResidual(i, j, k, R);
    const dt = dts[q];
    for (let c = 0; c < 5; c++) Out[c][q] = wa * Bse[c][q] + wb * (Qin[c][q] + dt * R[c]);
    const r = Math.max(Out[0][q], 1e-4); Out[0][q] = r;
    const ke = 0.5 * (Out[1][q] ** 2 + Out[2][q] ** 2 + Out[3][q] ** 2) / r;
    if ((CG - 1) * (Out[4][q] - ke) < 1e-5) Out[4][q] = 1e-5 / (CG - 1) + ke;
  }
};
CfdCPU.prototype.step = function (n) {
  for (let s = 0; s < n; s++) {
    this.stage(this.Q, this.Q, this.S1, 0, 1, true);
    this.stage(this.S1, this.Q, this.B, 0.5, 0.5, false);
    const tmp = this.Q; this.Q = this.B; this.B = tmp; this.it++;
  }
};
CfdCPU.prototype.read = function () { return { r: this.Q[0], ru: this.Q[1], rv: this.Q[2], rw: this.Q[3], E: this.Q[4] }; };

/* ============================================================
 *  GPU 求解器
 * ============================================================ */
const CFD3_VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;
const CFD3_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uQ0, uQ1, uB0, uB1, uMK, uAP, uPH, uDX, uDY, uDZ;
uniform ivec3 uN; uniform int uCols; uniform int uOrder;
uniform vec4 uF0; uniform float uF1;
uniform vec4 uX0[3]; uniform float uX1[3];
uniform float uCfl, uWa, uWb;
layout(location = 0) out vec4 o0; layout(location = 1) out vec4 o1;
const float G = 1.4;
ivec2 T(ivec3 c) { return ivec2((c.z % uCols) * uN.x + c.x, (c.z / uCols) * uN.y + c.y); }
void prim(vec4 q, float e, out vec4 w, out float p) { float r = max(q.x, 1e-6); vec3 u = q.yzw / r; w = vec4(r, u); p = max((G - 1.0) * (e - 0.5 * r * dot(u, u)), 1e-7); }
float comp(vec4 w, int d) { return d == 0 ? w.y : (d == 1 ? w.z : w.w); }
void hllc(vec4 L, float pL, vec4 R, float pR, int d, out vec4 Fm, out float Fe) {
  vec3 ed = d == 0 ? vec3(1.0, 0.0, 0.0) : (d == 1 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0));
  float uL = comp(L, d), uR = comp(R, d), aL = sqrt(G * pL / L.x), aR = sqrt(G * pR / R.x);
  float EL = pL / (G - 1.0) + 0.5 * L.x * dot(L.yzw, L.yzw), ER = pR / (G - 1.0) + 0.5 * R.x * dot(R.yzw, R.yzw);
  float SL = min(uL - aL, uR - aR), SR = max(uL + aL, uR + aR);
  if (SL >= 0.0) { Fm = vec4(L.x * uL, L.x * L.yzw * uL + pL * ed); Fe = uL * (EL + pL); return; }
  if (SR <= 0.0) { Fm = vec4(R.x * uR, R.x * R.yzw * uR + pR * ed); Fe = uR * (ER + pR); return; }
  float SM = (pR - pL + L.x * uL * (SL - uL) - R.x * uR * (SR - uR)) / (L.x * (SL - uL) - R.x * (SR - uR));
  vec4 K = SM >= 0.0 ? L : R; float S = SM >= 0.0 ? SL : SR, uK = SM >= 0.0 ? uL : uR, pK = SM >= 0.0 ? pL : pR, EK = SM >= 0.0 ? EL : ER, rK = K.x;
  float f = rK * (S - uK) / (S - SM);
  vec4 FK = vec4(rK * uK, rK * K.yzw * uK + pK * ed), UK = vec4(rK, rK * K.yzw);
  vec3 vs = K.yzw; if (d == 0) vs.x = SM; else if (d == 1) vs.y = SM; else vs.z = SM;
  vec4 Us = vec4(f, f * vs);
  float Es = f * (EK / rK + (SM - uK) * (SM + pK / (rK * (S - uK))));
  Fm = FK + S * (Us - UK); Fe = uK * (EK + pK) + S * (Es - EK);
}
float mm1(float a, float b) { return a * b <= 0.0 ? 0.0 : (abs(a) < abs(b) ? a : b); }
vec4 mm4(vec4 a, vec4 b) { return vec4(mm1(a.x, b.x), mm1(a.y, b.y), mm1(a.z, b.z), mm1(a.w, b.w)); }
void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  int kz = (px.y / uN.y) * uCols + px.x / uN.x;
  ivec3 c = ivec3(px.x % uN.x, px.y % uN.y, kz);
  vec4 b0 = texelFetch(uB0, px, 0), b1 = texelFetch(uB1, px, 0);
  if (kz >= uN.z) { o0 = b0; o1 = b1; return; }
  vec4 mk = texelFetch(uMK, px, 0);
  int tc = int(mk.r * 255.0 + 0.5);
  if (tc >= 3) { o0 = uX0[tc - 3]; o1 = vec4(uX1[tc - 3], 0.0, 0.0, 0.0); return; }
  if (tc != 0) { o0 = b0; o1 = b1; return; }
  float ph = texelFetch(uPH, px, 0).r;
  vec4 C; float pC; prim(texelFetch(uQ0, px, 0), texelFetch(uQ1, px, 0).x, C, pC);
  vec3 h = vec3(texelFetch(uDX, ivec2(c.x, 0), 0).r, texelFetch(uDY, ivec2(c.y, 0), 0).r, texelFetch(uDZ, ivec2(c.z, 0), 0).r);
  vec4 Rm = vec4(0.0); float Re = 0.0;
  for (int d = 0; d < 3; d++) {
    ivec3 e = d == 0 ? ivec3(1, 0, 0) : (d == 1 ? ivec3(0, 1, 0) : ivec3(0, 0, 1));
    int ic = d == 0 ? c.x : (d == 1 ? c.y : c.z), nd = d == 0 ? uN.x : (d == 1 ? uN.y : uN.z);
    vec4 P[5]; float pp[5]; int Tt[5]; float A[4];
    for (int m = 0; m < 5; m++) {
      int cc = ic + m - 2; ivec3 q = c + (m - 2) * e;
      if (cc >= nd || (cc < 0 && d != 1)) { Tt[m] = -1; prim(uF0, uF1, P[m], pp[m]); continue; }
      if (cc < 0) { Tt[m] = -2; ivec3 mq = ivec3(q.x, -1 - q.y, q.z); prim(texelFetch(uQ0, T(mq), 0), texelFetch(uQ1, T(mq), 0).x, P[m], pp[m]); P[m].z = -P[m].z; continue; }
      int ty = int(texelFetch(uMK, T(q), 0).r * 255.0 + 0.5); Tt[m] = ty;
      if (ty >= 3) prim(uX0[ty - 3], uX1[ty - 3], P[m], pp[m]);
      else prim(texelFetch(uQ0, T(q), 0), texelFetch(uQ1, T(q), 0).x, P[m], pp[m]);
    }
    for (int m = 0; m < 4; m++) {
      int cc = ic + m - 2;
      if (cc < 0 || cc >= nd) { A[m] = 1.0; continue; }
      vec4 a4 = texelFetch(uAP, T(c + (m - 2) * e), 0);
      A[m] = d == 0 ? a4.r : (d == 1 ? a4.g : a4.b);
    }
    vec4 sw[3]; float sp[3];
    for (int x = 0; x < 3; x++) {
      bool ok = uOrder == 2 && Tt[x] == 0 && Tt[x + 1] == 0 && Tt[x + 2] == 0 && A[x] > 0.999 && A[x + 1] > 0.999;
      if (ok) { sw[x] = mm4(P[x + 1] - P[x], P[x + 2] - P[x + 1]); sp[x] = mm1(pp[x + 1] - pp[x], pp[x + 2] - pp[x + 1]); } else { sw[x] = vec4(0.0); sp[x] = 0.0; }
    }
    for (int s = 0; s < 2; s++) {
      int sg = s == 0 ? 1 : -1;
      float a = sg > 0 ? A[2] : A[1];
      if (a <= 0.0) continue;
      int lo = sg > 0 ? 2 : 1; // 面左側格在 P 中的索引
      vec4 L = P[lo] + 0.5 * sw[lo - 1], R = P[lo + 1] - 0.5 * sw[lo];
      float pL = pp[lo] + 0.5 * sp[lo - 1], pR = pp[lo + 1] - 0.5 * sp[lo];
      if (L.x <= 0.0 || pL <= 0.0 || R.x <= 0.0 || pR <= 0.0) { L = P[lo]; pL = pp[lo]; R = P[lo + 1]; pR = pp[lo + 1]; }
      vec4 Fm; float Fe; hllc(L, pL, R, pR, d, Fm, Fe);
      float hd = d == 0 ? h.x : (d == 1 ? h.y : h.z);
      Rm -= float(sg) * a * Fm / hd; Re -= float(sg) * a * Fe / hd;
    }
    float hd = d == 0 ? h.x : (d == 1 ? h.y : h.z), src = pC * (A[2] - A[1]) / hd;
    if (d == 0) Rm.y += src; else if (d == 1) Rm.z += src; else Rm.w += src;
    if (d == 2) {
      float sUp = texelFetch(uAP, px, 0).a, sDn = c.z > 0 ? texelFetch(uAP, T(c - ivec3(0, 0, 1)), 0).a : 0.0;
      if (sUp != 0.0 || sDn != 0.0) {
        float Hh = (pC / (G - 1.0) + 0.5 * C.x * dot(C.yzw, C.yzw) + pC) / C.x;
        float m = (1.0 - A[1]) * C.x * C.y * sDn - (1.0 - A[2]) * C.x * C.y * sUp;
        Rm += vec4(m, m * C.yzw) / hd; Re += m * Hh / hd;
      }
    }
  }
  Rm /= ph; Re /= ph;
  vec4 Bw; float pB; prim(b0, b1.x, Bw, pB);
  float a = sqrt(G * pB / Bw.x);
  float dt = uCfl * max(ph, 0.25) / ((abs(Bw.y) + a) / h.x + (abs(Bw.z) + a) / h.y + (abs(Bw.w) + a) / h.z);
  vec4 q0 = texelFetch(uQ0, px, 0); float q1 = texelFetch(uQ1, px, 0).x;
  vec4 n0 = uWa * b0 + uWb * (q0 + dt * Rm); float n1 = uWa * b1.x + uWb * (q1 + dt * Re);
  n0.x = max(n0.x, 1e-4);
  float ke = 0.5 * dot(n0.yzw, n0.yzw) / n0.x;
  if ((G - 1.0) * (n1 - ke) < 1e-5) n1 = 1e-5 / (G - 1.0) + ke;
  o0 = n0; o1 = vec4(n1, dt, 0.0, 0.0);
}`;
function CfdGPU(g, geo) {
  this.kind = 'gpu'; this.g = g; this.geo = geo; this.t = geo.t; this.it = 0; this.opt = { cfl: 0.7, order: 2 };
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('此 GPU 不支援浮點渲染目標');
  if (g.TW > gl.getParameter(gl.MAX_TEXTURE_SIZE) || g.TH > gl.getParameter(gl.MAX_TEXTURE_SIZE)) throw new Error('網格超過 GPU 紋理尺寸上限');
  this.gl = gl;
  const sh = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pg = gl.createProgram(); gl.attachShader(pg, sh(gl.VERTEX_SHADER, CFD3_VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, CFD3_FS)); gl.linkProgram(pg);
  if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pg));
  this.pg = pg; this.vao = gl.createVertexArray();
  this.U = {}; for (const n of ['uQ0', 'uQ1', 'uB0', 'uB1', 'uMK', 'uAP', 'uPH', 'uDX', 'uDY', 'uDZ', 'uN', 'uCols', 'uOrder', 'uF0', 'uF1', 'uX0', 'uX1', 'uCfl', 'uWa', 'uWb']) this.U[n] = gl.getUniformLocation(pg, n);
  const tex = (w, h, ifmt, fmt, type, data) => { const tx = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tx); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.texImage2D(gl.TEXTURE_2D, 0, ifmt, w, h, 0, fmt, type, data || null); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return tx; };
  const TW = g.TW, TH = g.TH;
  this.P = [0, 1, 2].map(() => { const t0 = tex(TW, TH, gl.RGBA32F, gl.RGBA, gl.FLOAT), t1 = tex(TW, TH, gl.RGBA32F, gl.RGBA, gl.FLOAT), fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t0, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t1, 0); if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('無法建立浮點 framebuffer'); return { t0, t1, fb }; });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const mk = new Uint8Array(TW * TH * 4), apx = new Float32Array(TW * TH * 4).fill(1), phx = new Float32Array(TW * TH * 4);
  for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) for (let i = 0; i < g.NX; i++) {
    const p = this.px(i, j, k), q = cidx(g, i, j, k);
    mk[4 * p] = geo.t[q]; phx[4 * p] = geo.phi[q];
    apx[4 * p] = geo.ap[0][q]; apx[4 * p + 1] = geo.ap[1][q]; apx[4 * p + 2] = geo.ap[2][q]; apx[4 * p + 3] = geo.ap[3][q];
  }
  this.tMK = tex(TW, TH, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, mk); this.tAP = tex(TW, TH, gl.RGBA32F, gl.RGBA, gl.FLOAT, apx); this.tPH = tex(TW, TH, gl.RGBA32F, gl.RGBA, gl.FLOAT, phx);
  this.tD = [g.X.d, g.Y.d, g.Z.d].map(a => tex(a.length, 1, gl.R32F, gl.RED, gl.FLOAT, Float32Array.from(a)));
  this.cur = 0; this.F = [1, 0, 0, 0, 1 / (CG * (CG - 1))]; this.fix = [this.F, this.F, this.F];
  this.b0 = new Float32Array(TW * TH * 4); this.b1 = new Float32Array(TW * TH * 4);
  this.host = { r: new Float32Array(g.N), ru: new Float32Array(g.N), rv: new Float32Array(g.N), rw: new Float32Array(g.N), E: new Float32Array(g.N), dt: new Float32Array(g.N) };
}
CfdGPU.prototype.px = function (i, j, k) { const g = this.g; return ((Math.floor(k / g.cols)) * g.NY + j) * g.TW + (k % g.cols) * g.NX + i; };
CfdGPU.prototype.setFree = function (F) { this.F = F.slice(); };
CfdGPU.prototype.setFix = function (fx) { this.fix = fx.map(a => a.slice()); };
CfdGPU.prototype.reset = function () {
  const gl = this.gl, g = this.g, a = new Float32Array(g.TW * g.TH * 4), b = new Float32Array(g.TW * g.TH * 4);
  for (let p = 0; p < g.TW * g.TH; p++) { a[4 * p] = this.F[0]; a[4 * p + 1] = this.F[1]; a[4 * p + 2] = this.F[2]; a[4 * p + 3] = this.F[3]; b[4 * p] = this.F[4]; }
  for (const s of this.P) { gl.bindTexture(gl.TEXTURE_2D, s.t0); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.TW, g.TH, gl.RGBA, gl.FLOAT, a); gl.bindTexture(gl.TEXTURE_2D, s.t1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, g.TW, g.TH, gl.RGBA, gl.FLOAT, b); }
  this.cur = 0; this.it = 0;
};
CfdGPU.prototype.pass = function (Q, B, out, wa, wb) {
  const gl = this.gl, U = this.U;
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.viewport(0, 0, this.g.TW, this.g.TH);
  const bind = (u, tx, loc) => { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, tx); gl.uniform1i(loc, u); };
  bind(0, Q.t0, U.uQ0); bind(1, Q.t1, U.uQ1); bind(2, B.t0, U.uB0); bind(3, B.t1, U.uB1); bind(4, this.tMK, U.uMK); bind(5, this.tD[0], U.uDX); bind(6, this.tD[1], U.uDY); bind(7, this.tD[2], U.uDZ); bind(8, this.tAP, U.uAP); bind(9, this.tPH, U.uPH);
  gl.uniform1f(U.uWa, wa); gl.uniform1f(U.uWb, wb);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};
CfdGPU.prototype.step = function (n) {
  const gl = this.gl, U = this.U, g = this.g;
  gl.useProgram(this.pg); gl.bindVertexArray(this.vao);
  gl.uniform3i(U.uN, g.NX, g.NY, g.NZ); gl.uniform1i(U.uCols, g.cols); gl.uniform1i(U.uOrder, this.opt.order); gl.uniform1f(U.uCfl, this.opt.cfl);
  gl.uniform4f(U.uF0, this.F[0], this.F[1], this.F[2], this.F[3]); gl.uniform1f(U.uF1, this.F[4]);
  const x0 = [], x1 = []; for (const f of this.fix) { x0.push(f[0], f[1], f[2], f[3]); x1.push(f[4]); }
  gl.uniform4fv(U.uX0, x0); gl.uniform1fv(U.uX1, x1);
  for (let s = 0; s < n; s++) {
    const A = this.P[this.cur], S1 = this.P[(this.cur + 1) % 3], C = this.P[(this.cur + 2) % 3];
    this.pass(A, A, S1, 0, 1);
    this.pass(S1, A, C, 0.5, 0.5);
    this.cur = (this.cur + 2) % 3; this.it++;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};
CfdGPU.prototype.read = function () {
  const gl = this.gl, g = this.g, A = this.P[this.cur], H = this.host;
  gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, g.TW, g.TH, gl.RGBA, gl.FLOAT, this.b0);
  gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, g.TW, g.TH, gl.RGBA, gl.FLOAT, this.b1);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) { let p = this.px(0, j, k), q = cidx(g, 0, j, k); for (let i = 0; i < g.NX; i++, p++, q++) { H.r[q] = this.b0[4 * p]; H.ru[q] = this.b0[4 * p + 1]; H.rv[q] = this.b0[4 * p + 2]; H.rw[q] = this.b0[4 * p + 3]; H.E[q] = this.b1[4 * p]; H.dt[q] = this.b1[4 * p + 1]; } }
  return H;
};
CfdGPU.prototype.dispose = function () { const ext = this.gl.getExtension('WEBGL_lose_context'); if (ext) ext.loseContext(); };

/* ============================================================
 *  後處理：受力、取樣
 * ============================================================ */
function cfdForces(g, list, H, alphaDeg, M, S, xcg, zcg, cref) {
  let Fx = 0, Fz = 0, My = 0; const pinf = 1 / CG;
  for (const f of list) {
    const q = f.q, r = H.r[q], u = H.ru[q] / r, v = H.rv[q] / r, w = H.rw[q] / r, dp = (CG - 1) * (H.E[q] - 0.5 * r * (u * u + v * v + w * w)) - pinf;
    const fx = -dp * f.cx, fz = -dp * f.cz; // 對機體之力 = −(p − p∞)(a⁺ − a⁻)A
    Fx += fx; Fz += fz; My += (f.z - zcg) * fx - (f.x - xcg) * fz;
  }
  const a = alphaDeg * DEG, q = 0.5 * M * M, k = 2 / (q * S);
  return { CL: k * (Fz * Math.cos(a) - Fx * Math.sin(a)), CD: k * (Fx * Math.cos(a) + Fz * Math.sin(a)), Cm: k * My / cref };
}
function cfdLocate(c, v) { const n = c.length; if (v <= c[0]) return [0, 0]; if (v >= c[n - 1]) return [n - 2, 1]; let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (c[m] <= v) lo = m; else hi = m; } return [lo, (v - c[lo]) / (c[hi] - c[lo])]; }
/* 三線性內插權重（僅用流體與固定狀態格） */
function cfdStencil(g, t, x, y, z, idx, w, o) {
  const [i, tx] = cfdLocate(g.X.c, x), [j, ty] = cfdLocate(g.Y.c, Math.abs(y)), [k, tz] = cfdLocate(g.Z.c, z);
  let ws = 0;
  for (let c = 0; c < 8; c++) {
    const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2, q = cidx(g, i + di, j + dj, k + dk), ww = (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz);
    const ok = t[q] === 0 || t[q] >= 3;
    idx[o + c] = q; w[o + c] = ok ? ww : 0; ws += ok ? ww : 0;
  }
  if (ws > 1e-6) { for (let c = 0; c < 8; c++) w[o + c] /= ws; return true; }
  // 退回：最近的流體格
  let best = -1, bd = Infinity;
  for (let dk = -1; dk <= 2; dk++) for (let dj = -1; dj <= 2; dj++) for (let di = -1; di <= 2; di++) {
    const a = i + di, b = j + dj, c = k + dk; if (a < 0 || b < 0 || c < 0 || a >= g.NX || b >= g.NY || c >= g.NZ) continue;
    const q = cidx(g, a, b, c); if (t[q] !== 0) continue;
    const d2 = (g.X.c[a] - x) ** 2 + (g.Y.c[b] - Math.abs(y)) ** 2 + (g.Z.c[c] - z) ** 2; if (d2 < bd) { bd = d2; best = q; }
  }
  for (let c = 0; c < 8; c++) { idx[o + c] = best < 0 ? 0 : best; w[o + c] = best < 0 ? 0 : (c === 0 ? 1 : 0); }
  return best >= 0;
}
/* 取樣：回傳無因次原始變數 [ρ,u,v,w,p]（y < 0 時 v 反號） */
function cfdSample(H, idx, w, o, ysgn, out) {
  let r = 0, ru = 0, rv = 0, rw = 0, E = 0, ws = 0;
  for (let c = 0; c < 8; c++) { const ww = w[o + c]; if (!ww) continue; const q = idx[o + c]; r += ww * H.r[q]; ru += ww * H.ru[q]; rv += ww * H.rv[q]; rw += ww * H.rw[q]; E += ww * H.E[q]; ws += ww; }
  if (!ws) return null;
  r = Math.max(r, 1e-6); const u = ru / r, v = rv / r * ysgn, wv = rw / r;
  out[0] = r; out[1] = u; out[2] = v; out[3] = wv; out[4] = Math.max((CG - 1) * (E - 0.5 * r * (u * u + v * v + wv * wv)), 1e-7);
  return out;
}
/* 無因次 → 有因次狀態 */
function cfdState(fs, W, o) {
  o = o || {};
  const T = CG * W[4] / W[0] * fs.T, a = Math.sqrt(1.4 * 287.05 * T), V = Math.hypot(W[1], W[2], W[3]) * fs.a;
  o.P = W[4] * CG * fs.P; o.T = T; o.rho = W[0] * fs.rho; o.V = V; o.M = V / a; o.Tt = T * (1 + 0.2 * o.M * o.M); o.Pt = o.P * Math.pow(1 + 0.2 * o.M * o.M, 3.5);
  o.Cp = fs.q > 1 ? (o.P - fs.P) / fs.q : 0; o.Taw = T * (1 + 0.89 * 0.2 * o.M * o.M); o.Vx = W[1] * fs.a; o.Vy = W[2] * fs.a; o.Vz = W[3] * fs.a;
  return o;
}

/* ============================================================
 *  CFD 控制器（介面整合）
 * ============================================================ */
const CFD3 = {
  solver: null, g: null, mask: null, faces: null, H: null, it0: 0, hist: [], running: true, level: 'medium', cfl: 0.7, order: 2, err: null, key: '',
  ips: 0, ipsN: 0, ipsT: 0, readT: 0, k: 2, prevR: null, res: NaN, res0: NaN, F: null, conv: false, stencilSL: null, stencilD: null, fixInfo: null,
  build() {
    const ac = CUR.ac; if (!ac) return;
    const R = CUR.R, t0 = performance.now();
    if (this.solver && this.solver.dispose) this.solver.dispose();
    this.solver = null; this.err = null; this.H = null; this.hist = []; this.conv = false; this.prevR = null; this.res0 = NaN; this.stencilSL = null; this.stencilD = null;
    this.delta = R ? R.delta || 0 : 0;
    const g = cfdGrid(ac, this.level), m = cfdGeom(ac, CUR.G, g, this.delta);
    this.g = g; this.mask = m; this.faces = cfdForceList(g, m);
    try { this.solver = new CfdGPU(g, m); }
    catch (e) {
      this.err = String(e.message || e);
      const small = cfdGridCPU(ac); const m2 = cfdGeom(ac, CUR.G, small, this.delta);
      this.g = small; this.mask = m2; this.faces = cfdForceList(small, m2);
      this.solver = new CfdCPU(small, m2);
    }
    this.solver.opt.cfl = this.cfl; this.solver.opt.order = this.order;
    this.key = CUR.geomKey;
    this.applyCond(true);
    this.solver.reset();
    this.buildT = performance.now() - t0;
    this.readT = 0;
  },
  /* 自由流與固定狀態（引擎）更新 */
  applyCond(silent) {
    const R = CUR.R, s = this.solver; if (!R || !s) return;
    const fs = R.fs, a = (R.alpha || 0) * DEG, M = S.M, u = M * Math.cos(a), w = M * Math.sin(a);
    const F = [1, u, 0, w, 1 / (CG * (CG - 1)) + 0.5 * M * M];
    s.setFree(F);
    const fm = R.fm, sp = CUR.ac.spec, st = (x, r) => { if (!fm) return null; const o = fm.sample(x, r, 0, {}); if (o.solid) return null; const rr = (o.P / fs.P) / (o.T / fs.T), pp = (o.P / fs.P) / CG, uu = o.Vx / fs.a; return [rr, rr * uu, 0, 0, pp / (CG - 1) + 0.5 * rr * uu * uu]; };
    const x2 = (sp.stations.find(q => q.id === '2') || { x: sp.lip.x + 0.1 * sp.s }).x, rin = sp.streams.inlet || sp.streams.core;
    const exB = sp.exitsGeom.find(q => q.key === 'bypass'), exC = sp.exitsGeom.find(q => q.key !== 'bypass');
    const sink = st(x2 + 0.01 * sp.s, rin ? 0.5 * (rin.lo.at(x2) + rin.hi.at(x2)) : 0.3 * sp.lip.r) || F;
    const jB = exB ? st(exB.x - 0.02 * sp.s, 0.5 * (exB.R + exB.Rin)) || F : F;
    const jC = exC ? st(exC.x - 0.02 * sp.s, 0.5 * (exC.R + (exC.Rin || 0))) || F : F;
    s.setFix([sink, jB, jC]);
    this.fixInfo = { sink, jB, jC };
    const key = [F, sink, jB, jC].map(a => a.map(v => v.toFixed(5)).join(',')).join('|');
    this.alpha = R.alpha; this.M = M;
    if (!silent && key !== this.condKey) this.conv = false;
    this.condKey = key;
  },
  tick() {
    if (S.mode !== 'cfd' || !this.solver || document.hidden) return;
    const now = performance.now();
    if (this.running && !this.conv) {
      if (this.solver.kind === 'gpu') { const fdt = this.lastT ? now - this.lastT : 16; if (fdt < 24) this.k = Math.min(60, this.k + 1); else if (fdt > 45) this.k = Math.max(1, Math.floor(this.k * 0.7)); this.solver.step(this.k); this.ipsN += this.k; }
      else { const t0 = performance.now(); let n = 0; while (performance.now() - t0 < 30) { this.solver.step(1); n++; } this.ipsN += n; }
    }
    this.lastT = now;
    if (now - this.ipsT > 1000) { this.ips = this.ipsN * 1000 / Math.max(1, now - this.ipsT); this.ipsN = 0; this.ipsT = now; updateSolverBar(); }
    if ((this.running && !this.conv && now - this.readT > (this.solver.kind === 'gpu' ? 1400 : 2500)) || !this.H) { this.readT = now; this.readback(); }
  },
  readback() {
    const s = this.solver, H = s.read(), g = this.g, R = CUR.R; if (!R) return;
    // 殘差：兩次讀取間密度變化（每迭代）
    const nIt = s.it - (this.prevIt || 0);
    if (this.prevR && nIt > 0) { let sum = 0, n = 0; for (let q = 0; q < g.N; q += 3) { if (this.mask.t[q] !== 0) continue; const d = H.r[q] - this.prevR[q]; sum += d * d; n++; } this.res = Math.sqrt(sum / Math.max(1, n)) / nIt; if (!(this.res0 > 0) && this.res > 0) this.res0 = this.res; }
    this.prevR = Float32Array.from(H.r); this.prevIt = s.it;
    this.H = H;
    const ac = CUR.ac;
    this.F = cfdForces(g, this.faces, H, this.alpha || 0, Math.max(this.M, 0.05), ac.ref.S, ac.ref.xcg, ac.ref.zcg || 0, ac.ref.c);
    // 誘導阻力：尾翼後方 Trefftz 平面橫向流動能 CD_i = 2∫∫(v_y² + v_n²)dA / (M² S)（半模 ×2）
    {
      const xT = Math.max(ac.fus.L, ac.htail.xLE(ac.htail.semi) + ac.htail.ct) + 0.12 * ac.fus.L, [i0, tx] = cfdLocate(g.X.c, xT), a = (this.alpha || 0) * DEG, ca = Math.cos(a), sa = Math.sin(a), Mn = Math.max(this.M, 0.05);
      let sum = 0;
      for (let k = 0; k < g.NZ; k++) for (let j = 0; j < g.NY; j++) {
        let u = 0, v = 0, w = 0, ws = 0;
        for (let di = 0; di < 2; di++) { const q = cidx(g, i0 + di, j, k), t = this.mask.t[q]; if (t !== 0) continue; const ww = di ? tx : 1 - tx, r = H.r[q]; u += ww * H.ru[q] / r; v += ww * H.rv[q] / r; w += ww * H.rw[q] / r; ws += ww; }
        if (ws < 1e-6) continue; u /= ws; v /= ws; w /= ws;
        const vn = w * ca - u * sa; sum += (v * v + vn * vn) * g.Y.d[j] * g.Z.d[k];
      }
      this.CDi = 2 * sum / (Mn * Mn * ac.ref.S); this.xT = xT;
    }
    let mMax = 0; for (let q = 0; q < g.N; q += 2) { if (this.mask.t[q] !== 0) continue; const r = H.r[q], u = H.ru[q] / r, v = H.rv[q] / r, w = H.rw[q] / r, p = (CG - 1) * (H.E[q] - 0.5 * r * (u * u + v * v + w * w)); const m2 = (u * u + v * v + w * w) / (CG * p / r); if (m2 > mMax) mMax = m2; }
    this.Mmax = Math.sqrt(mMax);
    this.hist.push({ it: s.it, res: this.res, CL: this.F.CL, CD: this.F.CD, Cm: this.F.Cm });
    if (this.hist.length > 400) this.hist.splice(0, this.hist.length - 400);
    if (this.hist.length > 6 && this.res0 > 0 && this.res / this.res0 < 2e-3) { const h = this.hist.slice(-4); if (Math.max(...h.map(x => x.CL)) - Math.min(...h.map(x => x.CL)) < 2e-3) this.conv = true; }
    if (s.it > 30000) this.conv = true;
    paintAll(); drawCfdCard(); updateSolverBar();
  },
  bar(b) {
    const st = this.err && !this.solver ? ['pause', 'CFD 無法啟動'] : this.conv ? ['ok', '已收斂'] : this.running ? ['run', '3D CFD 求解中'] : ['pause', '已暫停'];
    const g = this.g, parts = g ? [`${this.solver ? (this.solver.kind === 'gpu' ? 'GPU' : 'CPU') : ''} · ${g.NX}×${g.NY}×${g.NZ} = ${fmtN(g.N)} 格`, `迭代 ${fmtN(this.solver ? this.solver.it : 0)}`, `殘差 ${this.res > 0 ? this.res.toExponential(1) : '—'}`, `${fmtN(this.ips)} it/s`] : [];
    const key = st.join() + parts.join(); if (b.dataset.k === key) return; b.dataset.k = key;
    b.innerHTML = `<span class="st ${st[0]}"><i></i><b>${st[1]}</b></span>` + parts.map((p, i) => `<span data-k="${i === 0 ? 'grid' : i === 3 ? 'ips' : 'it'}">${p}</span>`).join('') + `<button type="button" id="cfdRun">${this.running ? '暫停' : this.conv ? '繼續迭代' : '繼續'}</button>`;
    $('#cfdRun').onclick = () => { if (this.conv) { this.conv = false; this.running = true; } else this.running = !this.running; b.dataset.k = ''; updateSolverBar(); refreshControls(); };
  },
};
/* CPU 後備：極粗網格（約 1.8 萬格） */
function cfdGridCPU(ac) { const save = CFD_GRIDS.coarse.cells; CFD_GRIDS.coarse.cells = 18000; const g = cfdGrid(ac, 'coarse'); CFD_GRIDS.coarse.cells = save; return g; }

function setMode(m) {
  S.mode = m; markSeg();
  $('#cfdCard').hidden = m !== 'cfd';
  if (m === 'cfd') { if (!CFD3.solver || CFD3.key !== CUR.geomKey) CFD3.build(); else CFD3.applyCond(); CFD3.running = true; }
  buildRack(); applyView();
  paintAll(); updatePanels(true); drawCfdCard();
  if (CUR.R) warningsRefresh();
}
function warningsRefresh() { const R = CUR.R; R.warn = []; warnings(R); $('#warnbar').innerHTML = R.warn.map(w => `<div>⚠ ${w}</div>`).join(''); }
/* CFD 模式：顯示面元值（沿法向外移半格取樣） */
function cfdDispValues(key) {
  const C = CFD3, g = C.g, D = CUR.disp, n = D.P.length, out = new Float32Array(n).fill(NaN), R = CUR.R;
  if (!C.H || !g) return out;
  if (!C.stencilD || C.stencilD.key !== C.key + g.N) {
    const idx = new Int32Array(8 * n), w = new Float32Array(8 * n);
    for (let q = 0; q < n; q++) { const p = D.P[q], h = 0.75 * g.h; cfdStencil(g, C.mask.t, p.cen[0] + p.n[0] * h, p.cen[1] + p.n[1] * h, p.cen[2] + p.n[2] * h, idx, w, 8 * q); }
    C.stencilD = { idx, w, key: C.key + g.N };
  }
  const st = C.stencilD, W = [0, 0, 0, 0, 0], o = {};
  for (let q = 0; q < n; q++) {
    const sp = CUR.dSpecial[q]; if (sp) { const f = R.faces[sp]; out[q] = f ? f[key] : NaN; continue; }
    if (!cfdSample(C.H, st.idx, st.w, 8 * q, 1, W)) continue;
    out[q] = cfdState(R.fs, W, o)[key];
  }
  return out;
}
/* CFD 模式：剖面貼圖點取樣 */
function paintSliceCFD() {
  const C = CFD3, g = C.g, R = CUR.R; if (!SL.pts || !C.H || !R) return false;
  const TW = SL.TW, TH = SL.TH, n = TW * TH, key = S.field, fs = R.fs;
  if (!C.stencilSL || C.stencilSL.key !== C.key + g.N + '|' + SL.kind + SL.pos) {
    const idx = new Int32Array(8 * n), w = new Float32Array(8 * n), sg = new Int8Array(n);
    for (let t = 0; t < n; t++) { const p = SL.to3(SL.U[0] + (t % TW) * SL.du / 3, SL.V[0] + Math.floor(t / TW) * SL.dv / 3); sg[t] = p[1] < 0 ? -1 : 1; if (SL.tcode[t] !== 0) continue; cfdStencil(g, C.mask.t, p[0], p[1], p[2], idx, w, 8 * t); }
    C.stencilSL = { idx, w, sg, key: C.key + g.N + '|' + SL.kind + SL.pos };
  }
  const st = C.stencilSL, tv = SL.tval && SL.tval.length === n ? SL.tval : (SL.tval = new Float32Array(n)), W = [0, 0, 0, 0, 0], o = {};
  const engMap = new Map(); for (let q = 0; q < SL.eng.length / 4; q++) engMap.set(SL.eng[4 * q], q);
  for (let t = 0; t < n; t++) {
    const cc = SL.tcode[t];
    if (cc === 1 || cc === 2) { tv[t] = NaN; continue; }
    if (cc === 3) { const q = engMap.get(t); if (!R.fm || q === undefined) { tv[t] = NaN; continue; } const e = R.fm.sample(SL.eng[4 * q + 1], SL.eng[4 * q + 2], SL.eng[4 * q + 3], o); if (e.solid) { tv[t] = NaN; continue; } tv[t] = key === 'Cp' ? (fs.q > 1 ? (e.P - fs.P) / fs.q : 0) : e[key]; continue; }
    tv[t] = cfdSample(C.H, st.idx, st.w, 8 * t, st.sg[t], W) ? cfdState(fs, W, o)[key] : NaN;
  }
  const nu = SL.nu; for (let gq = 0; gq < SL.nu * SL.nv; gq++) { const i = gq % nu, j = (gq / nu) | 0; SL.gval[gq] = tv[3 * j * TW + 3 * i]; }
  return true;
}
/* CFD 速度（粒子）：回傳以 V∞ 正規化的速度；無資料時回傳 null */
function cfdVelAt(x, y, z, out) {
  const C = CFD3, g = C.g; if (!C.H || !g) return null;
  const idx = C._i || (C._i = new Int32Array(8)), w = C._w || (C._w = new Float32Array(8)), W = C._W || (C._W = [0, 0, 0, 0, 0]);
  if (x < g.X.c[0] || x > g.X.c[g.NX - 1] || Math.abs(y) > g.Y.c[g.NY - 1] || z < g.Z.c[0] || z > g.Z.c[g.NZ - 1]) return null;
  const [i, tx] = cfdLocate(g.X.c, x), [j, ty] = cfdLocate(g.Y.c, Math.abs(y)), [k, tz] = cfdLocate(g.Z.c, z);
  let ws = 0; for (let c = 0; c < 8; c++) { const di = c & 1, dj = (c >> 1) & 1, dk = c >> 2, q = cidx(g, i + di, j + dj, k + dk), t = C.mask.t[q], ww = (t === 0 || t >= 3) ? (di ? tx : 1 - tx) * (dj ? ty : 1 - ty) * (dk ? tz : 1 - tz) : 0; idx[c] = q; w[c] = ww; ws += ww; }
  if (ws < 1e-6) return null; for (let c = 0; c < 8; c++) w[c] /= ws;
  if (!cfdSample(C.H, idx, w, 0, y < 0 ? -1 : 1, W)) return null;
  const Minf = Math.max(C.M || 0, 1e-3); out[0] = W[1] / Minf; out[1] = W[2] / Minf; out[2] = W[3] / Minf; return out;
}
/* CFD 對照卡：收斂歷程與比較表 */
function drawCfdCard() {
  if (S.mode !== 'cfd') return;
  const C = CFD3, R = CUR.R, box = $('#cvChart'); if (!box || !R) return;
  const H = chartH(0.9), { g, W } = setupCanvas(box, H), pl = 50, pr = 50, pt = 14, pb = 26, h = C.hist;
  if (h.length > 1) {
    const it0 = h[0].it, it1 = h[h.length - 1].it, rs = h.filter(x => x.res > 0).map(x => x.res);
    const X = v => pl + (v - it0) / Math.max(1, it1 - it0) * (W - pl - pr);
    if (rs.length) {
      const lo = Math.log10(Math.min(...rs)) - 0.2, hi = Math.log10(Math.max(...rs)) + 0.2, Y = v => pt + (1 - (Math.log10(v) - lo) / (hi - lo)) * (H - pt - pb);
      axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
      for (let e = Math.ceil(lo); e <= Math.floor(hi); e++) { const y = Y(10 ** e); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.fillStyle = INK3; g.fillText('1e' + e, pl - 6, y); }
      g.strokeStyle = '#a8b4c0'; g.lineWidth = 1.5; g.beginPath(); let on = false; for (const x of h) { if (!(x.res > 0)) continue; on ? g.lineTo(X(x.it), Y(x.res)) : g.moveTo(X(x.it), Y(x.res)); on = true; } g.stroke(); g.lineWidth = 1;
    }
    const cls = h.map(x => x.CL), cds = h.map(x => x.CD * 10);
    const lo2 = Math.min(0, ...cls, ...cds), hi2 = Math.max(0.1, ...cls, ...cds) * 1.1, Y2 = v => pt + (1 - (v - lo2) / (hi2 - lo2)) * (H - pt - pb);
    g.textAlign = 'left'; axisFont(g); for (const v of niceTicks(lo2, hi2, 4)) { g.fillStyle = '#45cfe0'; g.fillText(v.toFixed(2), W - pr + 6, Y2(v)); }
    const ln = (arr, c, d) => { g.strokeStyle = c; g.lineWidth = 2; g.setLineDash(d || []); g.beginPath(); h.forEach((x, i) => { const y = Y2(arr[i]); i ? g.lineTo(X(x.it), y) : g.moveTo(X(x.it), y); }); g.stroke(); g.setLineDash([]); g.lineWidth = 1; };
    ln(cls, '#45cfe0'); ln(cds, '#f3b43f', [5, 4]);
    if (R.r) { g.setLineDash([2, 3]); g.strokeStyle = 'rgba(69,207,224,0.5)'; g.beginPath(); g.moveTo(pl, Y2(R.r.CL)); g.lineTo(W - pr, Y2(R.r.CL)); g.stroke(); g.setLineDash([]); }
    g.textAlign = 'center'; g.textBaseline = 'top'; axisFont(g); for (const v of niceTicks(it0, it1, 5)) { if (X(v) > W - pr - 20) continue; g.fillStyle = INK3; g.fillText(fmtN(v), X(v), H - pb + 6); }
    g.textAlign = 'right'; g.fillText('迭代', W - pr, H - pb + 6);
  } else { uiFont(g); g.fillStyle = INK3; g.textBaseline = 'top'; g.fillText(C.err && !C.solver ? C.err : 'CFD 迭代中，收斂歷程將於數秒後顯示…', 12, 14); }
  const F = C.F, rr = R.r, d = rr ? rr.drag : null;
  const row = (k, a, b, u) => `<tr><td></td><td>${k}</td><td class="n">${a}</td><td class="n" style="color:var(--ink-3)">${b}</td><td>${u || ''}</td></tr>`;
  const g3 = C.g;
  $('#cfdTable').innerHTML = `<thead><tr><th></th><th>項目</th><th>3D CFD（Euler）</th><th>面元法／工程估算</th><th>說明</th></tr></thead><tbody>` +
    row('升力係數 C<sub>L</sub>', F ? F.CL.toFixed(3) : '—', rr ? rr.CL.toFixed(3) : '—', 'CFD：表面壓力積分；右欄為配平所需 C<sub>L</sub>') +
    row('俯仰力矩 C<sub>m</sub>（對重心）', F ? F.Cm.toFixed(3) : '—', '0.000', '面元法已配平（C<sub>m</sub> = 0）') +
    row('壓力阻力 C<sub>D,p</sub>（counts）', F ? fmtN(F.CD * 1e4, 1) : '—', d ? fmtN((d.CDw + d.CDi + d.CDtrim) * 1e4, 1) : '—', '右欄：波阻＋升力相關＋配平（不含摩擦與形狀）' + (F && d && F.CD > 1.8 * (d.CDw + d.CDi + d.CDtrim) + 0.004 ? '；CFD 值含粗網格數值耗散造成的額外壓力阻力，網格加密後下降' : '')) +
    row('誘導阻力 C<sub>D,i</sub>（counts）', C.CDi != null ? fmtN(C.CDi * 1e4, 1) : '—', d && rr ? fmtN(rr.CL * rr.CL / (Math.PI * CUR.ac.ref.A * (R.e || 1)) * 1e4, 1) : '—', `CFD：x = ${C.xT ? C.xT.toFixed(1) : '—'} m 之 Trefftz 平面橫向流動能；右欄：C<sub>L</sub>²/(πAe)`) +
    row('摩擦＋形狀阻力（counts）', '不含（無黏）', d ? fmtN(d.CD0 * 1e4, 1) : '—', 'Euler 方程無黏性，摩擦由工程估算補足') +
    row('全機 C<sub>D</sub>（counts）', F && d ? fmtN((F.CD + d.CD0) * 1e4, 1) : '—', d ? fmtN(d.CD * 1e4, 1) : '—', 'CFD 壓力阻力＋工程摩擦形狀阻力') +
    row('流場最大馬赫數', C.Mmax ? C.Mmax.toFixed(2) : '—', '—', C.Mmax > 1.02 && S.M < 1 ? '局部超音速區（可能伴隨震波）' : '') +
    row('攻角 α ／ 平尾 δ', `${fmtS(C.alpha || 0, 2)}° / ${fmtS(C.delta || 0, 2)}°`, `${fmtS(R.alpha || 0, 2)}° / ${fmtS(R.delta || 0, 2)}°`, 'CFD 採用面元法配平姿態（平尾偏轉於建立網格時套用）') +
    row('網格', g3 ? `${g3.NX}×${g3.NY}×${g3.NZ}` : '—', CUR.pa ? `面元 ${fmtN(CUR.pa.solver.N)}` : '—', g3 ? `近場格距 ${g3.h.toFixed(3)} m · 實體格 ${fmtN(C.mask.nSolid)} · 切割格 ${fmtN(C.mask.nCut)}` : '') +
    '</tbody>';
  $('#cfdSub').textContent = C.solver ? `${C.solver.kind === 'gpu' ? 'GPU（WebGL2）' : 'CPU 後備（極粗網格）'}${C.err && C.solver.kind === 'cpu' ? '：' + C.err : ''} · 建立 ${(C.buildT / 1000).toFixed(1)} s` : (C.err || '');
}
