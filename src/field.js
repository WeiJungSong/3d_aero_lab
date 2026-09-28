/* ============================================================
 *  field.js — 由逐站循環結果重建二維軸對稱（含周向擾動）流場
 * ============================================================ */
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
const DEG = Math.PI / 180;

/* ---------- 節點（knot）建構 ---------- */
function KnotList() { this.k = []; }
KnotList.prototype.add = function (x, Tt, Pt, Md, sw, gas, mdot, extra) {
  const o = { x, Tt, Pt, Md, sw: sw || 0, g: gas.g, cp: gas.cp, R: Rg(gas), mdot, noz: -1 };
  if (extra) Object.assign(o, extra);
  this.k.push(o); return o;
};
KnotList.prototype.last = function () { return this.k[this.k.length - 1]; };

function rowsOf(spec, comp) { return spec.rows.filter(r => r.comp === comp).sort((a, b) => a.x0 - b.x0); }

/* 壓縮段：轉子逐排升溫，Pt 依多變關係 */
function kbCompress(kb, rows, st, out, Min, Mout, gas, mdot, swRotor) {
  const nr = rows.filter(r => r.rotor).length || 1;
  const dT = (out.Tt - st.Tt) / nr;
  const expo = Math.log(out.Pt / st.Pt) / Math.log(out.Tt / st.Tt || 1.0000001);
  const x0 = rows[0].x0, x1 = rows[rows.length - 1].x1;
  let Tt = st.Tt, sw = 0;
  const Mof = x => lerp(Min, Mout, clamp((x - x0) / (x1 - x0), 0, 1));
  const PtOf = T => st.Pt * Math.pow(T / st.Tt, isFinite(expo) ? expo : 0);
  for (const r of rows) {
    kb.add(r.x0, Tt, PtOf(Tt), Mof(r.x0), sw, gas, mdot);
    if (r.rotor) { Tt += dT; sw = swRotor; } else sw = r.role === 'igv' ? -8 : 0;
    kb.add(r.x1, Tt, PtOf(Tt), Mof(r.x1) * (r.rotor ? 1.04 : 1), sw, gas, mdot);
  }
  return { Tt: out.Tt, Pt: out.Pt, sw };
}
/* 渦輪段：導向葉片加旋、轉子做功 */
function kbExpand(kb, rows, st, out, gas, mdot, o) {
  const nr = rows.filter(r => r.rotor).length || 1;
  const dT = (st.Tt - out.Tt) / nr;
  const expo = Math.log(out.Pt / st.Pt) / Math.log(out.Tt / st.Tt);
  let Tt = st.Tt, Pt = st.Pt, sw = 0, first = true;
  for (const r of rows) {
    if (!r.rotor) {
      const TtEnd = Tt - dT, PtStageEnd = st.Pt * Math.pow(TtEnd / st.Tt, expo);
      kb.add(r.x0, Tt, Pt, first ? o.Min : 0.42, sw, gas, mdot);
      Pt = Pt * Math.pow(PtStageEnd / Pt, 0.07);
      sw = first ? 70 : 62;
      kb.add(r.x0 + (r.x1 - r.x0) * 0.6, Tt, Pt, first ? o.Mthroat : 0.62, sw, gas, mdot);
      kb.add(r.x1, Tt, Pt, first ? o.Mthroat * 0.9 : 0.6, sw, gas, mdot);
      first = false;
    } else {
      kb.add(r.x0, Tt, Pt, 0.55, sw, gas, mdot);
      Tt -= dT; Pt = st.Pt * Math.pow(Tt / st.Tt, expo); sw = 6;
      kb.add(r.x1, Tt, Pt, o.Mout, sw, gas, mdot);
    }
  }
  return { Tt: out.Tt, Pt: out.Pt };
}

/* 為各流道建立節點（ref 與 op 使用同一結構，以便以 ṁ√Tt/Pt 比值換算馬赫數） */
function buildKnots(spec, c, P) {
  const S = c.S, e = P.eff, s = spec.s, C = GAS.cold, H = GAS.hot;
  const out = {};
  const fl = c.fl;
  if (spec.type === 'hbtf') {
    const mT = c.mdot, mc = c.mcore, mb = c.mbyp, m4 = mc * (1 + c.f);
    // 進氣道 + 風扇
    let kb = new KnotList();
    kb.add(0, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.3, 0.46, 0, C, mT);
    kb.add(0.30 * s, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.7, 0.5, 0, C, mT);
    const fan = rowsOf(spec, 'fan')[0];
    kb.add(fan.x0, c.Tt2, c.Pt2, 0.55, 0, C, mT);
    kb.add(fan.x1, c.Tt13, c.Pt13, 0.5, 25, C, mT);
    kb.add(0.90 * s, c.Tt13, c.Pt13, 0.47, 22, C, mT);
    out.inlet = kb.k;
    // 外涵道
    kb = new KnotList();
    kb.add(0.90 * s, c.Tt13, c.Pt13, 0.45, 22, C, mb);
    kb.add(1.00 * s, c.Tt13, c.Pt13 * 0.998, 0.44, 20, C, mb);
    kb.add(1.10 * s, c.Tt13, c.Pt13 * 0.995, 0.40, 0, C, mb);
    kb.add(1.60 * s, c.Tt13, c.Pt13 * 0.993, 0.42, 0, C, mb);
    kb.add(1.90 * s, c.Tt13, c.Pt13 * 0.992, 0.46, 0, C, mb, { nozIn: true });
    kb.add(2.05 * s, c.Tt13, S['19'].Pt * 1.001, 0, 0, C, mb, { noz: 0.5 });
    kb.add(2.2 * s, c.Tt13, S['19'].Pt, 0, 0, C, mb, { noz: 1, exit: 'bypass' });
    out.bypass = kb.k;
    // 核心
    kb = new KnotList();
    kb.add(0.90 * s, c.Tt13, c.Pt13, 0.48, 20, C, mc);
    let st = kbCompress(kb, rowsOf(spec, 'lpc'), { Tt: c.Tt13, Pt: c.Pt13 }, { Tt: c.Tt25, Pt: c.Pt25 }, 0.5, 0.45, C, mc, 32);
    kb.add(1.30 * s, c.Tt25, c.Pt25, 0.44, 0, C, mc);
    kb.add(1.40 * s, c.Tt25, c.Pt25, 0.47, 0, C, mc);
    st = kbCompress(kb, rowsOf(spec, 'hpc'), { Tt: c.Tt25, Pt: c.Pt25 }, { Tt: c.Tt3, Pt: c.Pt3 }, 0.5, 0.30, C, mc, 34);
    kb.add(2.08 * s, c.Tt3, c.Pt3, 0.18, 0, C, mc);
    combKnots(kb, spec, c, c.Tt3, c.Pt3, c.Pt4, mc, m4);
    kbExpand(kb, rowsOf(spec, 'hpt'), { Tt: c.Tt4, Pt: c.Pt4 }, { Tt: c.Tt45, Pt: c.Pt45 }, H, m4, { Min: 0.15, Mthroat: 0.95, Mout: 0.45 });
    kb.add(2.62 * s, c.Tt45, c.Pt45, 0.42, 0, H, m4);
    kbExpand(kb, rowsOf(spec, 'lpt'), { Tt: c.Tt45, Pt: c.Pt45 }, { Tt: c.Tt5, Pt: c.Pt5 }, H, m4, { Min: 0.4, Mthroat: 0.62, Mout: 0.42 });
    kb.add(3.10 * s, c.Tt5, c.Pt5, 0.40, 0, H, m4);
    kb.add(3.20 * s, c.Tt5, c.Pt5 * 0.999, 0.42, 0, H, m4, { nozIn: true });
    kb.add(3.34 * s, c.Tt5, S['9'].Pt * 1.001, 0, 0, H, m4, { noz: 0.55 });
    kb.add(3.45 * s, c.Tt5, S['9'].Pt, 0, 0, H, m4, { noz: 1, exit: 'core' });
    out.core = kb.k;
  } else if (spec.type === 'tj') {
    const m0 = c.mdot, m4 = m0 * (1 + c.f), m7 = c.m7;
    const kb = new KnotList();
    kb.add(0, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.3, 0.42, 0, C, m0);
    kb.add(0.2 * s, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.8, 0.47, 0, C, m0);
    kbCompress(kb, rowsOf(spec, 'comp'), { Tt: c.Tt2, Pt: c.Pt2 }, { Tt: c.Tt3, Pt: c.Pt3 }, 0.5, 0.30, C, m0, 30);
    kb.add(1.60 * s, c.Tt3, c.Pt3, 0.14, 0, C, m0);
    combKnots(kb, spec, c, c.Tt3, c.Pt3, c.Pt4, m0, m4);
    kbExpand(kb, rowsOf(spec, 'turb'), { Tt: c.Tt4, Pt: c.Pt4 }, { Tt: c.Tt5, Pt: c.Pt5 }, H, m4, { Min: 0.18, Mthroat: 0.95, Mout: 0.45 });
    abKnots(kb, spec, c, m4, m7, c.Tt5, c.Pt5, H, 2.62 * s);
    out.core = kb.k;
  } else {
    const mT = c.mdot, mc = c.mcore, mb = c.mbyp, m4 = mc * (1 + c.f), m6 = m4 + mb, m7 = c.m7;
    let kb = new KnotList();
    kb.add(0, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.3, 0.42, 0, C, mT);
    kb.add(0.2 * s, fl.Tt0, fl.Pt0 - (fl.Pt0 - c.Pt2) * 0.8, 0.47, 0, C, mT);
    kbCompress(kb, rowsOf(spec, 'fan'), { Tt: c.Tt2, Pt: c.Pt2 }, { Tt: c.Tt13, Pt: c.Pt13 }, 0.5, 0.42, C, mT, 28);
    kb.add(0.85 * s, c.Tt13, c.Pt13, 0.4, 0, C, mT);
    out.inlet = kb.k;
    kb = new KnotList();
    kb.add(0.85 * s, c.Tt13, c.Pt13, 0.3, 0, C, mb);
    kb.add(1.3 * s, c.Tt13, c.Pt13 * 0.995, 0.28, 0, C, mb);
    kb.add(1.8 * s, c.Tt13, c.Pt13 * 0.988, 0.4, 0, C, mb);
    kb.add(2.75 * s, c.Tt13, c.Pt16, 0.33, 0, C, mb);
    out.bypass = kb.k;
    kb = new KnotList();
    kb.add(0.85 * s, c.Tt13, c.Pt13, 0.45, 0, C, mc);
    kbCompress(kb, rowsOf(spec, 'hpc'), { Tt: c.Tt25, Pt: c.Pt25 }, { Tt: c.Tt3, Pt: c.Pt3 }, 0.5, 0.30, C, mc, 32);
    kb.add(1.58 * s, c.Tt3, c.Pt3, 0.16, 0, C, mc);
    combKnots(kb, spec, c, c.Tt3, c.Pt3, c.Pt4, mc, m4);
    kbExpand(kb, rowsOf(spec, 'hpt'), { Tt: c.Tt4, Pt: c.Pt4 }, { Tt: c.Tt45, Pt: c.Pt45 }, H, m4, { Min: 0.15, Mthroat: 0.95, Mout: 0.45 });
    kb.add(2.17 * s, c.Tt45, c.Pt45, 0.42, 0, H, m4);
    kbExpand(kb, rowsOf(spec, 'lpt'), { Tt: c.Tt45, Pt: c.Pt45 }, { Tt: c.Tt5, Pt: c.Pt5 }, H, m4, { Min: 0.4, Mthroat: 0.6, Mout: 0.42 });
    kb.add(2.75 * s, c.Tt5, c.Pt5, 0.36, 0, H, m4);
    out.core = kb.k;
    kb = new KnotList();
    kb.add(2.75 * s, c.Tt6A, c.Pt6A / e.piM * 0.995, 0.34, 0, c.mixGas, m6);
    abKnots(kb, spec, c, m6, m7, c.Tt6A, c.Pt6A, c.mixGas, 3.0 * s);
    out.ab = kb.k;
  }
  return out;
}
function combKnots(kb, spec, c, Tt3, Pt3, Pt4, m3, m4) {
  const cb = spec.comb;
  const C = GAS.cold, H = GAS.hot;
  const N = 7;
  for (let i = 0; i <= N; i++) {
    const t = i / N, x = lerp(cb.xd, cb.x1, t);
    const Tt = Tt3 + (c.Tt4 - Tt3) * smooth(0.04, 0.92, t);
    const Pt = Pt3 + (Pt4 - Pt3) * smooth(0, 0.9, t);
    const gas = t < 0.35 ? C : H;
    kb.add(x, Tt, Pt, lerp(0.07, 0.15, t * t), 0, gas, lerp(m3, m4, t));
  }
}
function abKnots(kb, spec, c, m6, m7, Tt6, Pt6, gas6, xStart) {
  const ab = spec.ab;
  const s = spec.s;
  const gas7 = c.gas7;
  kb.add(xStart, Tt6, Pt6, 0.34, 0, gas6, m6);
  kb.add(ab.xSpray, Tt6, Pt6, 0.25, 0, gas6, m6);
  kb.add(ab.xFH, Tt6, Pt6 * 0.998, 0.24, 0, gas6, m6);
  const N = 6;
  for (let i = 1; i <= N; i++) {
    const t = i / N, x = lerp(ab.xFH, ab.x1, t);
    const Tt = Tt6 + (c.Tt7 - Tt6) * smooth(0, 0.85, t);
    const Pt = Pt6 + (c.Pt7 - Pt6) * t;
    const g = c.abOn && t > 0.3 ? gas7 : gas6;
    kb.add(x, Tt, Pt, lerp(0.24, 0.30, t), 0, g, lerp(m6, m7, t), i === N ? { nozIn: true } : null);
  }
  const n = spec.nozzle;
  const P9 = c.S['9'].Pt;
  const xs = [lerp(n.x0, n.xt, 0.5), n.xt, lerp(n.xt, n.xe, 0.5), n.xe];
  const fr = [0.35, 0.62, 0.81, 1];
  for (let i = 0; i < xs.length; i++) kb.add(xs[i], c.Tt7, lerp(c.Pt7, P9, fr[i]), 0, 0, gas7, m7, { noz: fr[i], exit: i === xs.length - 1 ? 'core' : undefined, throat: i === 1 });
}

/* 以設計點有效面積換算操作點馬赫數 */
function assignMach(knRef, knOp, cyc, streamKey) {
  let Min = 0.4;
  for (let i = 0; i < knOp.length; i++) {
    const a = knRef[i], b = knOp[i];
    if (b.noz >= 0) continue;
    const ratio = (b.mdot * Math.sqrt(b.Tt) / b.Pt) / (a.mdot * Math.sqrt(a.Tt) / a.Pt);
    b.M = invMfp(mfp(a.Md, a.g, a.R) * ratio, b.g, b.R, false);
    if (b.M > 0.999) b.choke = true;
    if (b.nozIn) Min = b.M;
  }
  // 噴嘴段
  const nz = streamKey === 'bypass' ? cyc.nozB : cyc.noz;
  for (let i = 0; i < knOp.length; i++) {
    const b = knOp[i];
    if (b.noz < 0) continue;
    const f = b.noz;
    if (nz.type === 'conv' || !nz.choked) {
      b.M = Min + (nz.M - Min) * Math.pow(f, 1.6);
    } else {
      const ft = 0.62;
      if (f <= ft) b.M = Min + (1 - Min) * Math.pow(f / ft, 1.5);
      else b.M = 1 + (nz.M - 1) * ((f - ft) / (1 - ft));
    }
    if (b.exit) b.M = nz.M;
  }
  for (const b of knOp) {
    const k = 1 + 0.5 * (b.g - 1) * b.M * b.M;
    b.T = b.Tt / k; b.P = b.Pt / Math.pow(k, b.g / (b.g - 1));
    b.a = Math.sqrt(b.g * b.R * b.T); b.V = b.M * b.a; b.rho = b.P / (b.R * b.T);
  }
}
function knotAt(kn, x, o) {
  let lo = 0, hi = kn.length - 1;
  if (x <= kn[0].x) { lo = hi = 0; }
  else if (x >= kn[hi].x) { lo = hi; }
  else {
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (kn[m].x <= x) lo = m; else hi = m; }
  }
  const a = kn[lo], b = kn[hi];
  const t = hi === lo || b.x - a.x < 1e-9 ? 0 : (x - a.x) / (b.x - a.x);
  o.Tt = lerp(a.Tt, b.Tt, t); o.Pt = a.Pt * Math.pow(b.Pt / a.Pt, t);
  o.M = lerp(a.M, b.M, t); o.sw = lerp(a.sw, b.sw, t);
  o.g = lerp(a.g, b.g, t); o.cp = lerp(a.cp, b.cp, t); o.R = lerp(a.R, b.R, t);
  return o;
}

/* ---------- 噴流（擴散卷積：動量通量 U² 與焓通量 U·ΔTt 守恆） ---------- */
function I0e(x) {
  const ax = Math.abs(x);
  if (ax < 3.75) {
    const t = (x / 3.75) ** 2;
    return Math.exp(-ax) * (1 + t * (3.5156229 + t * (3.0899424 + t * (1.2067492 + t * (0.2659732 + t * (0.0360768 + t * 0.0045813))))));
  }
  const t = 3.75 / ax;
  return (0.39894228 + t * (0.01328592 + t * (0.00225319 + t * (-0.00157565 + t * (0.00916281 + t * (-0.02057706 + t * (0.02635537 + t * (-0.01647633 + t * 0.00392377)))))))) / Math.sqrt(ax);
}
const GLx = [-0.9739065285, -0.8650633667, -0.6794095683, -0.4333953941, -0.1488743390, 0.1488743390, 0.4333953941, 0.6794095683, 0.8650633667, 0.9739065285];
const GLw = [0.0666713443, 0.1494513492, 0.2190863625, 0.2692667193, 0.2955242247, 0.2955242247, 0.2692667193, 0.2190863625, 0.1494513492, 0.0666713443];
function blurDisk(r, R, sig) {
  if (sig < 1e-5) return r < R ? 1 : 0;
  const a = Math.max(0, r - 6 * sig), b = Math.min(R, r + 6 * sig);
  if (b <= a) return 0;
  const hm = 0.5 * (b - a), c = 0.5 * (a + b), is2 = 1 / (sig * sig);
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const rho = c + hm * GLx[i];
    const d = r - rho;
    sum += GLw[i] * rho * is2 * Math.exp(-0.5 * d * d * is2) * I0e(r * rho * is2);
  }
  return Math.min(1, sum * hm);
}

/* ============================================================
 *  流場模型
 * ============================================================ */
function FieldModel(spec, sol, P) {
  this.spec = spec; this.sol = sol; this.P = P;
  const c = sol.op, fl = sol.fl;
  this.c = c; this.fl = fl;
  const kRef = buildKnots(spec, sol.ref, P), kOp = buildKnots(spec, c, P);
  for (const key in kOp) assignMach(kRef[key], kOp[key], c, key);
  this.kn = kOp;
  this.kr = {};
  // 固體多邊形包圍盒
  this.bodies = spec.bodies.map(b => ({ ...b, bb: bbox(b.poly) }));
  // 出口噴流
  const C = GAS.cold;
  const U0 = fl.V0;
  this.exits = [];
  for (const g of spec.exitsGeom) {
    const n = g.key === 'bypass' ? c.nozB : c.noz;
    const Tt = n.Tt;
    const Uex = n.V - U0, dTt = Tt - fl.Tt0;
    const Mj = n.P > fl.P0 * 1.02 ? machFromNPR(n.Pt / fl.P0, n.gas.g) : n.M;
    this.exits.push({ ...g, U: n.V, Uex, dTt, Tt, Pt: n.Pt, P: n.P, T: n.T, M: n.M, gas: n.gas, Mj,
      Ls: Mj > 1.02 ? 1.306 * Math.sqrt(Mj * Mj - 1) * 2 * g.R : 0, under: n.P > fl.P0 * 1.02,
      spread: 0.058 / (1 + 0.28 * Math.max(0, Mj - 1)) * (Tt > 600 ? 1.12 : 1) });
  }
  this.exits.sort((a, b) => b.R - a.R);
  this.maxdT = Math.max(...this.exits.map(e => Math.abs(e.dTt))) + 1;
  { const hot = this.exits.reduce((a, e) => (e.dTt > (a ? a.dTt : -1) ? e : a), null); this.hotGas = hot && hot.dTt > 50 ? hot.gas : null; }
  for (let i = 0; i < this.exits.length; i++) {
    const e = this.exits[i], o = this.exits[i - 1];
    const qm = e.Uex * Math.abs(e.Uex), qh = e.Uex * e.dTt;
    e.Qm = o ? qm - o.Uex * Math.abs(o.Uex) : qm;
    e.Qh = o ? qh - o.Uex * o.dTt : qh;
  }
  // 進氣面速度（沉匯模型）
  const k0 = (this.kn.inlet || this.kn.core)[0];
  this.Uface = k0.V;
  this.tmp = {};
  // 標記壅塞
  this.chokes = [];
  for (const key in this.kn) for (const k of this.kn[key]) if (k.choke && k.noz < 0) this.chokes.push({ stream: key, x: k.x });
}

FieldModel.prototype.classify = function (x, r) {
  const sp = this.spec;
  for (let i = 0; i < sp.order.length; i++) {
    const st = sp.streams[sp.order[i]];
    if (x < st.x0 || x > st.x1) continue;
    const lo = st.lo.at(x), hi = st.hi.at(x);
    if (r >= lo && r <= hi) return { kind: 'stream', key: sp.order[i], lo, hi };
  }
  for (const b of this.bodies) {
    const bb = b.bb;
    if (x < bb[0] || x > bb[1] || r < bb[2] || r > bb[3]) continue;
    if (pointInPoly(x, r, b.poly)) return { kind: 'solid', key: b.key, mat: b.mat };
  }
  return { kind: 'ext' };
};

FieldModel.prototype.compName = function (x, stream) {
  for (const c of this.spec.comps) if (x >= c.x0 && x <= c.x1 && (c.stream === stream || c.stream === '*')) return c;
  return null;
};

/* 主取樣函式：回傳該點所有物理量 */
FieldModel.prototype.sample = function (x, r, th, out) {
  out = out || {};
  const cl = this.classify(x, r);
  out.region = cl.kind; out.stream = cl.kind === 'stream' ? cl.key : null; out.x = x; out.r = r; out.th = th; out.mat = null; out.zone = null;
  if (cl.kind === 'solid') { out.solid = true; out.mat = cl.mat; return out; }
  out.solid = false;
  if (cl.kind === 'stream') return this.sampleStream(x, r, th, cl, out);
  return this.sampleExt(x, r, th, out);
};

FieldModel.prototype.sampleStream = function (x, r, th, cl, out) {
  const kn = this.kn[cl.key];
  const k = knotAt(kn, x, this.tmp);
  const c = this.c, sp = this.spec, s = sp.s;
  const h = Math.max(1e-6, cl.hi - cl.lo);
  const psi = (r - cl.lo) / h;
  let Tt = k.Tt, M = k.M;
  const g = k.g, cp = k.cp, R = k.R;
  let zone = null;
  // --- 燃燒室 ---
  const cb = sp.comb;
  if (cb && cl.key === cb.stream && x >= cb.x0 && x <= cb.turbEnd) {
    const Tt3 = c.Tt3, Tt4 = c.Tt4, dT = Math.max(0, Tt4 - Tt3);
    const N = cb.n, cosN = Math.cos(N * th);
    if (x <= cb.x1) {
      const li = cb.linerIn.at(x), lo = cb.linerOut.at(x);
      if (x < cb.xd || r < li || r > lo) {
        Tt = Tt3 * (1 + 0.012 * smooth(cb.xd, cb.x1, x)); zone = 'annulus';
        M = 0.11;
      } else {
        const sN = (x - cb.xd) / (cb.x1 - cb.xd), pl = (r - li) / Math.max(1e-6, lo - li);
        const Tpz = Math.min(Tt3 + 1.9 * dT, 2480, Tt3 + 1800);
        const Tline = sN < 0.3 ? Tt3 + (Tpz - Tt3) * smooth(0.0, 0.26, sN)
          : Tt4 + (Tpz - Tt4) * Math.exp(-3.4 * (sN - 0.3) / 0.7);
        const amp = cb.cannular ? 0.55 : 0.33;
        const gP = (0.3 + 0.7 * Math.exp(-(((pl - 0.5) / 0.24) ** 2))) * (1 + amp * cosN) / (1 + amp);
        const gE = 1 + 0.32 * (Math.sin(Math.PI * pl) - 2 / Math.PI) + (cb.cannular ? 0.14 : 0.08) * cosN;
        let G = lerp(gP, gE, smooth(0.28, 1, sN));
        const film = smooth(0, 0.07, pl) * smooth(0, 0.07, 1 - pl);
        G *= 0.35 + 0.65 * film;
        Tt = Tt3 + (Tline - Tt3) * G;
        zone = sN < 0.35 ? 'primary' : 'dilution';
        M = lerp(0.03, k.M, smooth(0, 0.7, sN));
      }
    } else {
      const dec = Math.exp(-(x - cb.x1) / (0.22 * s));
      const pf = 0.32 * (Math.sin(Math.PI * psi) - 2 / Math.PI) + (cb.cannular ? 0.14 : 0.08) * cosN;
      Tt = k.Tt + dT * pf * dec * 0.9;
    }
  }
  // --- 混合器 ---
  const mx = sp.mixer;
  if (mx && cl.key === 'ab') {
    const m = 1 - Math.exp(-Math.max(0, x - mx.x) / (0.5 * s));
    const lo = cl.lo, hi = cl.hi;
    const pa = (r * r - lo * lo) / Math.max(1e-9, hi * hi - lo * lo);
    const pc = mx.coreFrac + 0.13 * Math.cos(mx.lobes * th) * (1 - m);
    const w = 0.03 + 0.5 * m;
    const chi = 1 - smooth(pc - w, pc + w, pa);
    const Tloc = chi * c.Tt5 + (1 - chi) * c.Tt13;
    Tt = Tt + (1 - m) * (Tloc - c.Tt6A);
    zone = zone || 'mixer';
  }
  // --- 後燃器 ---
  const ab = sp.ab;
  if (ab && cl.key === ab.stream && x > ab.xFH && c.abOn) {
    const Tt6 = sp.type === 'lbtf' ? c.Tt6A : c.Tt5;
    const L = ab.x1 - ab.xFH, t = (x - ab.xFH) / L;
    let F = 0;
    const spread = (x - ab.xFH) * Math.tan(7 * DEG) + 0.004 * s;
    for (const rg of ab.rings) F = Math.max(F, 1 - smooth(spread * 0.55, spread, Math.abs(r - rg)));
    F = Math.max(F, smooth(0.45, 1.0, t));
    if (x >= ab.x1) F = 1;
    F *= smooth(0, 0.035 * s, cl.hi - r) * 0.85 + 0.15;
    const meanT = k.Tt;
    const TtF = Tt6 + (c.Tt7 - Tt6) * F;
    Tt = x >= ab.x1 ? meanT + (TtF - c.Tt7) : TtF + (Tt - Tt6) * (1 - F);
    zone = 'ab';
  }
  // --- 靜參數 ---
  const kk = 1 + 0.5 * (g - 1) * M * M;
  const P = k.Pt / Math.pow(1 + 0.5 * (g - 1) * k.M * k.M, g / (g - 1));
  let T = Tt / kk;
  let V = M * Math.sqrt(g * R * T);
  // 邊界層
  const d = Math.min(psi, 1 - psi) * h;
  const del = Math.max(0.07 * h, 0.004 * s);
  if (d < del) {
    const u = Math.pow(Math.max(0, d) / del, 1 / 7);
    V *= u;
    T = Tt - V * V / (2 * cp);
  }
  const a = Math.sqrt(g * R * T);
  const Mloc = V / a;
  const sw = k.sw * DEG;
  out.T = T; out.P = P; out.Tt = Tt; out.Pt = P * Math.pow(Tt / T, g / (g - 1));
  out.V = V; out.Vx = V * Math.cos(sw); out.Vth = V * Math.sin(sw); out.M = Mloc; out.a = a;
  out.rho = P / (R * T); out.g = g; out.cp = cp; out.R = R; out.psi = psi; out.zone = zone;
  out.swirl = k.sw;
  return out;
};

FieldModel.prototype.sampleExt = function (x, r, th, out) {
  const fl = this.fl, sp = this.spec, C = GAS.cold;
  const g = C.g, cp = C.cp, R = Rg(C);
  const U0 = fl.V0, rl = sp.lip.r;
  let U = U0;
  // 進氣沉匯
  {
    const dx = x <= sp.lip.x ? sp.lip.x - x : (x - sp.lip.x) * 4;
    const dr = Math.max(0, r - rl);
    const f = (1 - dx / Math.sqrt(dx * dx + rl * rl)) * Math.exp(-1.6 * (dr / rl) ** 2) * (r < sp.lip.rOut * 1.02 || x < sp.lip.x ? 1 : 0.4);
    U += (this.Uface - U0) * f;
  }
  // 短艙肩部加速
  if (U0 > 1 && x > sp.lip.x && x < sp.outerEnd) {
    const L = sp.outerEnd - sp.lip.x, dn = Math.max(0, r - sp.outer.at(x));
    U += 0.1 * U0 * Math.sin(Math.PI * (x - sp.lip.x) / L) ** 2 * Math.exp(-dn / (0.5 * rl));
  }
  let Tt = fl.Tt0, zone = 'free';
  let P = null;
  // 噴流
  let qm = 0, qh = 0, wcore = 0, shock = 0;
  for (const e of this.exits) {
    if (x < e.x) continue;
    const dxe = x - e.x;
    const sig = 0.015 * e.R + e.spread * dxe;
    const w = blurDisk(r, e.R, sig);
    if (w <= 1e-6) continue;
    qm += w * e.Qm; qh += w * e.Qh;
    if (e.under && e.Ls > 0) {
      const env = Math.exp(-dxe / (3.2 * e.Ls)) * Math.pow(w, 6);
      if (env > 1e-3) { shock = env; wcore = e; }
    }
  }
  if (qm !== 0 || qh !== 0) {
    const Uex = Math.sign(qm) * Math.sqrt(Math.abs(qm));
    const sU = Math.abs(Uex) < 2 ? 2 * Math.sign(Uex || 1) : Uex;
    let dTt = qh / sU;
    dTt = clamp(dTt, -this.maxdT, this.maxdT);
    U = U0 + Uex; Tt = fl.Tt0 + dTt;
    zone = 'jet';
  }
  let T = Tt - U * U / (2 * cp);
  P = fl.P0;
  if (zone === 'free') P = fl.Pt0 * Math.pow(Math.max(T, 1) / fl.Tt0, g / (g - 1));
  if (shock > 0) {
    const e = wcore, dxe = x - e.x;
    const Pc = fl.P0 * Math.exp(Math.log(e.P / fl.P0) * Math.cos(2 * Math.PI * dxe / e.Ls) * Math.exp(-dxe / (3.2 * e.Ls)));
    const ge = e.gas.g, cpe = e.gas.cp;
    const Tiso = Tt * Math.pow(Math.min(1, Pc / e.Pt), (ge - 1) / ge);
    const Uiso = Math.sqrt(Math.max(0, 2 * cpe * (Tt - Tiso)));
    const b = Math.min(1, shock);
    P = lerp(P, Pc, b); U = lerp(U, Uiso, b); T = Tt - U * U / (2 * cp);
    zone = 'shock';
  }
  T = Math.max(T, 50);
  // 噴流區以總溫增量比例混合燃氣性質
  let gg = g, cpp = cp, RR = R;
  if (zone !== 'free' && this.hotGas) {
    const fr = clamp((Tt - fl.Tt0) / this.maxdT, 0, 1), hg = this.hotGas;
    cpp = lerp(cp, hg.cp, fr); RR = lerp(R, Rg(hg), fr); gg = cpp / (cpp - RR);
    T = Math.max(50, Tt - U * U / (2 * cpp));
  }
  const a = Math.sqrt(gg * RR * T);
  out.T = T; out.P = P; out.Tt = Tt; out.Pt = P * Math.pow(Tt / T, gg / (gg - 1));
  out.V = Math.abs(U); out.Vx = U; out.Vth = 0; out.M = Math.abs(U) / a; out.a = a;
  out.rho = P / (RR * T); out.g = gg; out.cp = cpp; out.R = RR; out.zone = zone; out.swirl = 0;
  return out;
};

/* ---------- 網格映射（非均勻：引擎內部較密） ---------- */
function pwl(xs, ys, v) {
  if (v <= xs[0]) return ys[0] + (v - xs[0]) * (ys[1] - ys[0]) / (xs[1] - xs[0]);
  for (let i = 1; i < xs.length; i++) if (v <= xs[i]) return ys[i - 1] + (ys[i] - ys[i - 1]) * (v - xs[i - 1]) / (xs[i] - xs[i - 1]);
  const n = xs.length - 1;
  return ys[n] + (v - xs[n]) * (ys[n] - ys[n - 1]) / (xs[n] - xs[n - 1]);
}
function GridMap(dom, W, H) {
  this.dom = dom; this.W = W; this.H = H;
}
GridMap.prototype.xOfU = function (u) { return pwl(this.dom.ub, this.dom.xb, u); };
GridMap.prototype.uOfX = function (x) { return pwl(this.dom.xb, this.dom.ub, x); };
GridMap.prototype.rOfV = function (v) { return pwl(this.dom.vb, this.dom.rb, v); };
GridMap.prototype.vOfR = function (r) { return pwl(this.dom.rb, this.dom.vb, r); };

const FIELD_KEYS = ['T', 'Tt', 'P', 'Pt', 'V', 'M', 'rho', 'Vx', 'Vth'];
/* 計算子午面網格：reg 0=外部 1=固體 2+=流道 */
function computeGrid(model, map, th, base, onlyVariant) {
  const W = map.W, H = map.H, N = W * H;
  const G = base && onlyVariant ? base : { W, H, reg: new Uint8Array(N), mat: new Uint8Array(N), th };
  if (!G.T) for (const k of FIELD_KEYS) G[k] = new Float32Array(N);
  const xs = new Float64Array(W), rs = new Float64Array(H);
  for (let i = 0; i < W; i++) xs[i] = map.xOfU((i + 0.5) / W);
  for (let j = 0; j < H; j++) rs[j] = map.rOfV((j + 0.5) / H);
  const o = {};
  const sp = model.spec;
  const vx0 = sp.comb ? sp.comb.x0 : 0, vx1 = sp.comb ? sp.comb.turbEnd : 0;
  const mx0 = sp.mixer ? sp.mixer.x : Infinity, mx1 = sp.mixer ? sp.mixer.x + 1.6 * sp.s : -Infinity;
  const matId = { nacelle: 1, casing: 1, hub: 2, cowl: 3, liner: 4, fh: 4, spinner: 2 };
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const x = xs[i];
      if (onlyVariant && !((x >= vx0 && x <= vx1) || (x >= mx0 && x <= mx1))) continue;
      const idx = j * W + i;
      model.sample(x, rs[j], th, o);
      if (o.solid) { G.reg[idx] = 1; G.mat[idx] = matId[o.mat] || 1; for (const k of FIELD_KEYS) G[k][idx] = NaN; continue; }
      G.reg[idx] = o.region === 'ext' ? 0 : 2 + sp.order.indexOf(o.stream);
      G.T[idx] = o.T; G.Tt[idx] = o.Tt; G.P[idx] = o.P; G.Pt[idx] = o.Pt; G.V[idx] = o.V;
      G.M[idx] = o.M; G.rho[idx] = o.rho; G.Vx[idx] = o.Vx; G.Vth[idx] = o.Vth;
    }
  }
  return G;
}
function cloneGrid(G) {
  const C = { W: G.W, H: G.H, th: G.th, reg: G.reg.slice(), mat: G.mat.slice() };
  for (const k of FIELD_KEYS) C[k] = G[k].slice();
  return C;
}
/* 雙線性取樣（粒子用） */
function gridLookup(G, map, x, r, key) {
  const u = map.uOfX(x) * G.W - 0.5, v = map.vOfR(r) * G.H - 0.5;
  const i = Math.floor(u), j = Math.floor(v);
  if (i < 0 || j < 0 || i >= G.W - 1 || j >= G.H - 1) return NaN;
  const fu = u - i, fv = v - j, A = G[key], W = G.W;
  const a = A[j * W + i], b = A[j * W + i + 1], c = A[(j + 1) * W + i], d = A[(j + 1) * W + i + 1];
  if (a !== a || b !== b || c !== c || d !== d) { // 近壁：取有效值平均
    let s = 0, n = 0;
    for (const q of [a, b, c, d]) if (q === q) { s += q; n++; }
    return n ? s / n : NaN;
  }
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/* 橫截面（極座標）網格 */
function computeSection(model, x, Rsec, nT, nR) {
  const N = nT * nR;
  const S = { nT, nR, Rsec, x, reg: new Uint8Array(N), mat: new Uint8Array(N) };
  for (const k of FIELD_KEYS) S[k] = new Float32Array(N);
  const o = {};
  const sp = model.spec;
  const matId = { nacelle: 1, casing: 1, hub: 2, cowl: 3, liner: 4, fh: 4 };
  for (let j = 0; j < nR; j++) {
    const r = (j + 0.5) / nR * Rsec;
    for (let i = 0; i < nT; i++) {
      const th = (i + 0.5) / nT * Math.PI * 2;
      const idx = j * nT + i;
      model.sample(x, r, th, o);
      if (o.solid) { S.reg[idx] = 1; S.mat[idx] = matId[o.mat] || 1; for (const k of FIELD_KEYS) S[k][idx] = NaN; continue; }
      S.reg[idx] = o.region === 'ext' ? 0 : 2 + sp.order.indexOf(o.stream);
      for (const k of FIELD_KEYS) S[k][idx] = o[k];
    }
  }
  return S;
}

/* 軸向分布（圖表用）：流道平均值 */
function axialSeries(model, key) {
  const kn = model.kn[key];
  if (!kn) return null;
  return kn.map(k => ({ x: k.x, Tt: k.Tt, T: k.T, Pt: k.Pt, P: k.P, V: k.V, M: k.M, rho: k.rho }));
}
function plumeSeries(model, n) {
  const sp = model.spec, ex = model.exits[model.exits.length - 1];
  const x0 = ex.x, x1 = ex.x + sp.view.len * 1.1;
  const out = [];
  const o = {};
  for (let i = 0; i <= n; i++) {
    const x = lerp(x0 + 1e-4, x1, i / n);
    let r = 0;
    if (ex.plugTip && x < ex.plugTip) r = Math.max(sp.lines.hub.at(x) + 0.01 * sp.s, 0.5 * (ex.R + ex.Rin));
    model.sample(x, r, 0, o);
    if (o.solid) continue;
    out.push({ x, Tt: o.Tt, T: o.T, Pt: o.Pt, P: o.P, V: o.V, M: o.M, rho: o.rho });
  }
  return out;
}
function upstreamSeries(model, n) {
  const sp = model.spec, x0 = sp.domain.xb[0] * 0.6, out = [], o = {};
  for (let i = 0; i <= n; i++) {
    const x = lerp(x0, sp.lip.x - 1e-4, i / n);
    model.sample(x, 0, 0, o);
    out.push({ x, Tt: o.Tt, T: o.T, Pt: o.Pt, P: o.P, V: o.V, M: o.M, rho: o.rho });
  }
  return out;
}

/* T–s 路徑：沿核心流道節點積分 ds = cp dT/T − R dP/P（總狀態），最後接出口靜狀態 */
function tsPath(model) {
  const fl = model.fl, sp = model.spec;
  const pts = [];
  const C = GAS.cold, Rc = Rg(C);
  let sPrev = 0, Tprev = fl.T0, Pprev = fl.P0, cpPrev = C.cp, Rprev = Rc;
  pts.push({ T: fl.T0, s: 0, P: fl.P0, id: '0' });
  const push = (T, P, cp, R, id, x) => {
    const cpm = 0.5 * (cp + cpPrev), Rm = 0.5 * (R + Rprev);
    const s = sPrev + cpm * Math.log(T / Tprev) - Rm * Math.log(P / Pprev);
    pts.push({ T, s, P, id, x });
    sPrev = s; Tprev = T; Pprev = P; cpPrev = cp; Rprev = R;
  };
  push(fl.Tt0, fl.Pt0, C.cp, Rc, '0t');
  const chain = [];
  if (model.kn.inlet) chain.push(...model.kn.inlet.map(k => ['inlet', k]));
  chain.push(...model.kn.core.map(k => ['core', k]));
  if (model.kn.ab) chain.push(...model.kn.ab.map(k => ['ab', k]));
  let lastX = -Infinity;
  for (const [, k] of chain) {
    if (k.x < lastX - 1e-9) continue;
    lastX = k.x;
    push(k.Tt, k.Pt, k.cp, k.R, null, k.x);
  }
  const n = model.c.noz;
  push(n.T, n.P, n.gas.cp, Rg(n.gas), '9s');
  // 標註站位
  for (const st of sp.stations) {
    let best = null, bd = Infinity;
    for (const p of pts) if (p.x !== undefined && Math.abs(p.x - st.x) < bd && (st.stream === 'core' || st.stream === 'inlet' || st.stream === 'ab')) { bd = Math.abs(p.x - st.x); best = p; }
    if (best && bd < 0.08 * sp.s && !best.id) best.id = st.id;
  }
  // 外涵
  let byp = null;
  if (model.kn.bypass && sp.type === 'hbtf') {
    const nb = model.c.nozB;
    const k13 = model.kn.bypass[0];
    const s2 = pts.find(p => p.x !== undefined);
    const s13 = s2.s + C.cp * Math.log(k13.Tt / s2.T) - Rc * Math.log(k13.Pt / s2.P);
    const s19 = s13 + C.cp * Math.log(nb.T / k13.Tt) - Rc * Math.log(nb.P / k13.Pt);
    byp = [{ T: s2.T, s: s2.s }, { T: k13.Tt, s: s13, id: '13' }, { T: nb.T, s: s19, id: '19s' }];
  }
  return { pts, byp };
}

if (typeof module !== 'undefined') module.exports = { FieldModel, GridMap, computeGrid, computeSection, axialSeries, tsPath, blurDisk, plumeSeries, upstreamSeries, gridLookup };
