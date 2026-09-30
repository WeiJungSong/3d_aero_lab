/* ============================================================
 *  perf.js — 裝機推力（一維循環）、點性能、飛行包線、任務剖面時序模擬
 * ============================================================ */
const G0 = 9.80665;

/* ---------- 引擎資料：直接呼叫 runCycle，轉速上限以 regula falsi 求解並快取 ---------- */
function EngineDeck(type, design, eff, opt) {
  this.type = type; this.design = design; this.eff = eff; this.opt = Object.assign({ Tt7: 2000, nozzleType: ENGINE_TYPES[type].nozzle }, opt || {});
  const pRef = this.p(0, 0, 1, false);
  this.ref = runCycle(pRef, null, flightState(0, 0), design.Tt4max);
  this.lim = new Map(); this.cache = new Map();
}
EngineDeck.prototype.p = function (h, M, thr, ab) { return { type: this.type, design: this.design, eff: this.eff, alt: h, M0: M, thr, ab: !!ab, Tt7: this.opt.Tt7, nozzleType: this.opt.nozzleType }; };
EngineDeck.prototype.nrat = function (o) { let m = 0; for (const k in o.spool) m = Math.max(m, o.spool[k] / this.ref.spool[k]); return m; };
/* 轉速上限對應的最大 Tt4（每 (h, M) 格點快取） */
EngineDeck.prototype.tt4Limit = function (h, M) {
  const key = Math.round(h / 250) + '_' + Math.round(M * 100);
  if (this.lim.has(key)) return this.lim.get(key);
  const hq = Math.round(h / 250) * 250, Mq = Math.round(M * 100) / 100, fl = flightState(hq, Mq), p = this.p(hq, Mq, 1, false), T4 = this.design.Tt4max;
  let hi = T4, oh = runCycle(p, this.ref, fl, hi), res = T4;
  if (this.nrat(oh) > 1.05) {
    let lo = 0.45 * T4, ol = runCycle(p, this.ref, fl, lo), flo = this.nrat(ol) - 1.05, fhi = this.nrat(oh) - 1.05;
    for (let i = 0; i < 12 && hi - lo > 1; i++) {
      const m = flo < 0 && fhi > 0 ? hi - fhi * (hi - lo) / (fhi - flo) : 0.5 * (lo + hi), fm = this.nrat(runCycle(p, this.ref, fl, m)) - 1.05;
      if (fm > 0) { hi = m; fhi = fm; } else { lo = m; flo = fm; }
    }
    res = lo;
  }
  this.lim.set(key, res);
  return res;
};
/* 引擎工作點：thr = Tt4 / Tt4,max（受轉速上限限制） */
EngineDeck.prototype.at = function (h, M, thr, ab) {
  h = Math.max(0, Math.min(20000, h)); M = Math.max(0, M);
  const key = Math.round(h / 10) + '_' + Math.round(M * 1000) + '_' + Math.round(thr * 1000) + (ab ? 'a' : '');
  if (this.cache.has(key)) return this.cache.get(key);
  const Tl = this.tt4Limit(h, M), Tt4 = Math.min(thr * this.design.Tt4max, Tl);
  const op = runCycle(this.p(h, M, thr, ab), this.ref, flightState(h, M), Tt4);
  const r = { F: op.F, mfuel: op.mfuel, op, Tt4, limited: Tt4 < thr * this.design.Tt4max - 0.5, N: {} };
  for (const k in op.spool) r.N[k] = op.spool[k] / this.ref.spool[k];
  if (this.cache.size > 20000) this.cache.clear();
  this.cache.set(key, r);
  return r;
};

/* ============================================================
 *  性能上下文：機型、面積、面元校正、引擎、構型
 * ============================================================ */
function PerfCtx(ac, areas, deck, aeroCal) {
  this.ac = ac; this.areas = areas; this.deck = deck;
  this.cal = Object.assign({ kA: 1, CL0: 0, eInv: 0.97, trimK: 0 }, aeroCal || {});
  this.nEng = ac.T.nEng; this.inst = ac.T.aero.inst;
}
PerfCtx.prototype.CLmax = function (flaps) { const a = this.ac.T.aero; return a.clmax + (flaps === 'to' ? a.dClTO : flaps === 'ld' ? a.dClLD : 0); };
/* 推力（全機、裝機損失後）與燃油流量 */
PerfCtx.prototype.thrust = function (h, M, thr, ab) {
  const e = this.deck.at(h, M, thr, ab);
  return { T: this.nEng * e.F * (1 - this.inst), ff: this.nEng * e.op.mfuel, e };
};
/* 點性能：thr 為數值或 'level'（推力 = 阻力），n 為負載因數 */
PerfCtx.prototype.point = function (h, M, W, o) {
  o = o || {};
  const ac = this.ac, S = ac.ref.S, at = isa(h), V = Math.max(1, M * at.a), q = 0.5 * at.rho * V * V, n = o.n || 1;
  const CL = n * W * G0 / (q * S);
  const CDtrim = this.cal.trimK * CL * CL;
  const d = dragBuildup(ac, this.areas, M, h, CL, { eInv: this.cal.eInv, flaps: o.flaps, gear: o.gear, CDtrim });
  const D = q * S * d.CD;
  let thr = o.thr, th;
  const ab = !!o.ab;
  if (thr === 'level') {
    const tMax = this.thrust(h, M, 1, ab);
    if (tMax.T <= D) { thr = 1; th = tMax; }
    else {
      let lo = 0.35, hi = 1, tlo = this.thrust(h, M, lo, ab);
      if (tlo.T >= D) { thr = lo; th = tlo; }
      else {
        let thi = tMax;
        for (let i = 0; i < 16 && hi - lo > 2e-4; i++) {
          const m = lo + (hi - lo) * (D - tlo.T) / Math.max(1, thi.T - tlo.T), mm = Math.min(hi - 1e-4, Math.max(lo + 1e-4, i % 3 === 2 ? 0.5 * (lo + hi) : m)), tm = this.thrust(h, M, mm, ab);
          if (tm.T >= D) { hi = mm; thi = tm; } else { lo = mm; tlo = tm; }
          if (Math.abs(tm.T - D) < 2e-3 * D) break;
        }
        // 括號內線性內插：T = D
        const w = Math.max(0, Math.min(1, (D - tlo.T) / Math.max(1e-6, thi.T - tlo.T)));
        thr = lo + w * (hi - lo); th = { T: D, ff: tlo.ff + w * (thi.ff - tlo.ff), e: thi.e };
      }
    }
  } else th = this.thrust(h, M, thr === undefined ? 1 : thr, ab);
  const T = th.T, Ps = V * (T - D) / (W * G0);
  const CLmax = this.CLmax(o.flaps), Vs = Math.sqrt(2 * W * G0 / (at.rho * S * CLmax));
  const cas = casFromTas(V, h);
  return { h, M, V, cas, q, W, n, CL, CD: d.CD, LD: CL / d.CD, D, T, thr, ab, ff: th.ff, sfc: th.ff / Math.max(T, 1), Ps, SR: V / Math.max(th.ff, 1e-6), Vs, CLmax, stall: CL > CLmax, drag: d, eng: th.e, at };
};
/* 校正空速 */
function casFromTas(V, h) { const at = isa(h), M = V / at.a, qc = at.P * (Math.pow(1 + 0.2 * M * M, 3.5) - 1); return 340.294 * Math.sqrt(5 * (Math.pow(qc / 101325 + 1, 2 / 7) - 1)); }
function tasFromCas(cas, h) { const at = isa(h), qc = 101325 * (Math.pow(1 + 0.2 * (cas / 340.294) ** 2, 3.5) - 1), M = Math.sqrt(5 * (Math.pow(qc / at.P + 1, 2 / 7) - 1)); return M * at.a; }

/* ============================================================
 *  飛行包線：h × M 網格的 Ps（最大推力），Ps = 0 與失速邊界；分時計算
 * ============================================================ */
PerfCtx.prototype.envelope = function (W, ab, nh, nm, onChunk) {
  const lim = this.ac.T.limits, Mmax = Math.min(lim.Mmo * 1.12, ab || this.ac.T.internal ? 2.4 : 1.0), hmax = Math.min(20000, lim.hmax * 1.35);
  nh = nh || 26; nm = nm || 36;
  const hs = [], Ms = [], Ps = [], stall = [];
  for (let i = 0; i < nh; i++) hs.push(hmax * i / (nh - 1));
  for (let j = 0; j < nm; j++) Ms.push(0.1 + (Mmax - 0.1) * j / (nm - 1));
  let i = 0;
  const self = this;
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  return new Promise(resolve => {
    const step = () => {
      const t0 = now();
      while (i < nh && now() - t0 < 30) {
        const row = [], srow = [];
        for (const M of Ms) { const r = self.point(hs[i], M, W, { thr: 1, ab }); row.push(r.Ps); srow.push(r.CL / r.CLmax); }
        Ps.push(row); stall.push(srow); i++;
      }
      if (onChunk) onChunk(i / nh);
      if (i < nh) (typeof setTimeout !== 'undefined' ? setTimeout(step, 0) : step()); else resolve({ hs, Ms, Ps, stall, W, ab });
    };
    step();
  });
};
/* 最大平飛速度與失速速度（給定高度） */
PerfCtx.prototype.speeds = function (h, W, ab) {
  const lim = this.ac.T.limits, Mtop = ab || this.ac.T.internal ? 2.4 : 1.0;
  let Mmax = null, Mmin = null, prev = null;
  for (let M = 0.1; M <= Mtop + 1e-9; M += 0.01) {
    const r = this.point(h, M, W, { thr: 1, ab });
    const ok = r.Ps > 0 && !r.stall;
    if (ok && Mmin === null) Mmin = M;
    if (ok) Mmax = M;
    prev = r;
  }
  return { Mmax, Mmin };
};

/* ============================================================
 *  起降距離（地面滾行積分）
 * ============================================================ */
PerfCtx.prototype.takeoff = function (W, h, ab) {
  const ac = this.ac, S = ac.ref.S, at = isa(h || 0), CLmax = this.CLmax('to'), Vs = Math.sqrt(2 * W * G0 / (at.rho * S * CLmax)), Vlof = 1.1 * Vs, mu = 0.02, CLg = 0.45 * CLmax;
  let V = 0, s = 0, t = 0, fuel = 0; const dt = 0.25;
  while (V < Vlof && t < 200) {
    const M = V / at.a, th = this.thrust(h || 0, M, 1, ab), q = 0.5 * at.rho * V * V;
    const d = dragBuildup(ac, this.areas, Math.max(M, 0.05), h || 0, CLg, { eInv: this.cal.eInv, flaps: 'to', gear: true });
    const acc = (th.T - q * S * d.CD - mu * (W * G0 - q * S * CLg)) / W;
    V += acc * dt; s += V * dt; t += dt; fuel += th.ff * dt;
  }
  const sAir = Vlof * 3 + (10.7 / Math.tan(Math.max(0.05, Math.min(0.2, 0.07)))) ; // 旋轉 3 秒 + 爬至 35 ft（約 4° 爬升角）
  return { sGround: s, sTotal: s + sAir, Vlof, Vs, t, fuel };
};
PerfCtx.prototype.landing = function (W, h) {
  const ac = this.ac, S = ac.ref.S, at = isa(h || 0), CLmax = this.CLmax('ld'), Vs = Math.sqrt(2 * W * G0 / (at.rho * S * CLmax)), Vapp = 1.3 * Vs, Vtd = 1.15 * Vs, mu = 0.4;
  let V = Vtd, s = 0; const dt = 0.25;
  while (V > 1) { const q = 0.5 * at.rho * V * V, d = dragBuildup(ac, this.areas, V / at.a + 0.02, h || 0, 0.1, { eInv: this.cal.eInv, flaps: 'ld', gear: true }); const th = this.thrust(h || 0, V / at.a, 0.4, false); const acc = -(q * S * d.CD + mu * (W * G0) - 0.0 * th.T) / W; V += acc * dt; s += V * dt; }
  const sAir = 15.2 / Math.tan(3 * Math.PI / 180) * 0.5 + Vapp * 3; // 由 50 ft、3° 下滑之拉平距離（近似）
  return { sGround: s, sTotal: s + sAir, Vapp, Vs };
};

/* ============================================================
 *  任務剖面：起飛 → 爬升 → 巡航（→ 衝刺 → 巡航）→ 下降 → 降落
 *  回傳時序（每步）與各階段彙總
 * ============================================================ */
PerfCtx.prototype.mission = function (m, W0) {
  const ac = this.ac, out = [], phases = [];
  let t = 0, x = 0, h = 0, W = W0, fuel = Math.min(ac.mass.fuel, W0 - ac.mass.OEW - ac.mass.payload);
  const fuel0 = fuel, reserve = m.reserveFrac * ac.mass.fuelMax;
  let aborted = null;
  const rec = (ph, r, extra) => out.push(Object.assign({ t, x, h, W, fuel, ph, M: r ? r.M : 0, V: r ? r.V : 0, cas: r ? r.cas : 0, T: r ? r.T : 0, D: r ? r.D : 0, thr: r ? r.thr : 0, ff: r ? r.ff : 0, CL: r ? r.CL : 0, LD: r ? r.LD : 0, Ps: r ? r.Ps : 0, SAT: isa(h).T, TAT: isa(h).T * (1 + 0.2 * (r ? r.M * r.M : 0)), Tt4: r && r.eng ? r.eng.Tt4 : 0, EGT: r && r.eng ? (r.eng.op.Tt5 || 0) : 0, q: r ? r.q : 0 }, extra || {}));
  const phase = (name, fn) => { const s = { name, t0: t, x0: x, f0: fuel, h0: h }; fn(); s.t1 = t; s.x1 = x; s.f1 = fuel; s.h1 = h; s.dt = t - s.t0; s.dx = x - s.x0; s.df = s.f0 - fuel; phases.push(s); };
  const burn = (ff, dt) => { const f = ff * dt; fuel -= f; W -= f; if (fuel < reserve && !aborted) aborted = '燃油低於備份油量'; };
  // 起飛
  phase('起飛', () => {
    const to = this.takeoff(W, 0, m.ab && ac.T.internal);
    t += to.t; x += to.sTotal; burn(to.fuel / Math.max(to.t, 1e-6), to.t); h = 10.7;
    const r = this.point(h, to.Vlof / isa(0).a, W, { thr: 1, flaps: 'to', gear: true, ab: m.ab && ac.T.internal }); rec('起飛', r, { sTO: to.sTotal });
  });
  // 爬升（CAS 排程 → 定馬赫）
  const climbTo = (hTarget, Mt, cas, thr, ab, name) => phase(name, () => {
    let guard = 0;
    while (h < hTarget - 1 && guard++ < 4000 && !aborted) {
      const V1 = Math.min(tasFromCas(cas, h), Mt * isa(h).a), M = V1 / isa(h).a;
      const r = this.point(h, M, W, { thr, ab });
      if (r.Ps <= 0.2) { aborted = aborted || `無法爬升至 ${Math.round(hTarget)} m（升限約 ${Math.round(h)} m）`; break; }
      const dh = 150, V2 = Math.min(tasFromCas(cas, h + dh), Mt * isa(h + dh).a), dVdh = (V2 - V1) / dh;
      const hdot = r.Ps / (1 + V1 * dVdh / G0);
      const dt = Math.min(20, Math.max(2, (hTarget - h) / Math.max(hdot, 0.1)));
      h = Math.min(hTarget, h + hdot * dt); x += Math.sqrt(Math.max(0, V1 * V1 - hdot * hdot)) * dt; t += dt; burn(r.ff, dt);
      rec(name, r, { ROC: hdot });
    }
  });
  climbTo(m.cruiseH, m.cruiseM, m.climbCAS, 1, false, '爬升');
  // 巡航 / 衝刺
  const cruise = (dist, Mc, hc, ab, name) => phase(name, () => {
    const x1 = x + dist; let guard = 0;
    while (x < x1 - 1 && guard++ < 5000 && !aborted) {
      const r = this.point(hc, Mc, W, { thr: 'level', ab });
      const dt = Math.min(ab ? 10 : 60, (x1 - x) / r.V);
      if (r.T < r.D * 0.995) { aborted = aborted || `${name}：推力不足以維持 M${Mc.toFixed(2)}`; }
      x += r.V * dt; t += dt; burn(r.ff, dt); rec(name, r);
    }
  });
  const descentDist = m.cruiseH * 18, R = m.range * 1000, Dd = m.dash * 1000; // km → m；下降約 3°
  if (m.dash > 0) {
    const leg = Math.max(0, R / 2 - Dd / 2 - x);
    cruise(leg, m.cruiseM, m.cruiseH, false, '巡航（去程）');
    cruise(Dd, m.dashM, m.cruiseH, true, '超音速衝刺');
    cruise(Math.max(0, R - x - descentDist), m.cruiseM, m.cruiseH, false, '巡航（回程）');
  } else cruise(Math.max(0, R - x - descentDist), m.cruiseM, m.cruiseH, false, '巡航');
  // 下降（慢車推力，Mach → CAS 排程）
  phase('下降', () => {
    let guard = 0;
    while (h > 460 && guard++ < 4000) {
      const V1 = Math.min(tasFromCas(m.climbCAS, h), m.cruiseM * isa(h).a), M = V1 / isa(h).a;
      const r = this.point(h, M, W, { thr: 0.42 });
      let hdot = Math.min(-2, r.Ps); hdot = Math.max(hdot, -18);
      const dt = Math.min(20, Math.max(2, (h - 450) / Math.max(-hdot, 0.5)));
      h = Math.max(450, h + hdot * dt); x += V1 * dt; t += dt; burn(r.ff, dt); rec('下降', r, { ROC: hdot });
    }
  });
  phase('降落', () => { const ld = this.landing(W, 0); x += ld.sTotal; t += 90; h = 0; const r = this.point(0, ld.Vapp / isa(0).a, W, { thr: 0.5, flaps: 'ld', gear: true }); burn(r.ff, 90); rec('降落', r, { sLD: ld.sTotal }); });
  return { out, phases, fuelUsed: fuel0 - fuel, W1: W, aborted, reserve, fuel0 };
};

if (typeof module !== 'undefined') module.exports = { EngineDeck, PerfCtx, casFromTas, tasFromCas, G0 };
