/* ============================================================
 *  aircraft.js — 參數化機型幾何：機身、機翼、平尾、垂尾、引擎短艙／內置引擎
 *  座標：x 由機鼻向後、y 向右翼、z 向上（m）。外形為通用設計，非特定真實機型。
 *  產出：面元網格（半模，接合處水密）、顯示網格、濕面積、截面積分布、參考量。
 * ============================================================ */
const AIRCRAFT_TYPES = {
  airliner: {
    label: '雙發窄體客機', en: 'Twin-engine narrow-body airliner', engine: 'hbtf', nEng: 2, internal: false,
    p: {
      fusL: 37.6, fusD: 3.95, nose: 0.14, tail: 0.30, tailUp: 0.55, noseP: 0.5,
      wS: 122.6, wB: 35.8, wSweep: 27, wTaper: 0.24, wTcR: 0.15, wTcT: 0.11, wCamber: 0.02, wDih: 5, wInc: 2.0, wX: 0.34, wZ: -0.55,
      hS: 31, hB: 12.5, hSweep: 32, hTaper: 0.3, hTc: 0.10, hX: 0.80, hZ: 0.15,
      vS: 21.5, vH: 5.9, vSweep: 38, vTaper: 0.3, vTc: 0.10, vX: 0.78,
      engY: 0.34,
      MTOW: 78000, OEW: 42600, fuelMax: 18700, payload: 15000, fuelFrac: 0.8, cg: 0.25,
    },
    aero: { kappaA: 0.95, clmax: 1.45, dClTO: 0.65, dClLD: 1.15, lamWing: 0.10, lamFus: 0.0, misc: 0.04, Ewd: 2.2, inst: 0.03, gearCD: 0.018, upsweep: true },
    mission: { cruiseH: 11000, cruiseM: 0.78, range: 3000, dash: 0, dashM: 0, climbCAS: 150, ab: false, reserveFrac: 0.06 },
    limits: { Mmo: 0.86, hmax: 12500, nmax: 2.5 },
  },
  interceptor: {
    label: '單發超音速攔截機', en: 'Single-engine supersonic interceptor', engine: 'tj', nEng: 1, internal: true,
    p: {
      fusL: 16.7, fusD: 1.55, nose: 0.28, tail: 0.14, tailUp: 0, noseP: 0.85,
      wS: 22, wB: 7.4, wSweep: 38, wTaper: 0.35, wTcR: 0.045, wTcT: 0.04, wCamber: 0, wDih: -4, wInc: 0, wX: 0.47, wZ: 0.0,
      hS: 5.5, hB: 3.9, hSweep: 38, hTaper: 0.35, hTc: 0.045, hX: 0.80, hZ: -0.45,
      vS: 4.6, vH: 2.7, vSweep: 42, vTaper: 0.35, vTc: 0.05, vX: 0.72,
      engY: 0,
      MTOW: 12000, OEW: 6400, fuelMax: 3500, payload: 800, fuelFrac: 0.9, cg: 0.20,
    },
    aero: { kappaA: 0.87, clmax: 1.05, dClTO: 0.35, dClLD: 0.55, lamWing: 0.05, lamFus: 0.0, misc: 0.08, Ewd: 1.8, inst: 0.05, gearCD: 0.025, upsweep: false },
    mission: { cruiseH: 11000, cruiseM: 0.9, range: 700, dash: 150, dashM: 1.8, climbCAS: 180, ab: true, reserveFrac: 0.08 },
    limits: { Mmo: 2.2, hmax: 18000, nmax: 7.33 },
  },
  fighter: {
    label: '單發多用途戰機', en: 'Single-engine multirole fighter', engine: 'lbtf', nEng: 1, internal: true,
    p: {
      fusL: 15.0, fusD: 1.45, nose: 0.26, tail: 0.13, tailUp: 0, noseP: 0.75,
      wS: 27.9, wB: 9.45, wSweep: 40, wTaper: 0.23, wTcR: 0.04, wTcT: 0.04, wCamber: 0, wDih: 0, wInc: 0, wX: 0.40, wZ: 0.0,
      hS: 5.9, hB: 5.6, hSweep: 40, hTaper: 0.3, hTc: 0.04, hX: 0.80, hZ: -0.4,
      vS: 5.1, vH: 2.6, vSweep: 47, vTaper: 0.4, vTc: 0.05, vX: 0.70,
      engY: 0,
      MTOW: 16800, OEW: 8600, fuelMax: 3200, payload: 1000, fuelFrac: 0.9, cg: 0.30,
    },
    aero: { kappaA: 0.88, clmax: 1.25, dClTO: 0.35, dClLD: 0.55, lamWing: 0.05, lamFus: 0.0, misc: 0.08, Ewd: 1.9, inst: 0.05, gearCD: 0.025, upsweep: false },
    mission: { cruiseH: 10000, cruiseM: 0.85, range: 1100, dash: 150, dashM: 1.6, climbCAS: 180, ab: true, reserveFrac: 0.08 },
    limits: { Mmo: 2.0, hmax: 16500, nmax: 9 },
  },
};
const PANEL_RES = {
  coarse: { nc: 8, ns: 8, nch: 6, nsh: 4, nf: 30, nq: 3, nn: 10, nnx: 12, label: '粗' },
  medium: { nc: 12, ns: 11, nch: 8, nsh: 5, nf: 44, nq: 4, nn: 12, nnx: 16, label: '中' },
  fine: { nc: 16, ns: 14, nch: 10, nsh: 6, nf: 58, nq: 5, nn: 16, nnx: 20, label: '細' },
  display: { nc: 24, ns: 26, nch: 14, nsh: 9, nf: 120, nq: 7, nn: 36, nnx: 40, label: '顯示' },
};

/* ---------- 翼型：NACA 四位數（閉合後緣）＋弧線 ---------- */
function nacaT(t, x) { x = Math.max(0, Math.min(1, x)); return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4); }
function nacaC(m, x, p = 0.4) { if (!m) return 0; return x < p ? m / (p * p) * (2 * p * x - x * x) : m / ((1 - p) ** 2) * ((1 - 2 * p) + 2 * p * x - x * x); }
const cosDist = (n, k) => 0.5 * (1 - Math.cos(Math.PI * k / n));

/* ---------- 機身外形 ---------- */
function makeFuselage(p, endR) {
  const L = p.fusL, R0 = p.fusD / 2, Ln = p.nose * L, Lt = p.tail * L, xt0 = L - Lt;
  const Re = Math.min(endR, R0 * 0.95);
  const R = x => {
    if (x <= 0) return 0;
    if (x < Ln) { const s = 1 - x / Ln; return R0 * Math.pow(Math.max(0, 1 - s * s), p.noseP); }
    if (x <= xt0) return R0;
    if (x >= L) return Re;
    const t = (x - xt0) / Lt; return Re + (R0 - Re) * 0.5 * (1 + Math.cos(Math.PI * t));
  };
  const zc = x => x <= xt0 ? 0 : p.tailUp * R0 * ((x - xt0) / Lt) ** 2;
  return { L, R0, Ln, Lt, xt0, Re, R, zc };
}

/* ---------- 升力面（翼、平尾：左右對稱；垂尾：對稱面上） ---------- */
function makeSurface(o) {
  // o: { S, b（全展或垂尾高度 h）, sweep, taper, tcR, tcT, camber, dih, inc, x0（中心線處根部前緣 x）, z0, vertical }
  const vertical = !!o.vertical;
  const semi = vertical ? o.b : o.b / 2;
  const cr = vertical ? 2 * o.S / (o.b * (1 + o.taper)) : 2 * o.S / (o.b * (1 + o.taper));
  const ct = cr * o.taper, tanL = Math.tan(o.sweep * Math.PI / 180), tanD = Math.tan((o.dih || 0) * Math.PI / 180), tanI = Math.tan((o.inc || 0) * Math.PI / 180);
  const chord = s => cr + (ct - cr) * s / semi;
  const xLE = s => o.x0 + s * tanL;
  const tc = s => o.tcR + (o.tcT - o.tcR) * s / semi;
  const mac = (2 / 3) * cr * (1 + o.taper + o.taper ** 2) / (1 + o.taper);
  const sMac = semi / 3 * (1 + 2 * o.taper) / (1 + o.taper);
  // 局部點：展向位置 s（翼：y；垂尾：z 相對根部），弦向 xc，上(+1)/下(−1)
  const pt = (s, xc, side, sAtt, tipZero) => {
    const c = chord(s), x = xLE(s) + xc * c;
    let th = nacaT(tc(s), xc) * c; if (tipZero) th = 0;
    const cam = nacaC(o.camber || 0, xc) * c;
    const shear = -(xc - 0.25) * c * tanI;
    if (vertical) return [x, side * th, o.z0 + s + 0 * cam];
    const z = o.z0 + (s - (sAtt || 0)) * tanD + cam + shear + side * th;
    return [x, s, z];
  };
  return { o, vertical, semi, cr, ct, tanL, chord, xLE, tc, mac, sMac, xMac: xLE(sMac), pt,
    S: o.S, A: vertical ? o.b * o.b / o.S : o.b * o.b / o.S, sweepLE: o.sweep,
    sweepAt: f => Math.atan(tanL - 4 / (vertical ? 2 * semi : 2 * semi) * f * (1 - o.taper) / (1 + o.taper) * (vertical ? 0.5 : 1)) };
}

/* ============================================================
 *  組裝機型
 *  type、p（參數，可覆寫預設）、eng（{ spec, s, r9 }：引擎幾何，spec 為 geometry.js 輸出）
 * ============================================================ */
function buildAircraft(type, p, eng) {
  const T = AIRCRAFT_TYPES[type];
  p = Object.assign({}, T.p, p || {});
  const spec = eng.spec;
  // 內置引擎：機身直徑至少容納引擎、尾端半徑 = 引擎噴嘴外緣
  let endR = 0.06 * p.fusD / 2;
  if (T.internal) {
    const casR = Math.max(...spec.outer.pts.map(q => q[1]));
    p.fusD = Math.max(p.fusD, 2 * (casR + 0.06));
    endR = spec.outer.at(spec.outerEnd) + 0.01;
  }
  const fus = makeFuselage(p, endR);
  const R0 = fus.R0;
  // 翼：中心線根部前緣 x、根部高度
  const wing = makeSurface({ S: p.wS, b: p.wB, sweep: p.wSweep, taper: p.wTaper, tcR: p.wTcR, tcT: p.wTcT, camber: p.wCamber, dih: p.wDih, inc: p.wInc, x0: p.wX * fus.L, z0: p.wZ * R0 });
  const hx0 = p.hX * fus.L, hz0 = fus.zc(hx0 + 1) + p.hZ * fus.R(hx0 + 1);
  const htail = makeSurface({ S: p.hS, b: p.hB, sweep: p.hSweep, taper: p.hTaper, tcR: p.hTc, tcT: p.hTc, camber: 0, dih: 0, inc: 0, x0: hx0, z0: hz0 });
  const vx0 = p.vX * fus.L;
  const vtail = makeSurface({ S: p.vS, b: p.vH, sweep: p.vSweep, taper: p.vTaper, tcR: p.vTc, tcT: p.vTc, vertical: true, x0: vx0, z0: 0 });
  // 垂尾根部：機身頂線高度（取根弦中點）
  const vxm = vx0 + 0.5 * vtail.cr;
  vtail.o.z0 = fus.zc(vxm) + fus.R(vxm) * 0.85;
  // 引擎安裝
  const engines = [];
  if (T.internal) {
    const xLip = fus.L - spec.outerEnd;
    engines.push({ x0: xLip, y: 0, z: 0, s: 1, internal: true });
  } else {
    const ye = p.engY * wing.semi;
    const Lnac = spec.outerEnd, Rn = spec.view.Rmax;
    const xLip = wing.xLE(ye) - Lnac + 0.35 * wing.chord(ye) * 0.25;
    const zw = wing.pt(ye, 0.02, -1, R0)[2];
    engines.push({ x0: xLip, y: ye, z: zw - Rn - 0.28, s: 1, internal: false, Lnac, Rn });
  }
  // 參考量（翼面積含機身內延伸）
  const xcg = wing.xMac + p.cg * wing.mac;
  const ac = {
    type, T, p, fus, wing, htail, vtail, engines, spec,
    ref: { S: p.wS, b: p.wB, c: wing.mac, A: p.wB * p.wB / p.wS, xcg, zcg: 0, xMac: wing.xMac, yMac: wing.sMac },
  };
  ac.mass = {
    OEW: p.OEW, payload: p.payload, fuelMax: p.fuelMax,
    fuel: p.fuelMax * p.fuelFrac, W: Math.min(p.MTOW, p.OEW + p.payload + p.fuelMax * p.fuelFrac), MTOW: p.MTOW,
  };
  return ac;
}

/* ---------- 根部接合：節點投影到機身圓截面 ---------- */
function onFus(fus, x, z, side) {
  const R = fus.R(x), zc = fus.zc(x);
  let dz = z - zc; const lim = 0.94 * R;
  if (Math.abs(dz) > lim) dz = Math.sign(dz) * lim;
  return [x, Math.sqrt(Math.max(0, R * R - dz * dz)), zc + dz];
}

/* ============================================================
 *  面元網格（半模 y ≥ 0）
 * ============================================================ */
function aircraftPanels(ac, resKey, wakeAng) {
  const res = PANEL_RES[resKey] || PANEL_RES.medium, fus = ac.fus;
  const set = new PanelSet();
  const wA = wakeAng !== undefined ? wakeAng : (ac.wing.o.z0 < -0.3 * fus.R0 ? 0 : 2);
  set.wakeAng = wA;
  const tw = Math.tan(wA * Math.PI / 180);
  const nodesOf = [];
  // ---- 升力面（翼、平尾）----
  const liftSurf = (S, nc, ns, comp) => {
    const sAtt = fus.R((S.xLE(fus.R0) + S.xLE(fus.R0) + S.chord(fus.R0)) / 2) * 0.98;
    const sA = Math.min(sAtt, S.semi * 0.5);
    const nodes = [];
    for (let i = 0; i <= 2 * nc; i++) {
      const k = i <= nc ? nc - i : i - nc, up = i >= nc ? 1 : -1, xc = cosDist(nc, k);
      const row = [];
      for (let j = 0; j <= ns; j++) {
        const s = sA + (S.semi - sA) * Math.sin(0.5 * Math.PI * j / ns);
        let q = S.pt(s, xc, up, sA, j === ns);
        if (j === 0) q = onFus(fus, q[0], q[2]);
        row.push(q);
      }
      nodes.push(row);
    }
    const te = []; for (let j = 0; j < ns; j++) te.push({ up: [2 * nc - 1, j], lo: [0, j], a: nodes[2 * nc][j], b: nodes[2 * nc][j + 1] });
    // 附著機身的尾跡：根部條帶內緣沿機身表面向內收，機身收窄後直達對稱面（根部不脫出集中渦）
    {
      const r0 = nodes[2 * nc][0], xT = r0[0], yT = r0[1], zT = r0[2];
      const zw = x => zT + (x - xT) * tw;
      const yin = x => { const R = fus.R(x), dz = zw(x) - fus.zc(x); return x >= fus.L ? 0 : Math.sqrt(Math.max(0, R * R - dz * dz)); };
      const xs = []; const nseg = 14; for (let k = 0; k <= nseg; k++) xs.push(xT + (Math.max(fus.L, xT) - xT) * k / nseg);
      xs.push(fus.L + 1e-3); xs.push(fus.L + 200);
      for (let k = 0; k < xs.length - 1; k++) {
        const x0 = xs[k], x1 = xs[k + 1], y0 = Math.min(yT, yin(x0)), y1 = Math.min(yT, yin(x1));
        if (yT - y0 < 1e-4 && yT - y1 < 1e-4) continue;
        te.push({ up: [2 * nc - 1, 0], lo: [0, 0], inner: true, quad: [[x0, y0, zw(x0)], [x1, y1, zw(x1)], [x1, yT, zw(x1)], [x0, yT, zw(x0)]] });
      }
    }
    set.addPatch({ name: comp, comp, nodes, te });
    // 根部曲線（供機身開孔）：各弦向節點的 x、上下 z
    const root = []; for (let k = 0; k <= nc; k++) root.push({ x: nodes[nc + k][0][0], zu: nodes[nc + k][0][2], zl: nodes[nc - k][0][2] });
    return { nodes, root, sA };
  };
  // 薄翼（t/c < 7%）增加弦向面元，使前緣吸力峰解析較佳
  const thin = ac.wing.o.tcR < 0.07, ncW = thin ? Math.round(res.nc * 1.35) : res.nc, ncH = ac.htail.o.tcR < 0.07 ? Math.round(res.nch * 1.25) : res.nch;
  const W = liftSurf(ac.wing, ncW, res.ns, 'wing');
  const H = liftSurf(ac.htail, ncH, res.nsh, 'htail');
  // ---- 垂尾（對稱面上，只右側表面）----
  const V = (() => {
    const S = ac.vtail, nc = res.nch, ns = res.nsh, nodes = [];
    const zRoot = x => fus.zc(x) + fus.R(x);
    for (let i = 0; i <= nc; i++) {
      const xc = cosDist(nc, i), row = [];
      for (let j = 0; j <= ns; j++) {
        const s = S.semi * Math.sin(0.5 * Math.PI * j / ns) * (1 - 0) ;
        let q = S.pt(s, xc, 1, 0, j === ns);
        if (j === 0) { // 根部落在機身頂部：y = 半厚度，z 取機身表面
          const R = fus.R(q[0]), y = Math.min(q[1], 0.9 * R); q = [q[0], y, fus.zc(q[0]) + Math.sqrt(Math.max(0, R * R - y * y))];
        } else q[2] = Math.max(q[2], zRoot(q[0]) + 0.02) + 0 * s;
        row.push(q);
      }
      nodes.push(row);
    }
    set.addPatch({ name: 'vtail', comp: 'vtail', nodes, flip: true });
    const root = []; for (let k = 0; k <= nc; k++) root.push({ x: nodes[k][0][0], yt: nodes[k][0][1] });
    return { nodes, root };
  })();
  // ---- 機身（含翼、平尾、垂尾根部開孔）----
  {
    const L = fus.L, xs = new Set();
    const addRange = (a, b, n, f) => { for (let k = 0; k <= n; k++) xs.add(+(a + (b - a) * f(k / n)).toFixed(6)); };
    addRange(0, fus.Ln, Math.round(res.nf * 0.22), t => 1 - Math.cos(0.5 * Math.PI * t));
    addRange(fus.Ln, L, Math.round(res.nf * 0.55), t => t);
    addRange(fus.xt0, L, Math.round(res.nf * 0.2), t => t);
    for (const r of W.root) xs.add(+r.x.toFixed(6));
    for (const r of H.root) xs.add(+r.x.toFixed(6));
    for (const r of V.root) xs.add(+r.x.toFixed(6));
    let X = [...xs].sort((a, b) => a - b);
    // 合併過近站位（保留根部節點）
    const keep = new Set([...W.root, ...H.root, ...V.root].map(r => +r.x.toFixed(6)));
    { // 合併過近站位：根部節點優先保留
      const out = [];
      for (const x of X) {
        const last = out[out.length - 1];
        if (last === undefined || x - last > 0.006 * L) { out.push(x); continue; }
        if (keep.has(x) && !keep.has(last)) out[out.length - 1] = x; // 以根部節點取代非根部站位
        else if (keep.has(x) && keep.has(last)) out.push(x);
      }
      X = out;
    }
    const hasBase = fus.Re > 1e-3;
    const interpRoot = (root, x) => { // 根部上下 z：以根部節點線性內插
      if (x < root[0].x - 1e-5 || x > root[root.length - 1].x + 1e-5) return null;
      for (let k = 0; k < root.length - 1; k++) if (x <= root[k + 1].x + 1e-9) { const t = (x - root[k].x) / Math.max(1e-12, root[k + 1].x - root[k].x); return { zu: root[k].zu + (root[k + 1].zu - root[k].zu) * t, zl: root[k].zl + (root[k + 1].zl - root[k].zl) * t, yt: root[k].yt !== undefined ? root[k].yt + (root[k + 1].yt - root[k].yt) * t : 0 }; }
      return null;
    };
    const ang = (x, z) => { const R = fus.R(x), dz = Math.max(-0.999 * R, Math.min(0.999 * R, z - fus.zc(x))); return Math.asin(dz / Math.max(R, 1e-9)); };
    // 附著面依平均角度排序
    const att = [{ k: 'w', root: W.root }, { k: 'h', root: H.root }].map(a => { const m = a.root[Math.floor(a.root.length / 2)]; return { ...a, th: ang(m.x, 0.5 * (m.zu + m.zl)) }; }).sort((a, b) => a.th - b.th);
    const nq = res.nq;
    // 每站角度列表
    const thetaRow = x => {
      const lines = [];
      for (const a of att) {
        const r = interpRoot(a.root, x);
        let lo, hi;
        if (r) { lo = ang(x, r.zl); hi = ang(x, r.zu); }
        else if (x < a.root[0].x) { lo = hi = ang(x, a.root[0].zu); }
        else { // 後緣之後：沿尾跡與機身交線（尾跡以 wakeAng 上仰），使格線與位勢跳躍線重合
          const e = a.root[a.root.length - 1], zw = e.zu + (x - e.x) * tw;
          lo = hi = ang(x, zw);
          // 尾跡即將離開機身（交線接近對稱面）：直接併入對稱面，避免產生細長面元
          if (Math.abs(lo) > Math.PI / 2 - 0.21) lo = hi = Math.sign(lo) * Math.PI / 2;
        }
        lines.push(lo, hi);
      }
      const rv = interpRoot(V.root, x); const R = Math.max(fus.R(x), 1e-9);
      const thv = rv ? Math.acos(Math.min(0.999, rv.yt / R)) : Math.PI / 2;
      let th = [-Math.PI / 2];
      // 底部 → 第一條線
      const segs = [[-Math.PI / 2, lines[0], nq]];
      for (let q = 0; q < lines.length - 1; q++) segs.push([lines[q], lines[q + 1], q % 2 === 0 ? 1 : nq]);
      segs.push([lines[lines.length - 1], thv, nq + 1]);
      segs.push([thv, Math.PI / 2, 1]);
      // 單調化
      let prev = -Math.PI / 2;
      for (const s of segs) { s[0] = Math.max(s[0], prev); s[1] = Math.max(s[1], s[0]); prev = s[1]; }
      th = [];
      for (const [a, b, n] of segs) for (let k = (th.length ? 1 : 0); k <= n; k++) th.push(a + (b - a) * k / n);
      return th;
    };
    // 孔洞欄位（在 th 陣列中的區段索引）
    const cols = []; { let c = 0; cols.push({ start: 0, n: nq, hole: null }); c += nq; for (let q = 0; q < att.length * 2 - 1; q++) { const n = q % 2 === 0 ? 1 : nq; cols.push({ start: c, n, hole: q % 2 === 0 ? att[q / 2].k : null }); c += n; } cols.push({ start: c, n: nq + 1, hole: null }); c += nq + 1; cols.push({ start: c, n: 1, hole: 'v' }); }
    const rows = X.map(x => thetaRow(x));
    const nth = rows[0].length;
    const nodes = X.map((x, i) => rows[i].map(t => { const R = fus.R(x), zc = fus.zc(x); return [x, R * Math.cos(t), zc + R * Math.sin(t)]; }));
    if (hasBase) nodes.push(Array.from({ length: nth }, () => [L, 0, fus.zc(L)]));
    const ni = nodes.length - 1, nj = nth - 1, state = [];
    const inRoot = (root, x0, x1) => x0 >= root[0].x - 1e-5 && x1 <= root[root.length - 1].x + 1e-5;
    for (let i = 0; i < ni; i++) {
      const st = new Int8Array(nj).fill(1);
      const x0 = nodes[i][0][0], x1 = nodes[i + 1][0][0];
      for (const c of cols) if (c.hole) {
        const root = c.hole === 'w' ? W.root : c.hole === 'h' ? H.root : V.root;
        const inside = inRoot(root, x0, x1) && x1 > x0;
        for (let j = c.start; j < c.start + c.n; j++) {
          // 退化（寬度為零）則略過；在根部範圍內為孔洞
          const w0 = Math.hypot(nodes[i][j + 1][1] - nodes[i][j][1], nodes[i][j + 1][2] - nodes[i][j][2]), w1 = Math.hypot(nodes[i + 1][j + 1][1] - nodes[i + 1][j][1], nodes[i + 1][j + 1][2] - nodes[i + 1][j][2]);
          // 升力面後緣之後：尾跡穿過機身，機身表面位勢在此線兩側不連續 → 作為梯度屏障
          const behindTE = c.hole !== 'v' && x0 >= root[root.length - 1].x - 1e-5;
          st[j] = inside ? -1 : (w0 < 1e-9 && w1 < 1e-9 ? (behindTE ? -2 : 0) : 1);
        }
      }
      state.push(st);
    }
    const vnBase = hasBase ? (i => i === ni - 1 ? 1 : 0) : null;
    set.addPatch({ name: 'fus', comp: 'fus', nodes, state, flip: true, vn: hasBase ? ((i, j) => (i === ni - 1 ? 1 : 0)) : null });
  }
  // ---- 短艙（旋轉體：進氣面、外罩、外涵出口面、核心整流罩、核心出口面、尾錐）----
  for (const e of ac.engines) if (!e.internal) {
    const sp = ac.spec, mer = [];
    const nx = res.nnx;
    const hub = sp.lines.hub, cowl = sp.lines.cowl, nacOut = sp.lines.nacOut;
    const lip = sp.lip, xB = sp.outerEnd, exB = sp.exitsGeom[0], exC = sp.exitsGeom[1];
    const addLine = (f, a, b, n) => { for (let k = 1; k <= n; k++) { const x = a + (b - a) * k / n; mer.push([x, f(x)]); } };
    mer.push([lip.x, 0]); mer.push([lip.x, lip.r * 0.5]); mer.push([lip.x, lip.r]); mer.push([lip.x + 0.02 * xB, lip.rOut]);
    addLine(x => nacOut.at(x), lip.x + 0.02 * xB, xB, Math.round(nx * 0.55));
    const kB0 = mer.length - 1; mer.push([xB, 0.5 * (exB.R + exB.Rin)]); mer.push([xB, cowl.at(xB)]); const kB1 = mer.length - 1;
    addLine(x => cowl.at(x), xB, exC.x, Math.round(nx * 0.25));
    const kC0 = mer.length - 1; mer.push([exC.x, hub.at(exC.x)]); const kC1 = mer.length - 1;
    addLine(x => hub.at(x), exC.x, exC.plugTip || exC.x + 0.3, Math.round(nx * 0.2));
    mer[mer.length - 1][1] = 0;
    const nps = res.nn, nodes = [];
    for (let i = 0; i <= nps; i++) {
      const ps = 2 * Math.PI * i / nps, row = [];
      for (const [x, r] of mer) row.push([e.x0 + x, e.y + r * Math.cos(ps), e.z + r * Math.sin(ps)]);
      nodes.push(row);
    }
    // 穿透速度（相對 V∞）：進氣面吸入、外涵與核心出口吐出（體積通量守恆）
    const Aface = Math.PI * lip.r ** 2, AB = Math.PI * (exB.R ** 2 - exB.Rin ** 2), AC = Math.PI * (exC.R ** 2 - exC.Rin ** 2);
    const vin = 0.65, fB = 0.82, vB = vin * Aface * fB / AB, vC = vin * Aface * (1 - fB) / AC;
    const vn = (i, j) => j <= 1 ? -vin : (j >= kB0 && j < kB1 ? vB : (j >= kC0 && j < kC1 ? vC : 0));
    set.addPatch({ name: 'nac', comp: 'nac', nodes, wrapI: true, vn, flip: false });
    e.meridian = mer;
  }
  return set;
}
/* ============================================================
 *  濕面積（全機）、截面積分布 A(x)、各組件參考長度
 * ============================================================ */
function aircraftAreas(ac, set) {
  const Sw = {}; for (const p of set.P) Sw[p.comp] = (Sw[p.comp] || 0) + 2 * p.A;
  // 內置引擎之機身尾端基底面不算濕面積
  if (ac.T.internal) { const b = Math.PI * ac.fus.Re ** 2; Sw.fus = Math.max(0, (Sw.fus || 0) - b); }
  const nx = 120, L = ac.fus.L, xs = [], Ax = [];
  const x0 = Math.min(0, ...ac.engines.map(e => e.x0)), x1 = Math.max(L, ac.htail.xLE(ac.htail.semi) + ac.htail.ct, ac.vtail.xLE(ac.vtail.semi) + ac.vtail.ct);
  for (let k = 0; k <= nx; k++) {
    const x = x0 + (x1 - x0) * k / nx;
    let A = Math.PI * ac.fus.R(x) ** 2;
    const slab = (S, full) => { // 翼截面：Σ 厚度·dy（兩側）
      let a = 0; const n = 40;
      for (let q = 0; q < n; q++) {
        const s = (q + 0.5) / n * S.semi, xl = S.xLE(s), c = S.chord(s);
        if (x < xl || x > xl + c) continue;
        a += 2 * nacaT(S.tc(s), (x - xl) / c) * c * S.semi / n;
      }
      return a * (full ? 2 : 1);
    };
    A += slab(ac.wing, true) + slab(ac.htail, true) + slab(ac.vtail, false);
    for (const e of ac.engines) if (!e.internal && e.meridian) {
      const xe = x - e.x0; if (xe >= 0 && xe <= e.meridian[e.meridian.length - 1][0]) { let r = 0; for (let q = 0; q < e.meridian.length - 1; q++) { const [xa, ra] = e.meridian[q], [xb, rb] = e.meridian[q + 1]; if (xe >= xa && xe <= xb && xb > xa) r = Math.max(r, ra + (rb - ra) * (xe - xa) / (xb - xa)); } A += 2 * Math.PI * r * r; }
    }
    xs.push(x); Ax.push(A);
  }
  const Amax = Math.max(...Ax), lenA = x1 - x0;
  return { Sw, xs, Ax, Amax, lenA };
}

if (typeof module !== 'undefined') module.exports = { AIRCRAFT_TYPES, PANEL_RES, buildAircraft, aircraftPanels, aircraftAreas, nacaT, nacaC, makeFuselage, makeSurface };
