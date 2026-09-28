/* ============================================================
 *  physics.js — 大氣、氣體性質與逐站熱力循環（設計點 + 非設計點）
 *  參考方法：Mattingly《Elements of Propulsion》參數循環與
 *  非設計點分析（渦輪導向葉片喉部壅塞 → 渦輪 τt、πt 固定）。
 * ============================================================ */
const GAS = {
  cold: { g: 1.4, cp: 1004.5, name: '空氣' },
  hot: { g: 1.33, cp: 1156.9, name: '燃氣' },
  ab: { g: 1.30, cp: 1243.0, name: '後燃燃氣' },
};
function Rg(gas) { return gas.cp * (gas.g - 1) / gas.g; }
function mixGas(m1, g1, m2, g2) {
  const cp = (m1 * g1.cp + m2 * g2.cp) / (m1 + m2);
  const R = (m1 * Rg(g1) + m2 * Rg(g2)) / (m1 + m2);
  return { g: cp / (cp - R), cp, name: '混合氣' };
}

/* ---------- ISA 標準大氣 (0–20 km) ---------- */
function isa(h) {
  h = Math.max(0, Math.min(20000, h));
  let T, P;
  if (h <= 11000) { T = 288.15 - 0.0065 * h; P = 101325 * Math.pow(T / 288.15, 5.25588); }
  else { T = 216.65; P = 22632.06 * Math.exp(-(h - 11000) / 6341.62); }
  const R = 287.05, g = 1.4;
  return { T, P, rho: P / (R * T), a: Math.sqrt(g * R * T) };
}

/* ---------- 可壓縮流關係式 ---------- */
function mfp(M, g, R) { // 質量流參數 ṁ√Tt/(Pt·A)
  return M * Math.sqrt(g / R) * Math.pow(1 + 0.5 * (g - 1) * M * M, -(g + 1) / (2 * (g - 1)));
}
function invMfp(val, g, R, supersonic) {
  const vmax = mfp(1, g, R);
  if (!(val > 0)) return 0;
  if (val >= vmax) return 1;
  let lo = supersonic ? 1 : 0, hi = supersonic ? 6 : 1;
  for (let i = 0; i < 48; i++) {
    const mid = 0.5 * (lo + hi), v = mfp(mid, g, R);
    if (supersonic ? v > val : v < val) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
function areaRatio(M, g) { // A/A*
  return (1 / M) * Math.pow((2 / (g + 1)) * (1 + 0.5 * (g - 1) * M * M), (g + 1) / (2 * (g - 1)));
}
function machFromNPR(npr, g) { return npr <= 1 ? 0 : Math.sqrt(2 / (g - 1) * (Math.pow(npr, (g - 1) / g) - 1)); }
function critNPR(g) { return Math.pow((g + 1) / 2, g / (g - 1)); }
function staticFromTotal(Tt, Pt, M, gas) {
  const g = gas.g, R = Rg(gas);
  const k = 1 + 0.5 * (g - 1) * M * M;
  const T = Tt / k, P = Pt / Math.pow(k, g / (g - 1));
  const a = Math.sqrt(g * R * T);
  return { T, P, a, V: M * a, rho: P / (R * T) };
}

/* 壓縮機／渦輪：多變效率 e 與溫度比 τ、壓力比 π 的換算 */
const compPi = (tau, gas, e) => Math.pow(tau, gas.g * e / (gas.g - 1));
const compTau = (pi, gas, e) => Math.pow(pi, (gas.g - 1) / (gas.g * e));
const turbPi = (tau, gas, e) => Math.pow(tau, gas.g / ((gas.g - 1) * e));
const turbTau = (pi, gas, e) => Math.pow(pi, (gas.g - 1) * e / gas.g);

/* ---------- 噴嘴 ---------- */
function nozzle(mdot, Tt, Pt, P0, gas, type, arMax) {
  const g = gas.g, R = Rg(gas);
  const npr = Pt / P0, crit = critNPR(g);
  const choked = npr >= crit;
  let M, P, arLimited = false;
  if (npr <= 1.0005) { M = 0.03; P = P0; }
  else if (!choked) { M = machFromNPR(npr, g); P = P0; }
  else if (type === 'conv') { M = 1; P = Pt / crit; }
  else {
    M = machFromNPR(npr, g); P = P0;
    if (arMax && areaRatio(M, g) > arMax) { // 出口面積達機械上限 → 欠膨脹
      let lo = 1, hi = M;
      for (let i = 0; i < 40; i++) { const m = 0.5 * (lo + hi); if (areaRatio(m, g) < arMax) lo = m; else hi = m; }
      M = lo; P = Pt / Math.pow(1 + 0.5 * (g - 1) * M * M, g / (g - 1)); arLimited = true;
    }
  }
  const s = staticFromTotal(Tt, Pt, M, gas);
  const A = mdot / (s.rho * s.V);
  const Athroat = choked ? mdot * Math.sqrt(Tt) / (Pt * mfp(1, g, R)) : A;
  return { M, P, T: s.T, V: s.V, rho: s.rho, A, Athroat, choked, npr, crit, Tt, Pt, gas, mdot, type, arLimited };
}

/* ---------- 預設參數 ---------- */
const ENGINE_TYPES = {
  hbtf: {
    label: '高涵道渦扇', en: 'High-bypass turbofan', short: 'HBTF',
    design: { mdot: 350, opr: 32, fpr: 1.6, bpr: 5.5, pibst: 1.8, Tt4max: 1650 },
    Mmax: 0.95, hmax: 13500, hasAB: false, nozzle: 'conv',
    rpm: { LP: 5200, HP: 14500 },
  },
  tj: {
    label: '渦輪噴射', en: 'Turbojet', short: 'TJ',
    design: { mdot: 77, opr: 13.5, Tt4max: 1280 },
    Mmax: 2.2, hmax: 18000, hasAB: true, nozzle: 'cd', arMax: 1.9,
    rpm: { HP: 7460 },
  },
  lbtf: {
    label: '低涵道後燃渦扇', en: 'Low-bypass afterburning turbofan', short: 'LBTF',
    design: { mdot: 110, opr: 26, fpr: 3.8, Tt4max: 1680 },
    Mmax: 2.2, hmax: 18000, hasAB: true, nozzle: 'cd', arMax: 1.8,
    rpm: { LP: 10400, HP: 13450 },
  },
};
const DEFAULT_EFF = {
  ef: 0.89, ec: 0.90, et: 0.90, etab: 0.99, etb: 0.99, pib: 0.96, pidmax: 0.99,
  pin: 0.99, pifn: 0.99, etam: 0.99, LHV: 43.0e6, pifd: 0.98, piM: 0.98,
  piabOn: 0.95, piabOff: 0.98, etaAB: 0.95,
};

/* ---------- 飛行條件 ---------- */
function flightState(alt, M0) {
  const a = isa(alt);
  const gas = GAS.cold, g = gas.g;
  const k = 1 + 0.5 * (g - 1) * M0 * M0;
  const Tt0 = a.T * k, Pt0 = a.P * Math.pow(k, g / (g - 1));
  const etaR = M0 <= 1 ? 1 : 1 - 0.075 * Math.pow(M0 - 1, 1.35); // MIL-E-5007D 進氣衝壓恢復
  return { alt, M0, T0: a.T, P0: a.P, rho0: a.rho, a0: a.a, V0: M0 * a.a, Tt0, Pt0, etaR };
}

/* ============================================================
 *  主循環計算
 *  p = { type, design:{...}, eff:{...}, alt, M0, thr, ab, Tt7, nozzleType }
 *  ref = 設計點結果（null 代表計算設計點本身）
 * ============================================================ */
function runCycle(p, ref, fl, Tt4) {
  const e = p.eff, d = p.design, C = GAS.cold, H = GAS.hot;
  const cpc = C.cp, cpt = H.cp;
  const warn = [];
  const Tt2 = fl.Tt0;
  const pid = e.pidmax * fl.etaR;
  const Pt2 = fl.Pt0 * pid;
  const fuelAir = (Tt3) => (cpt * Tt4 - cpc * Tt3) / (e.etb * e.LHV - cpt * Tt4);
  const S = {}; // 站點
  S['0'] = { Tt: fl.Tt0, Pt: fl.Pt0, gas: C };
  S['2'] = { Tt: Tt2, Pt: Pt2, gas: C };
  let r = { type: p.type, Tt4, Tt2, Pt2, pid, fl, S, warn };

  if (p.type === 'tj') {
    let tauc, pic, Tt3, f, tauT, piT, mdot;
    if (!ref) {
      pic = d.opr; tauc = compTau(pic, C, e.ec); Tt3 = Tt2 * tauc; f = fuelAir(Tt3);
      tauT = 1 - cpc * Tt2 * (tauc - 1) / (e.etam * (1 + f) * cpt * Tt4);
      piT = turbPi(tauT, H, e.et); mdot = d.mdot;
    } else {
      tauT = ref.tauT; piT = ref.piT; f = ref.f;
      for (let i = 0; i < 6; i++) {
        tauc = 1 + e.etam * (1 + f) * cpt * Tt4 * (1 - tauT) / (cpc * Tt2);
        Tt3 = Tt2 * tauc; f = fuelAir(Tt3);
      }
      pic = compPi(tauc, C, e.ec);
    }
    const Pt3 = Pt2 * pic, Pt4 = Pt3 * e.pib;
    if (ref) mdot = ref.mdot * (Pt4 / ref.Pt4) * Math.sqrt(ref.Tt4 / Tt4) * (1 + ref.f) / (1 + f);
    const Tt5 = Tt4 * tauT, Pt5 = Pt4 * piT;
    Object.assign(S, {
      '3': { Tt: Tt3, Pt: Pt3, gas: C }, '4': { Tt: Tt4, Pt: Pt4, gas: H },
      '5': { Tt: Tt5, Pt: Pt5, gas: H },
    });
    Object.assign(r, { tauc, pic, opr: pic, f, tauT, piT, mdot, mcore: mdot, bpr: 0, Tt3, Pt3, Pt4, Tt5, Pt5,
      spool: { HP: Math.sqrt(Tt2 * (tauc - 1)) } });
    // 後燃段
    afterburnerAndNozzle(r, p, fl, mdot * (1 + f), Tt5, Pt5, H, S);
    const mf = mdot * f + (r.mfAB || 0);
    finishPerformance(r, p, fl, mdot, mf, [r.noz]);
    if (tauT < 0.35 || tauT >= 1) warn.push('渦輪功率不足以驅動壓氣機，請降低總壓比或提高 Tt4');
    return r;
  }

  /* ---------- 雙軸渦扇（分離排氣 hbtf / 混合排氣 lbtf） ---------- */
  const mixed = p.type === 'lbtf';
  let tauf, pif, taubst, pibst, taucH, picH, Tt3, f, tautH, pitH, tautL, pitL, alpha, mcore, kb;
  if (!ref) {
    pif = d.fpr; tauf = compTau(pif, C, e.ef);
    pibst = mixed ? 1 : d.pibst; taubst = compTau(pibst, C, e.ec);
    picH = d.opr / (pif * pibst);
    if (picH < 1.2) { warn.push('總壓比過低：高壓壓氣機壓比 < 1.2'); picH = Math.max(1.2, picH); }
    taucH = compTau(picH, C, e.ec);
    const Tt25 = Tt2 * tauf * taubst;
    Tt3 = Tt25 * taucH; f = fuelAir(Tt3);
    tautH = 1 - cpc * Tt25 * (taucH - 1) / (e.etam * (1 + f) * cpt * Tt4);
    pitH = turbPi(tautH, H, e.et);
    const Pt4 = Pt2 * pif * pibst * picH * e.pib;
    const Tt45 = Tt4 * tautH, Pt45 = Pt4 * pitH;
    if (mixed) {
      const Pt16 = Pt2 * pif * e.pifd;
      pitL = Pt16 / Pt45;
      if (pitL >= 0.98) { warn.push('混合器總壓無法匹配：風扇壓比過高或總壓比過低'); pitL = 0.9; }
      tautL = turbTau(pitL, H, e.et);
      const W = e.etam * (1 + f) * cpt * Tt45 * (1 - tautL);
      alpha = W / (cpc * Tt2 * (tauf - 1)) - 1;
      if (alpha < 0.05) { warn.push('此組合下涵道比 < 0.05：請降低風扇壓比或提高 Tt4'); alpha = 0.05; }
      kb = 0;
    } else {
      alpha = d.bpr;
      kb = (taubst - 1) * tauf / (tauf - 1);
      const W = cpc * Tt2 * ((1 + alpha) * (tauf - 1) + tauf * (taubst - 1));
      tautL = 1 - W / (e.etam * (1 + f) * cpt * Tt45);
      if (tautL < 0.25) { warn.push('低壓渦輪需求過大：請降低涵道比／風扇壓比，或提高 Tt4'); tautL = 0.25; }
      pitL = turbPi(tautL, H, e.et);
    }
    mcore = d.mdot / (1 + alpha);
  } else if (mixed) {
    /* 混合排氣：高壓渦輪壅塞（τtH 固定）、風扇沿「修正流量 ∝ 修正轉速」操作線、
       可變噴嘴喉部；以混合器兩股總壓相等決定風扇工作點與低壓渦輪膨脹比 */
    tautH = ref.tautH; pitH = ref.pitH; kb = 0; taubst = 1; pibst = 1;
    const evalTf = (tf) => {
      let ff = ref.f, tcH = 1, pcH = 1, T3 = Tt2;
      const pf = compPi(tf, C, e.ef), T25 = Tt2 * tf;
      for (let k = 0; k < 6; k++) {
        tcH = 1 + e.etam * (1 + ff) * cpt * Tt4 * (1 - tautH) / (cpc * T25);
        T3 = T25 * tcH; ff = fuelAir(T3);
      }
      pcH = compPi(tcH, C, e.ec);
      const P4 = Pt2 * pf * pcH * e.pib;
      const mc = ref.mcore * (P4 / ref.Pt4) * Math.sqrt(ref.Tt4 / Tt4) * (1 + ref.f) / (1 + ff);
      const m0 = ref.mdot * Math.sqrt(Math.max(1e-6, (tf - 1) / (ref.tauf - 1))) * (Pt2 / ref.Pt2) * Math.sqrt(ref.Tt2 / Tt2);
      const al = Math.max(0.02, m0 / mc - 1);
      const T45 = Tt4 * tautH, P45 = P4 * pitH;
      let tL = 1 - (1 + al) * cpc * Tt2 * (tf - 1) / (e.etam * (1 + ff) * cpt * T45);
      tL = Math.max(0.3, Math.min(0.995, tL));
      const pL = turbPi(tL, H, e.et);
      const res = Pt2 * pf * e.pifd - P45 * pL;
      return { res, tf, pf, tcH, pcH, T3, ff, mc, al, tL, pL };
    };
    let lo = 1.003, hi = Math.max(1.05, (ref.tauf - 1) * 2.2 + 1);
    let a = evalTf(lo), b = evalTf(hi), mid = null;
    if (a.res > 0) mid = a; else if (b.res < 0) mid = b;
    else for (let k = 0; k < 50; k++) { const m = evalTf(0.5 * (lo + hi)); if (m.res > 0) hi = m.tf; else lo = m.tf; mid = m; if (hi - lo < 1e-7) break; }
    tauf = mid.tf; pif = mid.pf; taucH = mid.tcH; picH = mid.pcH; Tt3 = mid.T3; f = mid.ff;
    mcore = mid.mc; alpha = mid.al; tautL = mid.tL; pitL = mid.pL;
  } else {
    tautH = ref.tautH; pitH = ref.pitH; tautL = ref.tautL; pitL = ref.pitL; kb = ref.kb;
    tauf = ref.tauf; alpha = ref.bpr; f = ref.f;
    for (let it = 0; it < 80; it++) {
      pif = compPi(tauf, C, e.ef);
      taubst = 1 + kb * (tauf - 1) / tauf; pibst = compPi(taubst, C, e.ec);
      const Tt25 = Tt2 * tauf * taubst;
      taucH = 1 + e.etam * (1 + f) * cpt * Tt4 * (1 - tautH) / (cpc * Tt25);
      picH = compPi(taucH, C, e.ec);
      Tt3 = Tt25 * taucH; f = fuelAir(Tt3);
      const Pt4 = Pt2 * pif * pibst * picH * e.pib;
      mcore = ref.mcore * (Pt4 / ref.Pt4) * Math.sqrt(ref.Tt4 / Tt4) * (1 + ref.f) / (1 + f);
      if (!mixed) { // 固定面積收斂噴嘴：噴嘴未壅塞時低壓渦輪膨脹比隨之改變
        const Pt45 = Pt4 * pitH, Tt45 = Tt4 * tautH, m5 = mcore * (1 + f);
        let lo = 0.03, hi = 0.999;
        for (let k = 0; k < 44; k++) {
          const mid = 0.5 * (lo + hi), tau = turbTau(mid, H, e.et), Pt9 = Pt45 * mid * e.pin;
          const n = nozzle(1, Tt45 * tau, Pt9, fl.P0, H, 'conv');
          const cap = ref.A9core * Pt9 * mfp(n.M, H.g, Rg(H)) / Math.sqrt(Tt45 * tau);
          if (cap > m5) hi = mid; else lo = mid;
        }
        pitL = 0.5 * (lo + hi); tautL = turbTau(pitL, H, e.et);
      }
      const Tt13 = Tt2 * tauf, Pt13 = Pt2 * pif;
      let mfpRatio = 1;
      if (!mixed) {
        const n = nozzle(1, Tt13, Pt13 * e.pifn, fl.P0, C, 'conv');
        mfpRatio = mfp(n.M, C.g, Rg(C)) / ref.mfp19;
      }
      const mbyp = ref.mbyp * (Pt13 / ref.Pt13) * Math.sqrt(ref.Tt13 / Tt13) * mfpRatio;
      const aNew = Math.max(0.02, mbyp / mcore);
      const W = e.etam * (1 + f) * cpt * Tt4 * tautH * (1 - tautL);
      const y = W / (cpc * Tt2 * (1 + aNew + kb));
      const tNew = 1 + y;
      const dt = Math.abs(tNew - tauf) + Math.abs(aNew - alpha) * 0.01;
      tauf = 0.5 * tauf + 0.5 * tNew; alpha = 0.5 * alpha + 0.5 * aNew;
      if (dt < 1e-9) break;
    }
    pif = compPi(tauf, C, e.ef);
    taubst = 1 + kb * (tauf - 1) / tauf; pibst = compPi(taubst, C, e.ec);
  }
  const Tt13 = Tt2 * tauf, Pt13 = Pt2 * pif;
  const Tt25 = Tt13 * taubst, Pt25 = Pt13 * pibst;
  Tt3 = Tt25 * taucH; const Pt3 = Pt25 * picH;
  const Pt4 = Pt3 * e.pib;
  const Tt45 = Tt4 * tautH, Pt45 = Pt4 * pitH;
  const Tt5 = Tt45 * tautL, Pt5 = Pt45 * pitL;
  const mdot = mcore * (1 + alpha), mbyp = mcore * alpha;
  Object.assign(S, {
    '13': { Tt: Tt13, Pt: Pt13, gas: C }, '21': { Tt: Tt13, Pt: Pt13, gas: C },
    '25': { Tt: Tt25, Pt: Pt25, gas: C }, '3': { Tt: Tt3, Pt: Pt3, gas: C },
    '4': { Tt: Tt4, Pt: Pt4, gas: H }, '45': { Tt: Tt45, Pt: Pt45, gas: H },
    '5': { Tt: Tt5, Pt: Pt5, gas: H },
  });
  Object.assign(r, {
    tauf, pif, taubst, pibst, taucH, picH, opr: pif * pibst * picH, f, tautH, pitH, tautL, pitL, kb,
    bpr: alpha, mdot, mcore, mbyp, Tt3, Pt3, Pt4, Tt13, Pt13, Tt25, Pt25, Tt45, Pt45, Tt5, Pt5,
    spool: { LP: Math.sqrt(Tt2 * (tauf - 1)), HP: Math.sqrt(Tt25 * (taucH - 1)) },
  });
  if (tautH < 0.3) warn.push('高壓渦輪膨脹比過大');
  if (f <= 0) warn.push('Tt4 低於壓氣機出口溫度，無法燃燒');

  const m5 = mcore * (1 + f);
  let nozzles = [];
  if (!mixed) {
    const nc = nozzle(m5, Tt5, Pt5 * e.pin, fl.P0, H, 'conv');
    const nb = nozzle(mbyp, Tt13, Pt13 * e.pifn, fl.P0, C, 'conv');
    S['9'] = { Tt: Tt5, Pt: Pt5 * e.pin, gas: H };
    S['19'] = { Tt: Tt13, Pt: Pt13 * e.pifn, gas: C };
    r.noz = nc; r.nozB = nb; r.mfp19 = mfp(nb.M, C.g, Rg(C)); if (!ref) r.A9core = nc.A;
    if (nc.npr < 1.08) warn.push(`核心噴嘴壓比僅 ${nc.npr.toFixed(2)}：低壓渦輪幾乎取盡核心氣流能量，核心排氣接近零推力。請降低涵道比或風扇壓比，或提高 Tt4`);
    nozzles = [nc, nb];
    finishPerformance(r, p, fl, mdot, mcore * f, nozzles);
  } else {
    const Pt16 = Pt13 * e.pifd; S['16'] = { Tt: Tt13, Pt: Pt16, gas: C };
    const mix = mixGas(m5, H, mbyp, C);
    const Tt6A = (m5 * H.cp * Tt5 + mbyp * C.cp * Tt13) / ((m5 + mbyp) * mix.cp);
    const Pt6A = (m5 * Pt5 + mbyp * Pt16) / (m5 + mbyp) * e.piM;
    S['6A'] = { Tt: Tt6A, Pt: Pt6A, gas: mix };
    Object.assign(r, { Pt16, Tt6A, Pt6A, mixGas: mix });
    if (ref && Math.abs(Pt16 / Pt5 - 1) > 0.2) warn.push(`混合器兩股總壓相差 ${(Math.abs(Pt16 / Pt5 - 1) * 100).toFixed(0)}%（外涵 ${(Pt16 / 1000).toFixed(0)} kPa、核心 ${(Pt5 / 1000).toFixed(0)} kPa），實際混合損失會高於模型所設的 2%`);
    afterburnerAndNozzle(r, p, fl, m5 + mbyp, Tt6A, Pt6A, mix, S);
    finishPerformance(r, p, fl, mdot, mcore * f + (r.mfAB || 0), [r.noz]);
  }
  return r;
}

function afterburnerAndNozzle(r, p, fl, m6, Tt6, Pt6, gas6, S) {
  const e = p.eff;
  let Tt7 = Tt6, Pt7, gas7 = gas6, mfAB = 0;
  const abOn = !!(p.ab && ENGINE_TYPES[p.type].hasAB && p.Tt7 > Tt6 + 20);
  if (abOn) {
    const A = GAS.ab;
    const fab = (A.cp * p.Tt7 - gas6.cp * Tt6) / (e.etaAB * e.LHV - A.cp * p.Tt7);
    mfAB = m6 * fab; Tt7 = p.Tt7; Pt7 = Pt6 * e.piabOn; gas7 = A;
  } else Pt7 = Pt6 * e.piabOff;
  const m7 = m6 + mfAB;
  S['6'] = S['6'] || { Tt: Tt6, Pt: Pt6, gas: gas6 };
  S['7'] = { Tt: Tt7, Pt: Pt7, gas: gas7 };
  S['9'] = { Tt: Tt7, Pt: Pt7 * e.pin, gas: gas7 };
  const nz = nozzle(m7, Tt7, Pt7 * e.pin, fl.P0, gas7, p.nozzleType || 'cd', ENGINE_TYPES[p.type].arMax);
  Object.assign(r, { abOn, Tt7, Pt7, gas7, mfAB, m7, noz: nz, Tt6, Pt6 });
}

function finishPerformance(r, p, fl, mdot, mfuel, nozzles) {
  const V0 = fl.V0;
  let F = -mdot * V0, KE = -0.5 * mdot * V0 * V0;
  for (const n of nozzles) {
    const Fn = n.mdot * n.V + n.A * (n.P - fl.P0);
    F += Fn;
    const Ve = Fn / n.mdot; // 等效排氣速度
    KE += 0.5 * n.mdot * Ve * Ve;
    n.Veff = Ve; n.F = Fn;
  }
  const Q = mfuel * p.eff.LHV;
  r.F = F; r.mfuel = mfuel; r.tsfc = mfuel / Math.max(F, 1e-6);
  r.Fs = F / mdot;
  r.etaTh = KE / Q;
  r.etaP = V0 > 1 ? F * V0 / KE : 0;
  r.etaO = V0 > 1 ? F * V0 / Q : 0;
  r.ramDrag = mdot * V0;
}

/* ============================================================
 *  完整求解：設計點 → 操作點（含轉速限制）
 * ============================================================ */
function solveEngine(p) {
  const T = ENGINE_TYPES[p.type];
  const flRef = flightState(0, 0);
  const pRef = Object.assign({}, p, { ab: false });
  const ref = runCycle(pRef, null, flRef, p.design.Tt4max);
  const fl = flightState(p.alt, p.M0);
  const Tt4cmd = p.design.Tt4max * p.thr;
  let op = runCycle(p, ref, fl, Tt4cmd);
  const Nmax = 1.05;
  const nrat = (o) => {
    let m = 0;
    for (const k in o.spool) m = Math.max(m, o.spool[k] / ref.spool[k]);
    return m;
  };
  op.limited = false;
  if (nrat(op) > Nmax) {
    let lo = 0.45 * p.design.Tt4max, hi = Tt4cmd;
    for (let i = 0; i < 40; i++) {
      const mid = 0.5 * (lo + hi);
      const o = runCycle(p, ref, fl, mid);
      if (nrat(o) > Nmax) hi = mid; else lo = mid;
    }
    op = runCycle(p, ref, fl, lo);
    op.limited = true;
  }
  op.Tt4cmd = Tt4cmd;
  for (const w of ref.warn) if (!op.warn.includes(w)) op.warn.unshift('設計點：' + w);
  op.N = {};
  for (const k in op.spool) op.N[k] = op.spool[k] / ref.spool[k];
  op.rpm = {};
  for (const k in op.N) op.rpm[k] = op.N[k] * T.rpm[k];
  return { ref, op, flRef, fl };
}

if (typeof module !== 'undefined') module.exports = { GAS, Rg, isa, mfp, invMfp, areaRatio, machFromNPR, critNPR, staticFromTotal, nozzle, ENGINE_TYPES, DEFAULT_EFF, flightState, runCycle, solveEngine, mixGas, compPi, compTau, turbPi, turbTau };
