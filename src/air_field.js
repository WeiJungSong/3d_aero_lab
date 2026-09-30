/* ============================================================
 *  air_field.js — 全機流場後處理
 *  - 場點速度：三組單位解（沿 x、沿 z、平尾偏轉）同時累加，之後任意 α、δ 以線性組合即時重組
 *  - 體內判定：機身、翼、尾翼、短艙與引擎內部（引擎以一維循環場模型分類）
 *  - 狀態量換算：由 Cp 或速度求 p、T、M、ρ、Tt、Pt（等熵、總焓守恆）
 * ============================================================ */
const AIRG = { g: 1.4, R: 287.05, cp: 1004.5 };

/* 自由流狀態 */
function fsState(h, M) {
  const at = isa(h), V = M * at.a, k = 1 + 0.2 * M * M;
  return { h, M, T: at.T, P: at.P, rho: at.rho, a: at.a, V, Tt: at.T * k, Pt: at.P * Math.pow(k, 3.5), q: 0.5 * at.rho * V * V, mu: sutherland(at.T) };
}
/* 由表面 Cp 求局部狀態（等熵，總壓取自由流總壓） */
function stateFromCp(fs, Cp, o) {
  o = o || {};
  const p = Math.max(0.02 * fs.P, fs.P * (1 + 0.7 * fs.M * fs.M * Cp));
  const Ml = Math.sqrt(Math.max(0, 5 * (Math.pow(Math.max(1, fs.Pt / p), 2 / 7) - 1)));
  const T = fs.Tt / (1 + 0.2 * Ml * Ml), a = Math.sqrt(AIRG.g * AIRG.R * T);
  o.Cp = Cp; o.P = p; o.M = Ml; o.T = T; o.V = Ml * a; o.rho = p / (AIRG.R * T); o.Tt = fs.Tt; o.Pt = fs.Pt;
  o.Taw = T * (1 + 0.89 * 0.2 * Ml * Ml); // 紊流恢復因數 r ≈ Pr^(1/3)
  return o;
}
/* 由速度向量（m/s）求狀態：總焓守恆（dTt 為噴流總溫增量）；Pfix 給定時以其為靜壓（噴流內） */
function stateFromVel(fs, Vx, Vy, Vz, o, dTt, Pfix) {
  o = o || {};
  const V = Math.hypot(Vx, Vy, Vz), Tt = fs.Tt + (dTt || 0);
  const T = Math.max(Tt - V * V / (2 * AIRG.cp), 0.25 * Tt);
  const p = Pfix || fs.Pt * Math.pow(T / Tt, 3.5);
  const a = Math.sqrt(AIRG.g * AIRG.R * T);
  o.V = V; o.T = T; o.P = p; o.M = V / a; o.rho = p / (AIRG.R * T); o.Tt = Tt; o.Pt = p * Math.pow(Tt / T, 3.5);
  o.Cp = fs.q > 1 ? (p - fs.P) / fs.q : 0; o.Taw = T * (1 + 0.89 * 0.2 * o.M * o.M);
  return o;
}
/* 引擎幾何分類器（只需幾何，不需工作點） */
function engineClassifier(spec) { const c = Object.create(FieldModel.prototype); c.spec = spec; c.bodies = spec.bodies.map(b => ({ ...b, bb: bbox(b.poly) })); return c; }

/* ---------- 三組單位解的場點擾動速度（伸長空間），out: 9 值 ---------- */
function fieldPert3(so, sols, Pt, out) {
  const P = so.Ps, W = so.Ws, vD = [0, 0, 0], vS = [0, 0, 0], Pm = [Pt[0], -Pt[1], Pt[2]];
  const m0 = sols[0].mu, s0 = sols[0].sig, m1 = sols[1].mu, s1 = sols[1].sig, m2 = sols[2].mu, s2 = sols[2].sig;
  let u0 = 0, v0 = 0, w0 = 0, u1 = 0, v1 = 0, w1 = 0, u2 = 0, v2 = 0, w2 = 0;
  for (let k = 0; k < P.length; k++) {
    const a0 = m0[k], b0 = s0[k], a1 = m1[k], b1 = s1[k], a2 = m2[k], b2 = s2[k];
    influenceVel(P[k], Pt, vD, vS);
    u0 += a0 * vD[0] + b0 * vS[0]; v0 += a0 * vD[1] + b0 * vS[1]; w0 += a0 * vD[2] + b0 * vS[2];
    u1 += a1 * vD[0] + b1 * vS[0]; v1 += a1 * vD[1] + b1 * vS[1]; w1 += a1 * vD[2] + b1 * vS[2];
    u2 += a2 * vD[0] + b2 * vS[0]; v2 += a2 * vD[1] + b2 * vS[1]; w2 += a2 * vD[2] + b2 * vS[2];
    influenceVel(P[k], Pm, vD, vS);
    u0 += a0 * vD[0] + b0 * vS[0]; v0 -= a0 * vD[1] + b0 * vS[1]; w0 += a0 * vD[2] + b0 * vS[2];
    u1 += a1 * vD[0] + b1 * vS[0]; v1 -= a1 * vD[1] + b1 * vS[1]; w1 += a1 * vD[2] + b1 * vS[2];
    u2 += a2 * vD[0] + b2 * vS[0]; v2 -= a2 * vD[1] + b2 * vS[1]; w2 += a2 * vD[2] + b2 * vS[2];
  }
  for (const wk of W) {
    const g0 = m0[wk.up] - m0[wk.lo], g1 = m1[wk.up] - m1[wk.lo], g2 = m2[wk.up] - m2[wk.lo];
    influenceVel(wk, Pt, vD, vS);
    u0 += g0 * vD[0]; v0 += g0 * vD[1]; w0 += g0 * vD[2]; u1 += g1 * vD[0]; v1 += g1 * vD[1]; w1 += g1 * vD[2]; u2 += g2 * vD[0]; v2 += g2 * vD[1]; w2 += g2 * vD[2];
    influenceVel(wk, Pm, vD, vS);
    u0 += g0 * vD[0]; v0 -= g0 * vD[1]; w0 += g0 * vD[2]; u1 += g1 * vD[0]; v1 -= g1 * vD[1]; w1 += g1 * vD[2]; u2 += g2 * vD[0]; v2 -= g2 * vD[1]; w2 += g2 * vD[2];
  }
  out[0] = u0; out[1] = v0; out[2] = w0; out[3] = u1; out[4] = v1; out[5] = w1; out[6] = u2; out[7] = v2; out[8] = w2;
  return out;
}

/* ---------- 單位解場點計算工作（分時） ----------
 *  pts: Float64Array(3n) 物理座標；skip: Uint8Array(n)（非 0 略過）
 *  結果 res: Float32Array(9n)（伸長空間擾動，尚未換算 Göthert） */
function PertJob(pa, pts, skip) {
  this.pa = pa; this.pts = pts; this.skip = skip; this.n = pts.length / 3;
  this.res = new Float32Array(9 * this.n); this.i = 0; this.done = this.n === 0;
}
PertJob.prototype.step = function (budget) {
  const so = this.pa.solver, sols = [this.pa.sX, this.pa.sZ, this.pa.sD], b = this.pa.beta, o = new Float64Array(9), P = [0, 0, 0];
  const t0 = performance.now();
  while (this.i < this.n) {
    const i = this.i++;
    if (!this.skip || !this.skip[i]) {
      P[0] = this.pts[3 * i] / b; P[1] = this.pts[3 * i + 1]; P[2] = this.pts[3 * i + 2];
      fieldPert3(so, sols, P, o);
      for (let q = 0; q < 9; q++) this.res[9 * i + q] = o[q];
    }
    if ((i & 7) === 7 && performance.now() - t0 > budget) break;
  }
  this.done = this.i >= this.n;
  return this.i / this.n;
};
/* 組合：回傳物理空間速度（以 V∞ 正規化）；cmb = { ca, sa, d, cA, sA, b2, b1 } */
function combCoef(pa, alphaDeg, deltaDeg) {
  const a = alphaDeg * DEG, b = pa.beta, ap = Math.atan(b * Math.tan(a));
  return { ca: Math.cos(ap), sa: Math.sin(ap), d: (deltaDeg || 0) * DEG, cA: Math.cos(a), sA: Math.sin(a), ib2: 1 / (b * b), ib: 1 / b };
}
function combVel(res, i, c, out) {
  const r = 9 * i;
  out[0] = c.cA + (c.ca * res[r] + c.sa * res[r + 3] + c.d * res[r + 6]) * c.ib2;
  out[1] = (c.ca * res[r + 1] + c.sa * res[r + 4] + c.d * res[r + 7]) * c.ib;
  out[2] = c.sA + (c.ca * res[r + 2] + c.sa * res[r + 5] + c.d * res[r + 8]) * c.ib;
  return out;
}

/* ============================================================
 *  體內判定
 *  code：0 自由流、1 機體實體、2 引擎實體、3 引擎內部流道（fm 取樣）
 * ============================================================ */
function AirGeom(ac) {
  this.ac = ac;
  const fus = ac.fus;
  const sAof = S => { const sAtt = fus.R((S.xLE(fus.R0) * 2 + S.chord(fus.R0)) / 2) * 0.98; return Math.min(sAtt, S.semi * 0.5); };
  this.sW = sAof(ac.wing); this.sH = sAof(ac.htail);
  const bb = S => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let k = 0; k <= 10; k++) { const s = S.semi * k / 10; for (const xc of [0, 1]) for (const sd of [-1, 1]) { const q = S.pt(s, xc, sd, 0); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[2]); z1 = Math.max(z1, q[2]); } } return [x0, x1, z0 - 0.2 * S.cr, z1 + 0.2 * S.cr]; };
  this.bW = bb(ac.wing); this.bH = bb(ac.htail);
  this.cls = engineClassifier(ac.spec);
  this.e = ac.engines;
  this.sp = ac.spec;
}
AirGeom.prototype.inLift = function (S, sA, bx, x, ay, z) {
  if (x < bx[0] || x > bx[1] || z < bx[2] || z > bx[3] || ay > S.semi) return false;
  const c = S.chord(ay), xl = S.xLE(ay), xc = (x - xl) / c;
  if (xc < 0 || xc > 1) return false;
  const th = nacaT(S.tc(ay), xc) * c * (ay >= S.semi - 1e-6 ? 0 : 1);
  const cam = nacaC(S.o.camber || 0, xc) * c, shear = -(xc - 0.25) * c * Math.tan((S.o.inc || 0) * DEG);
  const zm = S.o.z0 + (ay - sA) * Math.tan((S.o.dih || 0) * DEG) + cam + shear;
  return z >= zm - th && z <= zm + th;
};
AirGeom.prototype.inVt = function (x, ay, z) {
  const V = this.ac.vtail, s = z - V.o.z0;
  if (s < -0.5 || s > V.semi) return false;
  const ss = Math.max(0, s), c = V.chord(ss), xl = V.xLE(ss), xc = (x - xl) / c;
  if (xc < 0 || xc > 1) return false;
  return ay <= nacaT(V.tc(ss), xc) * c;
};
AirGeom.prototype.inFus = function (x, ay, z) {
  const f = this.ac.fus; if (x < 0 || x > f.L) return false;
  const R = f.R(x), dz = z - f.zc(x); return ay * ay + dz * dz <= R * R;
};
/* 引擎：code 2 實體、3 流道（out.cl 為流道資訊、xe/r 為引擎座標） */
AirGeom.prototype.engineAt = function (x, ay, z, out) {
  out.code = 0; out.eng = null;
  const sp = this.sp, Rm = sp.view.Rmax * 1.1;
  for (const e of this.e) {
    const xe = x - e.x0; if (xe < -0.02 || xe > sp.exitsGeom[sp.exitsGeom.length - 1].x + 0.8 * sp.s) continue;
    const r = Math.hypot(ay - e.y, z - e.z); if (r > Rm) continue;
    const cl = this.cls.classify(xe, r);
    if (cl.kind === 'ext') continue;
    out.xe = xe; out.r = r; out.eng = e; out.th = Math.atan2(z - e.z, ay - e.y);
    if (cl.kind === 'stream') { out.code = 3; out.cl = cl; return out; }
    out.code = 2; out.mat = cl.mat; return out;
  }
  return out;
};
AirGeom.prototype.code = function (x, y, z, eo) {
  const ay = Math.abs(y), ac = this.ac;
  eo = eo || {};
  const en = this.engineAt(x, ay, z, eo);
  if (en.code) return en.code;
  if (this.inFus(x, ay, z)) return 1;
  if (ay >= this.sW * 0.9 && this.inLift(ac.wing, this.sW, this.bW, x, ay, z)) return 1;
  if (ay >= this.sH * 0.9 && this.inLift(ac.htail, this.sH, this.bH, x, ay, z)) return 1;
  if (this.inVt(x, ay, z)) return 1;
  return 0;
};
/* 噴流疊加（fm：目前工作點的引擎場模型）：o.dU（m/s，沿機體 x）、o.dTt、o.P（噴流靜壓） */
AirGeom.prototype.jetAt = function (fm, x, y, z, o) {
  o.dU = 0; o.dTt = 0; o.zone = null; o.P = 0;
  if (!fm) return o;
  const ay = Math.abs(y), sp = this.sp, xE = sp.exitsGeom[0].x, tmp = this._t || (this._t = {});
  for (const e of this.e) {
    const xe = x - e.x0; if (xe < xE - 0.02) continue;
    const r = Math.hypot(ay - e.y, z - e.z);
    if (r > sp.view.Rmax * 1.3 + 0.2 * (xe - xE)) continue;
    fm.sampleExt(xe, r, 0, tmp);
    if (tmp.zone === 'jet' || tmp.zone === 'shock') { o.dU = tmp.Vx - fm.fl.V0; o.dTt = tmp.Tt - fm.fl.Tt0; o.zone = tmp.zone; o.P = tmp.P; return o; }
  }
  return o;
};

/* ============================================================
 *  顯示網格 → 求解面元映射（同組件、法向一致、反距離加權）
 * ============================================================ */
function surfaceMap(dispSet, solSet) {
  const byComp = {};
  for (let k = 0; k < solSet.P.length; k++) { const p = solSet.P[k]; (byComp[p.comp] = byComp[p.comp] || []).push(k); }
  const n = dispSet.P.length, idx = new Int32Array(4 * n).fill(-1), w = new Float32Array(4 * n);
  for (let q = 0; q < n; q++) {
    const d = dispSet.P[q], list = byComp[d.comp] || [];
    const best = [[-1, Infinity], [-1, Infinity], [-1, Infinity], [-1, Infinity]];
    for (const k of list) {
      const p = solSet.P[k];
      if (p.vn !== 0 && d.vn === 0) continue;
      const dn = p.n[0] * d.n[0] + p.n[1] * d.n[1] + p.n[2] * d.n[2]; if (dn < 0.35) continue;
      const dx = p.cen[0] - d.cen[0], dy = p.cen[1] - d.cen[1], dz = p.cen[2] - d.cen[2], r2 = dx * dx + dy * dy + dz * dz;
      if (r2 < best[3][1]) { best[3] = [k, r2]; best.sort((a, b) => a[1] - b[1]); }
    }
    let ws = 0;
    for (let m = 0; m < 4; m++) { if (best[m][0] < 0) continue; const ww = 1 / (best[m][1] + 1e-6 * (best[0][1] + 1e-4)); idx[4 * q + m] = best[m][0]; w[4 * q + m] = ww; ws += ww; if (m === 0 && best[0][1] < 1e-10) break; }
    if (ws > 0) for (let m = 0; m < 4; m++) w[4 * q + m] /= ws;
  }
  return { idx, w };
}

if (typeof module !== 'undefined') module.exports = { fsState, stateFromCp, stateFromVel, engineClassifier, fieldPert3, PertJob, combCoef, combVel, AirGeom, surfaceMap };
