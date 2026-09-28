/* ============================================================
 *  cfd_post.js — CFD 後處理：衍生場、推力、流量、截面平均
 * ============================================================ */
function cfdPrim(Q, k) {
  const r = Math.max(Q[0][k], 1e-4), u = Q[1][k] / r, v = Q[2][k] / r, Y = clamp(Q[4][k] / r, 0, 1), g = 1.4 - 0.07 * Y;
  const p = Math.max(1, (g - 1) * (Q[3][k] - 0.5 * r * (u * u + v * v)));
  return { r, u, v, p, Y, g };
}
/* 顯示用網格（與 v1 paintGrid 相容）；disp = true 時體積分率 < 0.5 的切割格以固體顯示 */
function cfdDerived(grid, zones, Q, fl, G, disp) {
  const { W, H, N, xc, rc } = grid;
  if (!G || G.N !== N) {
    G = { W, H, N, reg: new Uint8Array(N), mat: new Uint8Array(N) };
    for (const k of ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho', 'Vx', 'Vth', 'Vr', 'Y', 'vort', 'ds']) G[k] = new Float32Array(N);
  }
  const S = disp ? (zones.dsolid || (zones.dsolid = Uint8Array.from(zones.solid, (v, k) => v || zones.phi[k] < 0.5 ? 1 : 0))) : zones.solid;
  const s0T = fl.T0, s0P = fl.P0;
  for (let k = 0; k < N; k++) {
    if (S[k]) { G.reg[k] = 1; G.mat[k] = zones.mat[k]; for (const q of ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho', 'Vx', 'Vr', 'Y', 'vort', 'ds']) G[q][k] = NaN; continue; }
    const st = zones.stream[k];
    G.reg[k] = st < 0 ? 0 : 2 + st;
    const r = Math.max(Q[0][k], 1e-4), u = Q[1][k] / r, v = Q[2][k] / r, Y = clamp(Q[4][k] / r, 0, 1), g = 1.4 - 0.07 * Y;
    const p = Math.max(1, (g - 1) * (Q[3][k] - 0.5 * r * (u * u + v * v)));
    const T = p / (r * RGAS), cp = g * RGAS / (g - 1), V2 = u * u + v * v, a = Math.sqrt(g * p / r);
    const Tt = T + V2 / (2 * cp);
    G.T[k] = T; G.P[k] = p; G.rho[k] = r; G.Vx[k] = u; G.Vr[k] = v; G.Vth[k] = 0; G.V[k] = Math.sqrt(V2); G.M[k] = Math.sqrt(V2) / a;
    G.Tt[k] = Tt; G.Pt[k] = p * Math.pow(Tt / T, g / (g - 1)); G.Y[k] = Y;
    G.ds[k] = cp * Math.log(T / s0T) - RGAS * Math.log(p / s0P);
  }
  // 渦度 ω_θ = ∂u/∂r − ∂v/∂x（中央差分）
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; if (S[k]) continue;
    const kl = i > 0 && !S[k - 1] ? k - 1 : k, kr = i < W - 1 && !S[k + 1] ? k + 1 : k;
    const kd = j > 0 && !S[k - W] ? k - W : k, ku = j < H - 1 && !S[k + W] ? k + W : k;
    const dxx = grid.xc[kr % W] - grid.xc[kl % W], drr = rc[(ku / W) | 0] - rc[(kd / W) | 0];
    const dvdx = dxx > 0 ? (G.Vr[kr] - G.Vr[kl]) / dxx : 0, dudr = drr > 0 ? (G.Vx[ku] - G.Vx[kd]) / drr : 0;
    G.vort[k] = dudr - dvdx;
  }
  return G;
}
/* 推力：引擎對流體之軸向力 = 葉片體積力 + 壁面壓力（表壓） */
/* src（選用）：求解器輸出 { S: 逐格源項（葉片排能量 W/m³；熱源區燃料 kg/(s·m³)），F: 格兩側軸向面質量通量平均 }
   有 src 時功率與燃油流量取自求解器實際施加之源項 */
function cfdForces(grid, zones, Q, comps, P0, hf, src) {
  const { W, H, xc, rc, dx, dr } = grid, S = zones.solid;
  let Fb = 0, Fw = 0, mfuel = 0;
  const pw = new Float64Array(8);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i; if (S[k]) continue;
    const A = 2 * Math.PI * rc[j] * dr[j], V = A * dx[i] * zones.phi[k];
    const id = zones.comp[k];
    if (id) {
      const ty = comps[id * 4 + 2];
      if (ty === 1 || ty === 2) {
        const q = cfdPrim(Q, k), cp = q.g * RGAS / (q.g - 1), T = q.p / (q.r * RGAS), Tt = T + 0.5 * (q.u * q.u + q.v * q.v) / cp;
        const e = comps[id * 4 + 1], mf = src ? src.F[k] / zones.phi[k] : Q[1][k];
        const fac = ty === 1 ? 1 : clamp(mf / (0.3 * zones.mfd[k]), 0, 1);
        // 有 src 時 w 由求解器實際施加之能量源反推（與求解器一致）；否則以格心總溫近似
        const w = src ? (Math.abs(mf) > 1e-9 ? src.S[k] / mf : 0) : cp * Tt * Math.expm1(comps[id * 4] * zones.wgt[k] * fac * dx[i]) / dx[i];
        Fb += (ty === 1 ? e * q.r * w : q.r * w / e) * V;
        pw[id] += (src ? src.S[k] : mf * w) * V;
      } else if (zones.rate[k] > 0) {
        if (src) mfuel += src.S[k] * V;
        else {
          const q = cfdPrim(Q, k), cp = q.g * RGAS / (q.g - 1), T = q.p / (q.r * RGAS), Tt = T + 0.5 * (q.u * q.u + q.v * q.v) / cp;
          const tgt = comps[id * 4] + (zones.tgt[k] - comps[id * 4]) * (comps[id * 4 + 1] || 1);
          mfuel += Math.max(Q[1][k], 0) * cp * Math.max(0, tgt - Tt) * zones.rate[k] / (hf || 0.99 * 43e6) * V;
        }
      }
    }
    const aw = i > 0 ? zones.ae[k - 1] : 1, dA = zones.ae[k] - aw;
    if (dA !== 0) Fw += (cfdPrim(Q, k).p - P0) * dA * A; // 壁面壓力對流體的軸向力
  }
  return { F: Fb + Fw, Fb, Fw, pw, mfuel };
}
function colAt(grid, x) {
  const { xc, W } = grid; let lo = 0, hi = W - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (xc[m] <= x) lo = m; else hi = m; }
  return Math.abs(xc[lo] - x) < Math.abs(xc[hi] - x) ? lo : hi;
}
/* 截面質量平均（stream 為流道索引；-1 表示外部；null 表示全部流體） */
/* mfx（選用）：求解器之格兩側軸向面質量通量平均；有則用於流量與加權（避免葉片排附近格心 ρu 失真） */
function cfdSection(grid, zones, Q, x, si, mfx) {
  const { W, H, rc, dr } = grid, S = zones.solid;
  const i = colAt(grid, x);
  let m = 0, w = 0, A = 0, pA = 0;
  const acc = { Tt: 0, Pt: 0, T: 0, P: 0, V: 0, M: 0, Y: 0 };
  for (let j = 0; j < H; j++) {
    const k = j * W + i; if (S[k]) continue;
    if (si !== null && zones.stream[k] !== si) continue;
    const q = cfdPrim(Q, k), al = Math.min(1, 0.5 * ((i > 0 ? zones.ae[k - 1] : 1) + zones.ae[k])), dA = 2 * Math.PI * rc[j] * dr[j] * al; // 以軸向面開口分率修正切割格面積
    const T = q.p / (q.r * RGAS), cp = q.g * RGAS / (q.g - 1), V2 = q.u * q.u + q.v * q.v, Tt = T + V2 / (2 * cp);
    const Pt = q.p * Math.pow(Tt / T, q.g / (q.g - 1)), mf = mfx ? mfx[k] * 2 * Math.PI * rc[j] * dr[j] : q.r * q.u * dA, wk = Math.max(mf, 0);
    m += mf; w += wk; A += dA; pA += q.p * dA;
    acc.Tt += wk * Tt; acc.Pt += wk * Pt; acc.T += wk * T; acc.P += wk * q.p; acc.V += wk * Math.sqrt(V2);
    acc.M += wk * Math.sqrt(V2 / (q.g * q.p / q.r)); acc.Y += wk * q.Y;
  }
  const d = w || 1, out = { x: grid.xc[i], mdot: m, A };
  for (const key in acc) out[key] = acc[key] / d;
  if (!w) out.P = pA / (A || 1);
  return out;
}

/* 轉軸功率比（診斷）：ηm·P渦輪 / P壓縮。葉片排溫比取自一維循環，轉速固定。
   spoolMatch 保留作為轉速調整實驗用（壓縮功 ∝ n²、渦輪功 ∝ n），介面不使用。 */
const SPOOLS = { hbtf: [[[1, 2], 6], [[3], 5]], tj: [[[3], 5]], lbtf: [[[1], 6], [[3], 5]] };
/* 控制迴路（每次讀回呼叫一次）：燃燒室／後燃器出口平均總溫——調整熱源目標之控制係數 K，
   使出口質量平均總溫等於設定值（相當於燃油控制）。另回傳轉軸功率比（診斷）。
   註：以渦輪溫比或轉速做轉軸功率匹配在本體積力模型下為正回饋（渦輪功增加 → 流阻增加 → 流量下降），會發散，故不採用。 */
function cfdControl(type, spec, grid, zones, Q, mfx, comps, base, pw, op, etam, dIt) {
  const lim = 0.03 * Math.min(1, (dIt || 100) / 100); // 每 100 次迭代最多調整 3%
  const out = { ratios: spoolRatios(type, pw, etam), Tt4: NaN, Tt7: NaN };
  const ctl = (id, x, si, target) => {
    const sec = cfdSection(grid, zones, Q, x, si, mfx);
    const T0 = comps[id * 4], K = comps[id * 4 + 1] || 1;
    // 小增益並依迭代數限幅：流場有非穩態擺動時控制量仍平順
    if (sec.mdot > 0 && sec.Tt > T0 + 20 && target > T0 + 20) comps[id * 4 + 1] = clamp(K * clamp(Math.pow((target - T0) / (sec.Tt - T0), 0.3), 1 - lim, 1 + lim), 0.5, 2.5);
    return sec.Tt;
  };
  const cb = spec.comb; out.Tt4 = ctl(4, cb.x1 - 0.004 * spec.s, spec.order.indexOf(cb.stream), op.Tt4);
  if (spec.ab && op.abOn) out.Tt7 = ctl(7, spec.ab.x1 - 0.004 * spec.s, spec.order.indexOf(spec.ab.stream), op.Tt7);
  return out;
}
function spoolRatios(type, pw, etam) {
  return SPOOLS[type].map(([cs, t]) => { const Pc = cs.reduce((a, id) => a + pw[id], 0), Pt = -pw[t]; return Pc > 0 && Pt > 0 ? etam * Pt / Pc : NaN; });
}
function spoolMatch(type, comps, base, pw, etam, nsp) {
  const res = [];
  SPOOLS[type].forEach(([cs, t], si) => {
    const Pc = cs.reduce((a, id) => a + pw[id], 0), Pt = -pw[t];
    let n = nsp[si];
    const ratio = Pc > 0 && Pt > 0 ? etam * Pt / Pc : 1;
    if (Pc > 0 && Pt > 0) n = clamp(n * Math.pow(clamp(ratio, 0.5, 2), 0.35), 0.55, 1.25);
    nsp[si] = n;
    for (const id of cs) comps[id * 4] = base[id * 4] * n * n;
    comps[t * 4] = base[t * 4] * n;
    res.push(ratio);
  });
  return res;
}

if (typeof module !== 'undefined') module.exports = { cfdDerived, cfdForces, cfdControl, spoolMatch, spoolRatios, cfdSection, colAt, cfdPrim };
