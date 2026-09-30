/* ============================================================
 *  aero.js — 全機氣動：面元法條件分析（升力、力矩、配平、表面 Cp）、
 *  超音速局部傾角法（表面 Cp 示意）、阻力分解（Raymer 組件累加）、性能用氣動資料庫
 * ============================================================ */
const AIR = { g: 1.4, R: 287.05, cp: 1004.5 };
// DEG 由 geometry.js／field.js 定義（Math.PI / 180）
function sutherland(T) { return 1.458e-6 * Math.pow(T, 1.5) / (T + 110.4); }
function cpStag(M) { const g = 1.4; if (M < 1e-3) return 1; if (M <= 1) return (2 / (g * M * M)) * (Math.pow(1 + 0.2 * M * M, 3.5) - 1); const p02p1 = Math.pow((g + 1) ** 2 * M * M / (4 * g * M * M - 2 * (g - 1)), g / (g - 1)) * (1 - g + 2 * g * M * M) / (g + 1); return (p02p1 - 1) / (0.5 * g * M * M); }
function cpVac(M) { return M < 0.05 ? -400 : -2 / (1.4 * M * M); }
/* 弦長比例 n 處後掠角（全翼展展弦比；垂尾以鏡像計） */
function sweepAt(Sx, n) { const Afull = Sx.vertical ? 2 * Sx.semi * Sx.semi / Sx.S : (2 * Sx.semi) ** 2 / Sx.S; return Math.atan(Sx.tanL - 4 * n * (1 - Sx.o.taper) / (Afull * (1 + Sx.o.taper))); }
function cpStar(M) { if (M < 0.05) return -1e9; return (2 / (1.4 * M * M)) * (Math.pow((2 + 0.4 * M * M) / 2.4, 3.5) - 1); }

/* ============================================================
 *  面元法條件分析
 *  M：分析馬赫數（Göthert，最高 0.85）；單位解：沿 x、沿 z、平尾偏轉（每弧度）
 * ============================================================ */
function PanelAero(ac, set, M) {
  this.ac = ac; this.set = set;
  this.Mp = Math.min(Math.max(M, 0), 0.85);
  this.beta = Math.sqrt(1 - this.Mp * this.Mp);
  this.solver = new PanelSolver(set, { beta: this.beta });
  this.ready = false;
}
PanelAero.prototype.finish = function () {
  const so = this.solver, N = so.N, P = so.Ps, b = this.beta;
  this.sX = so.solve([1, 0, 0], null, 1);
  this.sZ = so.solve([0, 0, 1], null, 0);
  const ext = new Float64Array(N);
  for (let k = 0; k < N; k++) if (P[k].comp === 'htail') ext[k] = -b * P[k].n[2]; // 全動平尾抬頭偏轉 1 rad（伸長空間斜率 × β）
  this.sD = so.solve([0, 0, 0], ext, 0);
  // 升力面條帶資料（KJ 升力與力矩）
  const set = this.set, strips = [];
  for (let pi = 0; pi < set.patches.length; pi++) {
    const pt = set.patches[pi];
    if (pt.comp !== 'wing' && pt.comp !== 'htail') continue;
    const nc = pt.ni / 2;
    for (let j = 0; j < pt.nj; j++) {
      const up = pt.idx[pt.ni - 1][j], lo = pt.idx[0][j];
      if (up < 0 || lo < 0) continue;
      const pairs = [];
      for (let k = 0; k < nc; k++) {
        const iu = pt.idx[nc + k][j], il = pt.idx[nc - 1 - k][j];
        if (iu < 0 || il < 0) continue;
        const pu = set.P[iu], dx = 0.5 * (Math.abs(pu.c[1][0] - pu.c[0][0]) + Math.abs(pu.c[2][0] - pu.c[3][0]));
        pairs.push([iu, il, dx]);
      }
      const pu = set.P[up], a = pu.c[1], bb = pu.c[2]; // 後緣兩端（上表面後緣面元的後緣邊）
      const dy = bb[1] - a[1], dz = bb[2] - a[2], ds = Math.hypot(dy, dz);
      strips.push({ comp: pt.comp, j, up, lo, pairs, xTE: 0.5 * (a[0] + bb[0]), yc: 0.5 * (a[1] + bb[1]), ds, cphi: Math.abs(dy) / ds, chord: pairs.reduce((s, q) => s + q[2], 0) });
    }
  }
  this.strips = strips;
  this.ready = true;
};
PanelAero.prototype.prepareSync = function () { this.solver.assemble(); this.finish(); return this; };
PanelAero.prototype.prepareAsync = function (onProgress) { return this.solver.assembleAsync(onProgress).then(() => { this.finish(); return this; }); };
/* 組合解：α（物理，度）、平尾偏轉 δ（度，抬頭為正） */
PanelAero.prototype.combine = function (alphaDeg, deltaDeg) {
  const a = alphaDeg * DEG, ap = Math.atan(this.beta * Math.tan(a)), ca = Math.cos(ap), sa = Math.sin(ap), d = (deltaDeg || 0) * DEG;
  const N = this.solver.N, mu = new Float64Array(N), sig = new Float64Array(N);
  for (let k = 0; k < N; k++) { mu[k] = ca * this.sX.mu[k] + sa * this.sZ.mu[k] + d * this.sD.mu[k]; sig[k] = ca * this.sX.sig[k] + sa * this.sZ.sig[k] + d * this.sD.sig[k]; }
  return { mu, sig, V: [ca, 0, sa], vnScale: ca, alpha: alphaDeg, delta: deltaDeg || 0 };
};
/* 係數：升力面以 Kutta–Joukowski 條帶（Γ 與 Δμ 弦向分布），機體類以表面壓力積分 */
PanelAero.prototype.coeffs = function (sol, withCp) {
  const ac = this.ac, ref = ac.ref, S = ref.S, c = ref.c, xr = ref.xcg, zr = ref.zcg || 0, b = this.beta, set = this.set;
  const mu = sol.mu, a = sol.alpha * DEG, ca = Math.cos(a), sa = Math.sin(a);
  const out = { CL: 0, Cm: 0, byc: {}, bym: {}, span: [] };
  const add = (comp, L, M) => { out.CL += L; out.Cm += M; out.byc[comp] = (out.byc[comp] || 0) + L; out.bym[comp] = (out.bym[comp] || 0) + M; };
  for (const st of this.strips) {
    const G = mu[st.up] - mu[st.lo];
    let I = 0; for (const [iu, il, dx] of st.pairs) I += (mu[iu] - mu[il]) * dx;
    const w = 2 * st.ds * st.cphi / b; // 左右兩側（×2）與 l/q = 2Γ/β
    const L = 2 * w * G / S, Mm = -2 * w * ((st.xTE - xr) * G - I) / (S * c);
    add(st.comp, L, Mm);
    out.span.push({ comp: st.comp, y: st.yc, G: G / b, ccl: 2 * G / b, chord: st.chord });
  }
  let vel = null, cp = null;
  const needCp = withCp !== false; // 'forces'：仍需機體表面速度
  if (needCp) {
    vel = this.solver.surface(sol); cp = new Float64Array(this.solver.N);
    const lo = cpVac(this.Mp), hi = cpStag(this.Mp);
    // 機體面元 Cp 下限 −3（交線附近離散誤差），升力面僅受真空極限限制
    for (let k = 0; k < cp.length; k++) { const v2 = vel[3 * k] ** 2 + vel[3 * k + 1] ** 2 + vel[3 * k + 2] ** 2, c = set.P[k].comp; cp[k] = Math.max(c === 'wing' || c === 'htail' ? lo : Math.max(lo, -3), Math.min(hi, (1 - v2) / (b * b))); }
    for (let k = 0; k < cp.length; k++) {
      const p = set.P[k]; if (p.comp === 'wing' || p.comp === 'htail') continue;
      const fx = -cp[k] * p.A * p.n[0], fz = -cp[k] * p.A * p.n[2];
      const L = 2 * (fz * ca - fx * sa) / S, Mm = 2 * ((p.cen[2] - zr) * fx - (p.cen[0] - xr) * fz) / (S * c);
      add(p.comp, L, Mm);
    }
  }
  const tf = this.solver.trefftz(sol);
  out.e = tf.wing ? tf.wing.e : 1;
  out.eT = tf.htail ? tf.htail.e : 1;
  out.cp = cp; out.vel = vel;
  return out;
};
/* 配平：求 α、δ 使 CL = CLreq、Cm = 0（牛頓法，數值 Jacobian） */
PanelAero.prototype.trim = function (CLreq, guess) {
  let al = guess ? guess.alpha : 2, de = guess ? guess.delta : 0;
  const f = (a, d) => { const r = this.coeffs(this.combine(a, d), 'forces'); return [r.CL - CLreq, r.Cm, r]; };
  let r0;
  for (let it = 0; it < 8; it++) {
    const [f1, f2, r] = f(al, de); r0 = r;
    if (Math.abs(f1) < 2e-4 && Math.abs(f2) < 2e-4) break;
    const [a1, a2] = f(al + 0.5, de), [b1, b2] = f(al, de + 0.5);
    const J11 = (a1 - f1) / 0.5, J21 = (a2 - f2) / 0.5, J12 = (b1 - f1) / 0.5, J22 = (b2 - f2) / 0.5;
    const det = J11 * J22 - J12 * J21; if (Math.abs(det) < 1e-12) break;
    const da = (-f1 * J22 + f2 * J12) / det, dd = (-J11 * f2 + J21 * f1) / det;
    al += Math.max(-8, Math.min(8, da)); de += Math.max(-15, Math.min(15, dd));
  }
  // 穩定性導數（α、δ）
  const [c1, m1] = f(al + 1, de), [c0, m0] = f(al, de), [d1, dm1] = f(al, de + 1);
  return { alpha: al, delta: de, CLa: (c1 - c0) / DEG, Cma: (m1 - m0) / DEG, CLd: (d1 - c0) / DEG, Cmd: (dm1 - m0) / DEG, r: r0, ok: Math.abs(c0) < 0.01 && Math.abs(m0) < 0.01 };
};

/* ============================================================
 *  超音速局部傾角法（顯示用表面 Cp）：迎風面切楔（翼面）或切錐（機體），背風面 Prandtl–Meyer
 * ============================================================ */
function pmNu(M, g = 1.4) { if (M <= 1) return 0; const a = Math.sqrt((g + 1) / (g - 1)); return a * Math.atan(Math.sqrt((M * M - 1) / a / a)) - Math.atan(Math.sqrt(M * M - 1)); }
function pmInv(nu, g = 1.4) { let lo = 1, hi = 40; for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (pmNu(m, g) < nu) lo = m; else hi = m; } return 0.5 * (lo + hi); }
function obliqueCp(M, d, g = 1.4) { // 弱斜震波；超過最大偏轉角回傳 null
  const mu = Math.asin(1 / M); let lo = mu, hi = Math.PI / 2, best = null;
  const th = b => Math.atan(2 / Math.tan(b) * (M * M * Math.sin(b) ** 2 - 1) / (M * M * (g + Math.cos(2 * b)) + 2));
  // 尋找最大偏轉角位置
  let bmax = mu, tmax = 0; for (let k = 1; k < 60; k++) { const b = mu + (Math.PI / 2 - mu) * k / 60, t = th(b); if (t > tmax) { tmax = t; bmax = b; } }
  if (d > tmax) return null;
  lo = mu; hi = bmax; for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (th(m) < d) lo = m; else hi = m; }
  best = 0.5 * (lo + hi);
  const Mn = M * Math.sin(best), p2p1 = 1 + 2 * g / (g + 1) * (Mn * Mn - 1);
  return (p2p1 - 1) / (0.5 * g * M * M);
}
function localInclinationCp(M, n, V, body) {
  const s = -(n[0] * V[0] + n[1] * V[1] + n[2] * V[2]); // sin δ（迎風為正）
  const d = Math.asin(Math.max(-1, Math.min(1, s))), cmax = cpStag(M);
  if (d >= 0) {
    if (body) { // 切錐：細長體線性理論（小角度），大角度改用修正 Newton
      const be = Math.sqrt(M * M - 1), dd = Math.max(d, 1e-4), newt = cmax * Math.sin(d) ** 2;
      const cone = dd * dd * (2 * Math.log(2 / (be * dd)) - 1);
      return d > 0.35 || !(cone > 0) ? newt : Math.max(0, Math.min(cone, Math.max(newt, cone)));
    }
    const c = obliqueCp(M, d); return c === null ? cmax * Math.sin(d) ** 2 : Math.min(c, cmax);
  }
  const nu = pmNu(M) + Math.min(-d, 1.2) * (body ? 0.55 : 1), M2 = pmInv(nu);
  const p = Math.pow((1 + 0.2 * M * M) / (1 + 0.2 * M2 * M2), 3.5);
  return Math.max(cpVac(M), (p - 1) / (0.7 * M * M));
}

/* ============================================================
 *  阻力分解（Raymer 組件累加法）
 *  回傳各項係數（以翼參考面積 S 為基準）
 * ============================================================ */
function dragBuildup(ac, areas, M, h, CL, cfg) {
  cfg = cfg || {};
  const at = isa(h), V = Math.max(1, M * at.a), rho = at.rho, mu = sutherland(at.T), S = ac.ref.S, aero = ac.T.aero;
  const kSurf = ac.T.internal ? 1.015e-5 : 0.634e-5;
  const Cf = (l, lam) => {
    let Re = rho * V * l / mu;
    const cut = M < 0.9 ? 38.21 * Math.pow(l / kSurf, 1.053) : 44.62 * Math.pow(l / kSurf, 1.053) * Math.pow(M, 1.16);
    Re = Math.max(1e4, Math.min(Re, cut));
    const turb = 0.455 / (Math.pow(Math.log10(Re), 2.58) * Math.pow(1 + 0.144 * M * M, 0.65)), lamC = 1.328 / Math.sqrt(Re);
    return { cf: lam * lamC + (1 - lam) * turb, Re };
  };
  const Mff = Math.min(M, 0.9);
  const liftFF = (Sx) => { const tc = 0.5 * (Sx.o.tcR + Sx.o.tcT), Lm = sweepAt(Sx, 0.35); return (1 + 0.6 / 0.35 * tc + 100 * tc ** 4) * (1.34 * Math.pow(Math.max(Mff, 0.05), 0.18) * Math.pow(Math.cos(Lm), 0.28)); };
  const Sw = areas.Sw, comps = [];
  const push = (key, name, cf, FF, Q, Swet, l) => { const cd = cf.cf * FF * Q * Swet / S; comps.push({ key, name, cd, cf: cf.cf, Re: cf.Re, FF, Q, Swet, l }); };
  push('wing', '機翼', Cf(ac.wing.mac, aero.lamWing), liftFF(ac.wing), ac.T.internal ? 1.0 : 1.05, Sw.wing || 0, ac.wing.mac);
  push('htail', '水平尾翼', Cf(ac.htail.mac, 0.05), liftFF(ac.htail), 1.04, Sw.htail || 0, ac.htail.mac);
  push('vtail', '垂直尾翼', Cf(ac.vtail.mac, 0.05), liftFF(ac.vtail), 1.04, Sw.vtail || 0, ac.vtail.mac);
  const f = ac.fus.L / (2 * ac.fus.R0);
  push('fus', '機身', Cf(ac.fus.L, aero.lamFus), 1 + 60 / f ** 3 + f / 400, 1.0, Sw.fus || 0, ac.fus.L);
  if (Sw.nac) { const e = ac.engines[0], ln = e.meridian ? e.meridian[e.meridian.length - 1][0] : 3, fn = ln / (2 * e.Rn); push('nac', '引擎短艙', Cf(ln, 0), 1 + 0.35 / fn, 1.3, Sw.nac, ln); }
  let CD0f = comps.reduce((s, q) => s + q.cd, 0);
  // 雜項：機尾上翹、起落架、襟翼、漏氣與突出物
  const misc = [];
  if (aero.upsweep) { const u = Math.atan(ac.fus.zc(ac.fus.L) / ac.fus.Lt); misc.push({ key: 'upsweep', name: '機尾上翹', cd: 3.83 * Math.pow(u, 2.5) * Math.PI * ac.fus.R0 ** 2 / S }); }
  if (cfg.gear) misc.push({ key: 'gear', name: '起落架', cd: aero.gearCD });
  if (cfg.flaps === 'to') misc.push({ key: 'flaps', name: '襟翼（起飛）', cd: ac.T.internal ? 0.006 : 0.012 });
  if (cfg.flaps === 'ld') misc.push({ key: 'flaps', name: '襟翼（降落）', cd: ac.T.internal ? 0.018 : 0.045 });
  const leak = aero.misc * CD0f; misc.push({ key: 'leak', name: '漏氣與突出物', cd: leak });
  const CD0 = CD0f + misc.reduce((s, q) => s + q.cd, 0);
  // 波阻
  const wv = waveDrag(ac, areas, M, CL);
  // 升力相關（誘導＋黏性升力阻力）
  const K = liftK(ac, M, cfg.eInv || 0.97, CD0);
  const CDi = K * CL * CL;
  return { comps, misc, CD0f, CD0, CDw: wv.CDw, Mdd: wv.Mdd, Mcr: wv.Mcr, K, CDi, CD: CD0 + wv.CDw + CDi + (cfg.CDtrim || 0), CDtrim: cfg.CDtrim || 0, V, q: 0.5 * rho * V * V, Re: comps[0].Re };
}
/* Korn 方程（跨音速）＋ Sears–Haack（超音速，Raymer 12.53），1.0–1.2 以三次 Hermite 平滑銜接 */
function waveDrag(ac, areas, M, CL) {
  const W = ac.wing, kA = ac.T.aero.kappaA, tc = 0.6 * W.o.tcR + 0.4 * W.o.tcT;
  const Lq = sweepAt(W, 0.25);
  const cL = Math.cos(Lq), Mdd = kA / cL - tc / (cL * cL) - Math.abs(CL) / (10 * cL ** 3), Mcr = Mdd - Math.pow(0.1 / 80, 1 / 3);
  const sub = m => m > Mcr ? 20 * (m - Mcr) ** 4 : 0;
  const LLE = W.sweepLE, Ewd = ac.T.aero.Ewd, SH = 9 * Math.PI / 2 * (areas.Amax / areas.lenA) ** 2; // Sears–Haack：D/q = (9π/2)(A_max/l)²（m²）
  const sup = m => Ewd * (1 - 0.386 * Math.pow(Math.max(0, m - 1.2), 0.57) * (1 - Math.PI * Math.pow(LLE, 0.77) / 100)) * SH / ac.ref.S;
  let CDw;
  const M1 = Math.min(0.98, Math.max(Mdd + 0.02, 0.9)), M2 = 1.2;
  if (M <= M1) CDw = sub(M);
  else if (M >= M2) CDw = sup(M);
  else { const y0 = sub(M1), d0 = (sub(M1 + 1e-3) - y0) / 1e-3 * (M2 - M1), y1 = sup(M2), d1 = (sup(M2 + 1e-3) - y1) / 1e-3 * (M2 - M1), t = (M - M1) / (M2 - M1); CDw = (2 * t ** 3 - 3 * t * t + 1) * y0 + (t ** 3 - 2 * t * t + t) * d0 + (-2 * t ** 3 + 3 * t * t) * y1 + (t ** 3 - t * t) * d1; CDw = Math.max(CDw, Math.min(y0, y1)); }
  return { CDw: Math.max(0, CDw), Mdd, Mcr };
}
/* 升力相關阻力因子 K：次音速 1/(πA e) + 0.38·CD0；超音速 Raymer 12.51；跨音速內插 */
function liftK(ac, M, eInv, CD0) {
  const A = ac.ref.A, Ksub = 1 / (Math.PI * A * eInv) + 0.38 * CD0;
  const Ksup = m => { const b2 = m * m - 1; return A * b2 * Math.cos(ac.wing.sweepLE * DEG) / Math.max(1e-3, 4 * A * Math.sqrt(b2) - 2); };
  if (M <= 0.95) return Ksub;
  if (M >= 1.2) return Math.max(Ksub, Ksup(M));
  const t = (M - 0.95) / 0.25; return (1 - t) * Ksub + t * Math.max(Ksub, Ksup(1.2));
}
/* 升力線斜率（每弧度）：DATCOM 次音速、超音速線性理論，跨音速內插；k 為面元法校正係數 */
function liftSlope(ac, M, k) {
  const W = ac.wing, A = ac.ref.A, d = 2 * ac.fus.R0, bb = ac.ref.b;
  const Lc2 = sweepAt(W, 0.5);
  const Sexp = ac.ref.S * (1 - d / bb * (1 + (1 - W.o.taper) * d / bb / 2)), F = Math.min(1.07 * (1 + d / bb) ** 2, 1.4);
  const sub = m => { const b2 = 1 - m * m; return 2 * Math.PI * A / (2 + Math.sqrt(4 + A * A * b2 / 0.9025 * (1 + Math.tan(Lc2) ** 2 / b2))) * Sexp / ac.ref.S * F; };
  const sup = m => { const be = Math.sqrt(m * m - 1); return 4 / be * (1 - 1 / (2 * A * be)) * Sexp / ac.ref.S * F; };
  let v;
  if (M <= 0.9) v = sub(M);
  else if (M >= 1.2) v = Math.min(sup(M), sub(0.9) * 1.1);
  else { const t = (M - 0.9) / 0.3; v = (1 - t) * sub(0.9) + t * Math.min(sup(1.2), sub(0.9) * 1.1); }
  return v * (k || 1);
}

if (typeof module !== 'undefined') module.exports = { sweepAt, PanelAero, localInclinationCp, dragBuildup, waveDrag, liftK, liftSlope, cpStag, cpVac, cpStar, sutherland, obliqueCp };
