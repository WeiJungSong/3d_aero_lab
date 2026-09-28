/* ============================================================
 *  cfd_cpu.js — 軸對稱可壓縮流求解器（JS 參考實作／CPU 備援）
 *  守恆變數 Q = [ρ, ρu, ρv, E, ρY]；有限體積、HLLC 通量、MUSCL-minmod、
 *  SSP-RK2、局部時間步（穩態加速）、Riemann 不變量遠場邊界、軸對稱幾何源項、
 *  葉片排體積力、燃燒熱源、Prandtl 混合長度（薄剪切層近似）。
 * ============================================================ */
function hllc(rL, uL, vL, pL, YL, gL, rR, uR, vR, pR, YR, gR, F) {
  const cL = Math.sqrt(gL * pL / rL), cR = Math.sqrt(gR * pR / rR);
  const SL = Math.min(uL - cL, uR - cR), SR = Math.max(uL + cL, uR + cR);
  const EL = pL / (gL - 1) + 0.5 * rL * (uL * uL + vL * vL), ER = pR / (gR - 1) + 0.5 * rR * (uR * uR + vR * vR);
  if (SL >= 0) { F[0] = rL * uL; F[1] = rL * uL * uL + pL; F[2] = rL * uL * vL; F[3] = uL * (EL + pL); F[4] = rL * uL * YL; return; }
  if (SR <= 0) { F[0] = rR * uR; F[1] = rR * uR * uR + pR; F[2] = rR * uR * vR; F[3] = uR * (ER + pR); F[4] = rR * uR * YR; return; }
  const SM = (pR - pL + rL * uL * (SL - uL) - rR * uR * (SR - uR)) / (rL * (SL - uL) - rR * (SR - uR));
  if (SM >= 0) {
    const f = rL * (SL - uL) / (SL - SM);
    const Es = f * (EL / rL + (SM - uL) * (SM + pL / (rL * (SL - uL))));
    F[0] = rL * uL + SL * (f - rL);
    F[1] = rL * uL * uL + pL + SL * (f * SM - rL * uL);
    F[2] = rL * uL * vL + SL * (f * vL - rL * vL);
    F[3] = uL * (EL + pL) + SL * (Es - EL);
    F[4] = rL * uL * YL + SL * (f * YL - rL * YL);
  } else {
    const f = rR * (SR - uR) / (SR - SM);
    const Es = f * (ER / rR + (SM - uR) * (SM + pR / (rR * (SR - uR))));
    F[0] = rR * uR + SR * (f - rR);
    F[1] = rR * uR * uR + pR + SR * (f * SM - rR * uR);
    F[2] = rR * uR * vR + SR * (f * vR - rR * vR);
    F[3] = uR * (ER + pR) + SR * (Es - ER);
    F[4] = rR * uR * YR + SR * (f * YR - rR * YR);
  }
}
const minmod = (a, b) => (a * b <= 0 ? 0 : Math.abs(a) < Math.abs(b) ? a : b);

/* Riemann 不變量遠場：n 為外法向；回傳 ghost 原始變數到 G[0..4] = ρ,u,v,p,Y */
function farfield(r, u, v, p, Y, g, nx, nr, fs, G) {
  const un = u * nx + v * nr, c = Math.sqrt(g * p / r);
  const g0 = 1.4, c0 = Math.sqrt(g0 * fs.p / fs.r), un0 = fs.u * nx;
  if (un >= c) { G[0] = r; G[1] = u; G[2] = v; G[3] = p; G[4] = Y; return; }
  if (un0 <= -c0) { G[0] = fs.r; G[1] = fs.u; G[2] = 0; G[3] = fs.p; G[4] = 0; return; }
  const Rp = un + 2 * c / (g - 1), Rm = un0 - 2 * c0 / (g0 - 1);
  const unb = 0.5 * (Rp + Rm);
  let gb, s, ut, vt, Yb;
  if (unb > 0) { gb = g; s = p / Math.pow(r, g); ut = u - un * nx; vt = v - un * nr; Yb = Y; }
  else { gb = g0; s = fs.p / Math.pow(fs.r, g0); ut = fs.u - un0 * nx; vt = -un0 * nr; Yb = 0; }
  const cb = Math.max(1, 0.25 * (gb - 1) * (Rp - Rm));
  const rb = Math.pow(cb * cb / (gb * s), 1 / (gb - 1));
  G[0] = rb; G[1] = ut + unb * nx; G[2] = vt + unb * nr; G[3] = rb * cb * cb / gb; G[4] = Yb;
}

function CPUSolver(grid, zones, comps, fs, Q0, opt) {
  const { W, H, N } = grid;
  this.grid = grid; this.z = zones; this.comps = comps; this.fs = fs;
  this.opt = Object.assign({ cfl: 0.6, order: 2, visc: true }, opt || {});
  this.Q = Q0.map(a => Float64Array.from(a));
  this.Q1 = Q0.map(a => new Float64Array(N));
  this.R = Q0.map(() => new Float64Array(N));
  this.dt = new Float64Array(N);
  this.nu = new Float64Array(N);
  this.P = { r: new Float64Array(N), u: new Float64Array(N), v: new Float64Array(N), p: new Float64Array(N), Y: new Float64Array(N), g: new Float64Array(N) };
  this.Fx = Array.from({ length: 5 }, () => new Float64Array((W + 1) * H));
  this.Fr = Array.from({ length: 5 }, () => new Float64Array(W * (H + 1)));
  this.iter = 0;
  this.hf = (opt && opt.hf) || 0.99 * 43e6;
  this.src = new Float64Array(N); // 診斷：葉片排能量源（W/m³）或燃料質量源（kg/(s·m³)），每單位流體體積
  this.mfx = new Float64Array(N); // 診斷：格兩側軸向面質量通量平均（kg/(s·m²)，含開口分率）
}
CPUSolver.prototype.prim = function (Q) {
  const P = this.P, N = this.grid.N, s = this.z.solid;
  for (let k = 0; k < N; k++) {
    const r = Math.max(Q[0][k], 1e-4), u = Q[1][k] / r, v = Q[2][k] / r, Y = clamp(Q[4][k] / r, 0, 1), g = 1.4 - 0.07 * Y;
    P.r[k] = r; P.u[k] = u; P.v[k] = v; P.Y[k] = Y; P.g[k] = g;
    P.p[k] = Math.max(1, (g - 1) * (Q[3][k] - 0.5 * r * (u * u + v * v)));
  }
};
CPUSolver.prototype.residual = function (Q, computeDt) {
  const { W, H, xc, rc, dx, dr, rf } = this.grid, z = this.z, P = this.P, fs = this.fs;
  const second = this.opt.order === 2, visc = this.opt.visc;
  this.prim(Q);
  const F = new Float64Array(5), G = new Float64Array(5), G2 = new Float64Array(5);
  const S = z.solid;
  const Fx = this.Fx, Fr = this.Fr, nu = this.nu;
  nu.fill(0);
  const L = new Float64Array(5), Rr = new Float64Array(5);
  const A5 = new Float64Array(5), B5 = new Float64Array(5), T5 = new Float64Array(5);
  const sel = (k, dir, o) => { o[0] = P.r[k]; o[1] = dir ? P.v[k] : P.u[k]; o[2] = dir ? P.u[k] : P.v[k]; o[3] = P.p[k]; o[4] = P.Y[k]; };
  const recon = (a, am, b, bp, dir) => { // 方向：0 = x, 1 = r；左右狀態 (ρ, un, ut, p, Y) 寫入 L、Rr
    sel(a, dir, A5); sel(b, dir, B5);
    for (let q = 0; q < 5; q++) { L[q] = A5[q]; Rr[q] = B5[q]; }
    if (!second) return;
    if (am >= 0) { sel(am, dir, T5); for (let q = 0; q < 5; q++) L[q] = A5[q] + 0.5 * minmod(A5[q] - T5[q], B5[q] - A5[q]); }
    if (bp >= 0) { sel(bp, dir, T5); for (let q = 0; q < 5; q++) Rr[q] = B5[q] - 0.5 * minmod(B5[q] - A5[q], T5[q] - B5[q]); }
    if (L[0] <= 0 || L[3] <= 0) for (let q = 0; q < 5; q++) L[q] = A5[q];
    if (Rr[0] <= 0 || Rr[3] <= 0) for (let q = 0; q < 5; q++) Rr[q] = B5[q];
  };
  const phi = z.phi, AE = z.ae, AN = z.an;
  const full = k => phi[k] > 0.999;
  // ---- x 面（開口分率 αE；切割格用一階重建）----
  for (let j = 0; j < H; j++) for (let f = 0; f <= W; f++) {
    const fi = j * (W + 1) + f, a = f - 1, b = f;
    const ka = j * W + a, kb = j * W + b;
    let al;
    if (a < 0) al = S[kb] ? 0 : 1; else if (b >= W) al = S[ka] ? 0 : 1; else al = AE[ka];
    if (al <= 0) { for (let q = 0; q < 5; q++) Fx[q][fi] = 0; continue; }
    if (a < 0) { farfield(P.r[kb], P.u[kb], P.v[kb], P.p[kb], P.Y[kb], P.g[kb], -1, 0, fs, G); hllc(G[0], G[1], G[2], G[3], G[4], 1.4 - 0.07 * G[4], P.r[kb], P.u[kb], P.v[kb], P.p[kb], P.Y[kb], P.g[kb], F); }
    else if (b >= W) { farfield(P.r[ka], P.u[ka], P.v[ka], P.p[ka], P.Y[ka], P.g[ka], 1, 0, fs, G); hllc(P.r[ka], P.u[ka], P.v[ka], P.p[ka], P.Y[ka], P.g[ka], G[0], G[1], G[2], G[3], G[4], 1.4 - 0.07 * G[4], F); }
    else {
      const fa = full(ka) && full(kb);
      const am = fa && a - 1 >= 0 && full(ka - 1) ? ka - 1 : -1, bp = fa && b + 1 < W && full(kb + 1) ? kb + 1 : -1;
      recon(ka, am, kb, bp, 0);
      hllc(L[0], L[1], L[2], L[3], L[4], 1.4 - 0.07 * L[4], Rr[0], Rr[1], Rr[2], Rr[3], Rr[4], 1.4 - 0.07 * Rr[4], F);
    }
    for (let q = 0; q < 5; q++) Fx[q][fi] = al * F[q];
  }
  // ---- r 面（旋轉：法向 v、切向 u；開口分率 αN）----
  for (let f = 0; f <= H; f++) for (let i = 0; i < W; i++) {
    const fi = f * W + i, a = f - 1, b = f;
    const ka = a * W + i, kb = b * W + i;
    for (let q = 0; q < 5; q++) G2[q] = 0;
    let al = a < 0 ? 0 : b >= H ? (S[ka] ? 0 : 1) : AN[ka];
    if (al <= 0) { for (let q = 0; q < 5; q++) Fr[q][fi] = 0; continue; }
    if (b >= H) {
      farfield(P.r[ka], P.u[ka], P.v[ka], P.p[ka], P.Y[ka], P.g[ka], 0, 1, fs, G);
      hllc(P.r[ka], P.v[ka], P.u[ka], P.p[ka], P.Y[ka], P.g[ka], G[0], G[2], G[1], G[3], G[4], 1.4 - 0.07 * G[4], F);
    } else {
      const fa = full(ka) && full(kb);
      const am = fa && a - 1 >= 0 && full(ka - W) ? ka - W : -1, bp = fa && b + 1 < H && full(kb + W) ? kb + W : -1;
      recon(ka, am, kb, bp, 1);
      hllc(L[0], L[1], L[2], L[3], L[4], 1.4 - 0.07 * L[4], Rr[0], Rr[1], Rr[2], Rr[3], Rr[4], 1.4 - 0.07 * Rr[4], F);
      if (visc) { // 混合長度渦黏：τ_xr、熱通量、組分擴散
        const drc = rc[b] - rc[a];
        const dudr = (P.u[kb] - P.u[ka]) / drc;
        const l = 0.5 * (z.lmix[ka] + z.lmix[kb]);
        const nut = l * l * Math.abs(dudr), rho = 0.5 * (P.r[ka] + P.r[kb]);
        const mu = rho * nut;
        const Ta = P.p[ka] / (P.r[ka] * RGAS), Tb = P.p[kb] / (P.r[kb] * RGAS);
        const ga = 0.5 * (P.g[ka] + P.g[kb]), cp = ga * RGAS / (ga - 1);
        const tau = mu * dudr;
        G2[1] = tau; G2[3] = 0.5 * (P.u[ka] + P.u[kb]) * tau + mu * cp / 0.9 * (Tb - Ta) / drc; G2[4] = mu / 0.9 * (P.Y[kb] - P.Y[ka]) / drc;
        if (nut > nu[ka]) nu[ka] = nut; if (nut > nu[kb]) nu[kb] = nut;
      }
    }
    Fr[0][fi] = al * F[0]; Fr[1][fi] = al * (F[2] - G2[1]); Fr[2][fi] = al * F[1]; Fr[3][fi] = al * (F[3] - G2[3]); Fr[4][fi] = al * (F[4] - G2[4]);
  }
  // ---- 組裝殘差與源項 ----
  const R = this.R, dt = this.dt, cfl = this.opt.cfl, cmp = this.comps;
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i;
    if (S[k]) { for (let q = 0; q < 5; q++) R[q][k] = 0; continue; }
    const fx0 = j * (W + 1) + i, fx1 = fx0 + 1, fr0 = j * W + i, fr1 = fr0 + W;
    const ax0 = rf[j], ax1 = rf[j + 1], vol = rc[j] * dr[j], ph = phi[k];
    for (let q = 0; q < 5; q++) R[q][k] = (-(Fx[q][fx1] - Fx[q][fx0]) / dx[i] - (Fr[q][fr1] * ax1 - Fr[q][fr0] * ax0) / vol) / ph;
    // 壁面與側面壓力：p·(開口面積差)；全流體格即為軸對稱幾何源項 p/r
    const aw = i > 0 ? AE[k - 1] : 1, as = j > 0 ? AN[k - W] : 0;
    R[1][k] += P.p[k] * (AE[k] - aw) / (dx[i] * ph);
    R[2][k] += P.p[k] * (AN[k] * ax1 - as * ax0) / (vol * ph);
    const mfx = 0.5 * (Fx[0][fx0] + Fx[0][fx1]); // 兩側軸向面質量通量平均（含開口分率）
    this.mfx[k] = mfx; this.src[k] = 0;
    const id = z.comp[k];
    if (id) {
      const rho = Q[0][k], g = P.g[k], cp = g * RGAS / (g - 1);
      const T = P.p[k] / (rho * RGAS), Tt = T + 0.5 * (P.u[k] * P.u[k] + P.v[k] * P.v[k]) / cp;
      const ty = cmp[id * 4 + 2], mf = mfx / ph; // 每單位流體截面之通過質量通量
      if (ty === 1 || ty === 2) {
        // 葉片排：每格總溫比 τ^(權重·dx)，以上游格總溫為基準，功以通過質量通量計 → 穩態時整排總溫比 = τ
        // 渦輪在通過流量低於設計值 30% 時線性減功（零流量不做功）
        const e = cmp[id * 4 + 1], fac = ty === 1 ? 1 : clamp(mf / (0.3 * z.mfd[k]), 0, 1);
        // 上游總焓取西面能量通量 ÷ 質量通量（面值），使整排逐格乘積在穩態時精確等於 τ
        const mw = Fx[0][fx0], HU = mw > 1e-9 ? Fx[3][fx0] / mw : cp * Tt;
        const w = (HU > 0 ? HU : cp * Tt) * Math.expm1(cmp[id * 4] * z.wgt[k] * fac * dx[i]) / dx[i];
        R[1][k] += ty === 1 ? e * rho * w : rho * w / e;
        R[3][k] += mf * w; this.src[k] = mf * w;
      } else if (z.rate[k] > 0) {
        // 熱源：沿流向鬆弛至目標總溫；目標 = 基準 + (逐格分布 − 基準) × 控制係數（使出口平均總溫符合設定）
        const tgt = cmp[id * 4] + (z.tgt[k] - cmp[id * 4]) * (cmp[id * 4 + 1] || 1);
        const m0 = Math.max(mf, 0);
        const q = m0 * cp * Math.max(0, tgt - Tt) * z.rate[k];
        R[3][k] += q; const mfuel = q / (this.opt.hf || this.hf); R[0][k] += mfuel; this.src[k] = mfuel;
        R[4][k] += m0 * (1 - P.Y[k]) * z.yrate[k] + mfuel;
      }
    }
    if (computeDt) {
      const c = Math.sqrt(P.g[k] * P.p[k] / P.r[k]);
      dt[k] = cfl * Math.max(phi[k], 0.25) / ((Math.abs(P.u[k]) + c) / dx[i] + (Math.abs(P.v[k]) + c) / dr[j] + 2.2 * nu[k] / (dr[j] * dr[j]));
    }
  }
};
CPUSolver.prototype.fix = function (Q, k) {
  const r = Math.max(Q[0][k], 1e-3); Q[0][k] = r;
  const Y = clamp(Q[4][k] / r, 0, 1); Q[4][k] = Y * r;
  const g = 1.4 - 0.07 * Y, ke = 0.5 * (Q[1][k] * Q[1][k] + Q[2][k] * Q[2][k]) / r;
  if ((g - 1) * (Q[3][k] - ke) < 50) Q[3][k] = 50 / (g - 1) + ke;
};
CPUSolver.prototype.step = function (n) {
  const N = this.grid.N, S = this.z.solid;
  for (let it = 0; it < (n || 1); it++) {
    const Q = this.Q, Q1 = this.Q1, R = this.R, dt = this.dt;
    this.residual(Q, true);
    if (this.opt.global || this.opt.dtRatio) {
      let mn = Infinity; for (let k = 0; k < N; k++) if (!S[k] && dt[k] < mn) mn = dt[k];
      const cap = this.opt.global ? mn : mn * this.opt.dtRatio;
      for (let k = 0; k < N; k++) if (dt[k] > cap) dt[k] = cap;
    }
    for (let q = 0; q < 5; q++) { const a = Q[q], b = Q1[q], rr = R[q]; for (let k = 0; k < N; k++) b[k] = S[k] ? a[k] : a[k] + dt[k] * rr[k]; }
    for (let k = 0; k < N; k++) if (!S[k]) this.fix(Q1, k);
    this.residual(Q1, false);
    for (let q = 0; q < 5; q++) { const a = Q[q], b = Q1[q], rr = R[q]; for (let k = 0; k < N; k++) if (!S[k]) a[k] = 0.5 * a[k] + 0.5 * (b[k] + dt[k] * rr[k]); }
    for (let k = 0; k < N; k++) if (!S[k]) this.fix(Q, k);
    this.iter++;
  }
};
CPUSolver.prototype.setComps = function (c) { this.comps = Float64Array.from(c); };
CPUSolver.prototype.setZones = function (z) { this.z = z; };
CPUSolver.prototype.setFs = function (fs) { this.fs = fs; };
CPUSolver.prototype.dispose = function () {};

if (typeof module !== 'undefined') module.exports = { CPUSolver, hllc, farfield };
