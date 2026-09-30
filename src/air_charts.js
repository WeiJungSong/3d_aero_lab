/* ============================================================
 *  air_charts.js — EICAS 表盤、數值、警示、分析圖（阻力分解、翼面 Cp、推力／阻力、包線、任務）
 * ============================================================ */
const INK2 = '#a8b4c0', INK3 = '#6f8091', GRIDC = '#1f2c39';
const axisFont = g => { g.font = '11px "B612 Mono", ui-monospace, monospace'; };
const uiFont = g => { g.font = '11px "Noto Sans TC", "PingFang TC", sans-serif'; };
function chartH(k) { const w = window.innerWidth; const base = w < 760 ? 220 : w < 1180 ? 250 : 290; return Math.round(base * (k || 1)); }
function setupCanvas(box, hCss) {
  const cv = box.querySelector('canvas'), dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = box.clientWidth || 400, H = hCss;
  cv.style.height = H + 'px';
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  return { g, W, H };
}
function drawDial(cv, v, o) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = 128, H = 92;
  if (cv.width !== W * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const cx = 44, cy = 54, R = 32, a0 = 150 * DEG, sweep = 210 * DEG;
  const ang = val => a0 + sweep * clamp((val - o.min) / (o.max - o.min), 0, 1);
  g.fillStyle = 'rgba(226,232,238,0.13)'; g.beginPath(); g.moveTo(cx, cy); g.arc(cx, cy, R, a0, ang(v)); g.closePath(); g.fill();
  g.lineWidth = 2; g.strokeStyle = '#e2e8ee'; g.beginPath(); g.arc(cx, cy, R, a0, ang(o.amber)); g.stroke();
  g.strokeStyle = '#f3b43f'; g.beginPath(); g.arc(cx, cy, R, ang(o.amber), ang(o.red)); g.stroke();
  g.strokeStyle = '#f25a4f'; g.lineWidth = 3; const ar = ang(o.red); g.beginPath(); g.moveTo(cx + (R - 6) * Math.cos(ar), cy + (R - 6) * Math.sin(ar)); g.lineTo(cx + (R + 5) * Math.cos(ar), cy + (R + 5) * Math.sin(ar)); g.stroke();
  if (o.ref != null) { const ac = ang(o.ref); g.strokeStyle = '#d882e6'; g.lineWidth = 2; g.beginPath(); g.moveTo(cx + (R + 2) * Math.cos(ac), cy + (R + 2) * Math.sin(ac)); g.lineTo(cx + (R + 9) * Math.cos(ac), cy + (R + 9) * Math.sin(ac)); g.stroke(); }
  const an = ang(v); g.strokeStyle = '#fff'; g.lineWidth = 2.2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + (R - 2) * Math.cos(an), cy + (R - 2) * Math.sin(an)); g.stroke();
  const col = v >= o.red ? '#f25a4f' : v >= o.amber ? '#f3b43f' : '#e2e8ee';
  g.strokeStyle = col; g.lineWidth = 1.2; g.strokeRect(70.5, 4.5, 54, 21);
  g.fillStyle = col; g.font = '15px "B612 Mono", monospace'; g.textAlign = 'right'; g.textBaseline = 'middle'; g.fillText(o.fmt(v), 121, 15.5);
}

/* ---------- 性能計算（包線、任務、推力阻力曲線；背景） ---------- */
const PF = { env: null, envKey: '', mis: null, misKey: '', td: null, tdKey: '', timer: 0, envProg: 1 };
function invalidatePerf(all) { PF.misKey = ''; if (all) { PF.envKey = ''; PF.tdKey = ''; } clearTimeout(PF.timer); PF.timer = setTimeout(runPerf, 300); }
function runPerf() {
  const ctx = CUR.ctx, ac = CUR.ac; if (!ctx || !ac) return;
  const W = weight(), abE = ac.T.internal;
  ac.mass.payload = S.payload; ac.mass.fuel = S.fuelFrac * ac.mass.fuelMax; ac.mass.W = W;
  const mk = CUR.geomKey + '|' + Math.round(W) + '|' + JSON.stringify(S.mis) + '|' + S.payload;
  if (PF.misKey !== mk) { PF.misKey = mk; try { PF.mis = ctx.mission(Object.assign({}, S.mis), W); } catch (e) { PF.mis = null; } drawMission(); }
  const ek = CUR.geomKey + '|' + Math.round(W / 50) + '|' + abE;
  if (PF.envKey !== ek) {
    PF.envKey = ek; PF.envProg = 0;
    ctx.envelope(W, abE, 26, 40, p => { PF.envProg = p; if (p < 1) updateSolverBar(); }).then(env => { if (PF.envKey !== ek) return; PF.env = env; PF.envProg = 1; drawEnv(); updateSolverBar(); });
  }
}
function tdCurves() {
  const ctx = CUR.ctx, ac = CUR.ac, W = weight(), key = CUR.geomKey + [S.h, Math.round(W), S.flaps, S.gear, S.n, S.ab].join('|');
  if (PF.tdKey === key && PF.td) return PF.td;
  const Mtop = ac.T.internal ? Math.min(2.4, ac.T.limits.Mmo + 0.2) : 0.95, pts = [];
  for (let i = 0; i <= 56; i++) {
    const M = 0.1 + (Mtop - 0.1) * i / 56;
    const r = ctx.point(S.h, M, W, { thr: 1, ab: false, n: S.n, flaps: S.flaps, gear: S.gear });
    const Tab = ac.T.internal ? ctx.thrust(S.h, M, 1, true).T : null;
    pts.push({ M, D: r.D, T: r.T, Tab, stall: r.stall, CL: r.CL, CD: r.CD });
  }
  PF.td = pts; PF.tdKey = key; return pts;
}

/* ============================================================
 *  EICAS 面板
 * ============================================================ */
let panelT = 0;
function updatePanels(force) {
  const R = CUR.R; if (!R) return;
  const now = performance.now();
  const ac = CUR.ac, T = ac.T, et = ac.spec.type, r = R.r, op = R.op, fs = R.fs;
  // 表盤
  const dials = $('#dials'), want = et === 'tj' ? ['N', 'EGT'] : ['N1', 'N2', 'EGT'];
  if (dials.dataset.k !== want.join()) { dials.innerHTML = ''; dials.dataset.k = want.join(); for (const k of want) dials.append(el('div', { class: 'dial' }, el('canvas', { 'data-d': k }), el('span', null, k === 'EGT' ? 'EGT（Tt5）°C' : k === 'FF' ? '燃油流量 t/h' : k + ' %'))); }
  const cv = k => dials.querySelector(`canvas[data-d="${k}"]`);
  const N = op.N || {};
  const dN = (k, key) => drawDial(cv(k), (N[key] || 0) * 100, { min: 0, max: 110, amber: 100.5, red: 105, fmt: v => v.toFixed(1) });
  if (et === 'tj') dN('N', 'HP'); else { dN('N1', 'LP'); dN('N2', 'HP'); }
  const egtRef = CUR.deck.ref.Tt5 - 273.15, egt = (op.op.Tt5 || 0) - 273.15;
  drawDial(cv('EGT'), egt, { min: 0, max: Math.ceil((egtRef + 160) / 100) * 100, amber: egtRef + 20, red: egtRef + 60, fmt: v => v.toFixed(0) });
  // 數值
  const tiles = [];
  const kt = v => v * 1.94384;
  if (r && !R.static) {
    const cnt = v => fmtN(v * 1e4);
    const dd = r.drag;
    tiles.push({ k: '攻角 α（配平）', v: `${fmtS(R.alpha, 2)}<small>°</small>`, x: `平尾偏轉 δ ${fmtS(R.delta, 2)}°`, cls: R.stall ? 'warn' : 'hero' });
    tiles.push({ k: '升力係數 C<sub>L</sub>', v: r.CL.toFixed(3), x: `${fmtN(r.CL / r.CLmax * 100)} % C<sub>L,max</sub> · V<sub>s</sub> ${fmtN(kt(r.Vs))} kt`, cls: R.stall ? 'warn' : '' });
    tiles.push({ k: '阻力係數 C<sub>D</sub>', v: `${cnt(r.CD)}<small>counts</small>`, x: `零升 ${cnt(dd.CD0)} · 升力 ${cnt(dd.CDi)} · 波 ${cnt(dd.CDw)}` });
    tiles.push({ k: '升阻比 L/D', v: r.LD.toFixed(1), x: `展向效率 e ${R.e ? R.e.toFixed(3) : '—'}` });
    tiles.push({ k: '阻力 D', v: `${fmtN(r.D / 1000, 1)}<small>kN</small>`, x: `推力 T ${fmtN(r.T / 1000, 1)} kN`, cls: r.T < r.D * 0.995 ? 'warn' : '' });
    tiles.push({ k: '油門', v: `${fmtN(Math.min(1, r.thr) * 100, 1)}<small>%</small>`, x: `Tt4 ${fmtN(op.Tt4)} K${op.limited ? ' · 轉速限制' : ''}${r.ab ? ' · 後燃' : ''}` });
    tiles.push({ k: '比剩餘功率 P<sub>s</sub>', v: `${fmtS(r.Ps, 1)}<small>m/s</small>`, x: `${fmtS(r.Ps * 196.85, 0)} ft/min`, cls: r.Ps < -0.5 ? 'warn' : '' });
  } else {
    tiles.push({ k: '攻角 α', v: '—', x: '地面靜止：無氣動負載', cls: 'hero' });
    tiles.push({ k: '推力（靜態）', v: `${fmtN(op.F * T.nEng * (1 - T.aero.inst) / 1000, 1)}<small>kN</small>`, x: `${T.nEng} 具` });
  }
  tiles.push({ k: '真空速 TAS', v: `${fmtN(fs.V)}<small>m/s</small>`, x: `CAS ${fmtN(kt(casFromTas(fs.V, S.h)))} kt` });
  tiles.push({ k: '外界靜溫 SAT', v: `${fmtS(fs.T - 273.15, 1)}<small>°C</small>`, x: `TAT ${fmtS(fs.Tt - 273.15, 1)} °C · ${fmtN(fs.P / 1000, 1)} kPa` });
  tiles.push({ k: '動壓 q', v: `${fmtN(fs.q / 1000, 2)}<small>kPa</small>`, x: `Re<sub>MAC</sub> ${(fs.rho * fs.V * ac.ref.c / fs.mu / 1e6).toFixed(1)}×10⁶` });
  if (r && !R.static) tiles.push({ k: '燃油流量', v: `${fmtN(r.ff * 3600)}<small>kg/h</small>`, x: `TSFC ${fmtN(r.sfc * 1e6, 1)} g/(kN·s) · ${fmtN(r.SR / 1000, 3)} km/kg` });
  tiles.push({ k: '靜穩定裕度', v: R.SM != null ? `${fmtS(R.SM * 100, 1)}<small>% MAC</small>` : '—', x: R.tr ? `C<sub>Lα</sub> ${R.tr.CLa.toFixed(2)} /rad · C<sub>mα</sub> ${R.tr.Cma.toFixed(2)}` : '', cls: R.SM != null && R.SM < 0.03 ? 'warn' : '' });
  tiles.push({ k: '總重', v: `${fmtN(R.W / 1000, 2)}<small>t</small>`, x: `燃油 ${fmtN(S.fuelFrac * ac.mass.fuelMax)} kg`, cls: R.W > ac.mass.MTOW ? 'warn' : '' });
  $('#nums').innerHTML = tiles.slice(0, 12).map(t => `<div class="nm ${t.cls || ''}"><div class="k">${t.k}</div><div class="v">${t.v}</div><div class="x">${t.x}</div></div>`).join('');
  $('#warnbar').innerHTML = R.warn.map(w => `<div>⚠ ${w}</div>`).join('');
  const chips = [];
  if (R.cpMode === 'li') chips.push(['info', '表面 Cp：超音速局部傾角法']);
  else if (R.cpMode === 'blend') chips.push(['warn', '跨音速：面元法與局部傾角法內插']);
  else chips.push(['ok', `面元法 · Göthert M ${CUR.pa ? CUR.pa.Mp.toFixed(2) : '—'}`]);
  if (R.stall) chips.push(['crit', '超過 C<sub>L,max</sub>（失速）']);
  if (r && r.ab) chips.push(['warn', '後燃器點燃']);
  if (S.flaps !== 'up') chips.push(['info', S.flaps === 'to' ? '襟翼：起飛' : '襟翼：降落']);
  if (S.mode === 'cfd') chips.push(['info', '3D CFD 對照模式']);
  $('#chips').innerHTML = chips.map(([c, t]) => `<span class="chip ${c}"><i></i>${t}</span>`).join('');
  updateSolverBar();
  if (CUR.lastProbe && !CUR.hovering) showProbe(CUR.pin, false);
  if (force || now - panelT > 140) { panelT = now; drawDrag(); drawCp(); }
  if (force && !dragging) { drawTD(); if (PF.env) drawEnv(); drawMission(); }
}
function warnings(R) {
  const w = R.warn, ac = CUR.ac, T = ac.T, r = R.r;
  if (R.W > ac.mass.MTOW) w.push(`總重 ${fmtN(R.W)} kg 超過最大起飛重量 ${fmtN(ac.mass.MTOW)} kg`);
  if (S.M > T.limits.Mmo) w.push(`馬赫數超過最大操作馬赫數 M<sub>MO</sub> ${T.limits.Mmo.toFixed(2)}`);
  if (S.h > T.limits.hmax) w.push(`高度超過最大操作高度 ${fmtN(T.limits.hmax)} m`);
  if (r && R.stall) w.push(`所需升力係數 ${r.CL.toFixed(2)} 超過 C<sub>L,max</sub> ${r.CLmax.toFixed(2)}：此速度與負載因數下失速；配平以 C<sub>L,max</sub> 計`);
  if (r && S.thrMode === 'level' && r.T < r.D * 0.995) w.push(`最大可用推力 ${fmtN(r.T / 1000, 1)} kN 低於阻力 ${fmtN(r.D / 1000, 1)} kN：無法維持平飛（P<sub>s</sub> ${fmtN(r.Ps, 1)} m/s）`);
  if (R.tr && !R.tr.ok) w.push('配平迭代未完全收斂');
  if (R.tr && Math.abs(R.delta) > 20) w.push(`平尾偏轉 ${R.delta.toFixed(1)}° 超出 ±20° 範圍`);
  if (S.flaps !== 'up') w.push('襟翼放下：面元幾何未含襟翼，表面 Cp 為淨翼外形以扣除襟翼增量後之 C<sub>L</sub> 配平');
  if (S.M > 0.85 && S.slice !== 'off' && S.mode !== 'cfd') w.push('M > 0.85：周圍流場剖面以面元法 M = 0.85 解示意，不含震波；可切換 3D CFD 觀察震波結構');
  if (R.op && R.op.op && R.op.op.warn) for (const x of R.op.op.warn) if (!w.includes(x)) w.push('引擎：' + x);
}
function updateSolverBar() {
  const b = $('#solverbar'); if (!b) return;
  if (S.mode === 'cfd' && CFD3 && CFD3.bar) { CFD3.bar(b); return; }
  const parts = [];
  let st = ['ok', '已完成'];
  if (CUR.pend) { st = ['run', '面元法組裝中']; parts.push(`M ${CUR.pend.pa.Mp.toFixed(2)} · ${fmtN(CUR.pend.prog * 100)} %`); }
  else if (SL.job && !SL.job.done) { st = ['run', '剖面計算中']; parts.push(`${fmtN(SL.job.i / SL.job.n * 100)} %`); }
  else if (G3.job && !G3.job.done) { st = ['run', '3D 速度場']; parts.push(`${fmtN(G3.job.i / G3.job.n * 100)} %`); }
  else if (PF.envProg < 1) { st = ['run', '飛行包線']; parts.push(`${fmtN(PF.envProg * 100)} %`); }
  const pa = CUR.pa;
  parts.push(pa ? `面元 ${fmtN(pa.solver.N)}（半模）· 尾跡 ${pa.solver.Ws.length}` : '面元 —');
  if (pa && pa.prepT) parts.push(`組裝 ${(pa.prepT / 1000).toFixed(1)} s`);
  const key = st.join() + parts.join();
  if (b.dataset.k === key) return; b.dataset.k = key;
  b.innerHTML = `<span class="st ${st[0]}"><i></i><b>${st[1]}</b></span>` + parts.map((p, i) => `<span data-k="${i === 0 ? 'it' : 'grid'}">${p}</span>`).join('');
}

/* ============================================================
 *  阻力分解
 * ============================================================ */
function drawDrag() {
  const R = CUR.R, box = $('#dgChart'); if (!R || !R.r) { const { g, W, H } = setupCanvas(box, chartH(0.95)); g.fillStyle = INK3; uiFont(g); g.fillText('地面靜止：無阻力', 12, 24); return; }
  const d = R.r.drag, items = [];
  for (const c of d.comps) items.push({ n: c.name, v: c.cd, c: '#3987e5', t: `摩擦＋形狀：C<sub>f</sub> ${(c.cf * 1000).toFixed(3)}‰ · FF ${c.FF.toFixed(2)} · Q ${c.Q.toFixed(2)} · S<sub>wet</sub> ${fmtN(c.Swet, 1)} m² · Re ${c.Re.toExponential(1)}` });
  for (const m of d.misc) items.push({ n: m.name, v: m.cd, c: '#7d8c9b', t: '雜項阻力' });
  items.push({ n: '波阻', v: d.CDw, c: '#f3b43f', t: `M<sub>dd</sub> ${d.Mdd.toFixed(3)} · M<sub>cr</sub> ${d.Mcr.toFixed(3)}` });
  items.push({ n: '誘導與升力相關', v: d.CDi, c: '#3ed48b', t: `K ${d.K.toFixed(4)} · C<sub>L</sub>² ${(R.r.CL ** 2).toFixed(3)}` });
  if (d.CDtrim > 0) items.push({ n: '配平', v: d.CDtrim, c: '#d882e6', t: '平尾負載造成之額外誘導阻力' });
  const H = Math.max(chartH(0.95), 28 + items.length * 22 + 40), { g, W } = setupCanvas(box, H);
  const pl = 118, pr = 64, top = 30, rowH = Math.min(22, (H - top - 36) / items.length), tot = d.CD, vmax = Math.max(...items.map(i => i.v), 1e-6);
  // 頂部比例條
  let x = pl; const bw = W - pl - pr;
  for (const it of items) { const w = it.v / tot * bw; g.fillStyle = it.c; g.fillRect(x, 6, Math.max(0, w - 1), 10); x += w; }
  uiFont(g); g.fillStyle = INK3; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText('組成比例', 6, 11);
  const X = v => pl + v / vmax * (bw - 4);
  items.forEach((it, i) => {
    const y = top + i * rowH + rowH / 2;
    uiFont(g); g.fillStyle = INK2; g.textAlign = 'right'; g.fillText(it.n, pl - 8, y);
    g.fillStyle = it.c; g.fillRect(pl, y - rowH * 0.32, Math.max(1, X(it.v) - pl), rowH * 0.64);
    axisFont(g); g.fillStyle = '#e2e8ee'; g.textAlign = 'left'; g.fillText(fmtN(it.v * 1e4, 1), X(it.v) + 6, y);
    it.y0 = y - rowH / 2; it.y1 = y + rowH / 2;
  });
  const yb = top + items.length * rowH + 10;
  g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, yb - 4); g.lineTo(W - pr, yb - 4); g.stroke();
  uiFont(g); g.fillStyle = '#e2e8ee'; g.textAlign = 'right'; g.fillText('總計', pl - 8, yb + 8);
  axisFont(g); g.textAlign = 'left'; g.fillText(`${fmtN(tot * 1e4, 1)} counts · D = ${fmtN(R.r.D / 1000, 2)} kN · L/D ${R.r.LD.toFixed(1)}`, pl, yb + 8);
  CHT.dg = { items, pl, W };
  $('#dgSub').textContent = `M ${S.M.toFixed(2)} · ${fmtN(S.h)} m · C_L ${R.r.CL.toFixed(3)}`;
  $('#dgKeys').innerHTML = [['#3987e5', '摩擦＋形狀'], ['#7d8c9b', '雜項'], ['#f3b43f', '波阻'], ['#3ed48b', '升力相關'], ['#d882e6', '配平']].map(([c, t]) => `<span><i style="border-color:${c}"></i>${t}</span>`).join('');
}

/* ============================================================
 *  翼面壓力分布與展向負載
 * ============================================================ */
function wingStrips() {
  const set = CUR.set, pt = set.patches.find(p => p.comp === 'wing'); if (!pt) return [];
  const nc = pt.ni / 2, w = CUR.ac.wing, out = [];
  for (let j = 0; j < pt.nj; j++) {
    const up = [], lo = [];
    for (let k = 0; k < nc; k++) { const iu = pt.idx[nc + k][j], il = pt.idx[nc - 1 - k][j]; if (iu >= 0) up.push(iu); if (il >= 0) lo.push(il); }
    if (!up.length) continue;
    const y = set.P[up[0]].cen[1];
    out.push({ j, y, eta: y / w.semi, up, lo });
  }
  return out;
}
function drawCp() {
  const R = CUR.R, box = $('#cpChart'); if (!R || !R.cpS || !CUR.set) return;
  const strips = CHT.strips || (CHT.strips = wingStrips()); if (!strips.length) return;
  const target = S.spanEta; let s = strips[0]; for (const q of strips) if (Math.abs(q.eta - target) < Math.abs(s.eta - target)) s = q;
  const w = CUR.ac.wing, set = CUR.set, xc = k => { const p = set.P[k], c = w.chord(Math.min(p.cen[1], w.semi)); return (p.cen[0] - w.xLE(Math.min(p.cen[1], w.semi))) / c; };
  const up = s.up.map(k => [xc(k), R.cpS[k]]), lo = s.lo.map(k => [xc(k), R.cpS[k]]);
  const H = chartH(0.8), { g, W } = setupCanvas(box, H), pl = 46, pr = 30, pt = 14, pb = 26;
  let cmin = Math.min(...up.map(p => p[1]), ...lo.map(p => p[1]), -0.6), cmax = Math.max(...up.map(p => p[1]), ...lo.map(p => p[1]), 0.6);
  const cs = S.M > 0.3 ? cpStar(S.M) : null; if (cs !== null && cs > cmin - 0.5) cmin = Math.min(cmin, cs - 0.1);
  cmin = Math.floor(cmin * 5) / 5; cmax = Math.ceil(cmax * 5) / 5;
  const X = v => pl + v * (W - pl - pr), Y = v => pt + (v - cmin) / (cmax - cmin) * (H - pt - pb); // 負值朝上
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(cmin, cmax, 5)) { const y = Y(v); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = INK3; g.fillText(v.toFixed(1), pl - 6, y); }
  g.strokeStyle = '#34485c'; g.beginPath(); g.moveTo(pl, Y(0)); g.lineTo(W - pr, Y(0)); g.stroke();
  g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of [0, 0.2, 0.4, 0.6, 0.8]) { g.fillStyle = INK3; g.fillText(v.toFixed(1), X(v), H - pb + 6); }
  g.textAlign = 'right'; g.fillText('x/c', W - 2, H - pb + 6);
  g.save(); g.translate(10, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK3; g.fillText('Cp', 0, 0); g.restore();
  if (cs !== null) { const y = Y(cs); g.setLineDash([4, 4]); g.strokeStyle = '#f3b43f'; g.beginPath(); g.moveTo(pl, y); g.lineTo(W - pr, y); g.stroke(); g.setLineDash([]); uiFont(g); g.fillStyle = '#f3b43f'; g.textAlign = 'right'; g.textBaseline = 'bottom'; g.fillText(`Cp*（局部音速）${cs.toFixed(2)}`, W - pr - 2, y - 2); }
  const line = (pts, c) => { g.strokeStyle = c; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => { const x = X(p[0]), y = Y(p[1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.fillStyle = c; for (const p of pts) { g.beginPath(); g.arc(X(p[0]), Y(p[1]), 2.2, 0, 2 * Math.PI); g.fill(); } g.lineWidth = 1; };
  line(lo, '#d95926'); line(up, '#3987e5');
  CHT.cp = { X, Y, up, lo, pl, pr, W };
  $('#cpEtao').textContent = `η ${s.eta.toFixed(2)}`;
  $('#cpSub').textContent = `y = ${s.y.toFixed(2)} m · 弦長 ${w.chord(Math.min(s.y, w.semi)).toFixed(2)} m${R.cpMode === 'li' ? ' · 局部傾角法' : R.cpMode === 'blend' ? ' · 跨音速內插' : ''}`;
  $('#cpKeys').innerHTML = `<span><i style="border-color:#3987e5"></i>上表面</span><span><i style="border-color:#d95926"></i>下表面</span>${cs !== null ? '<span><i class="d" style="border-color:#f3b43f"></i>Cp*</span>' : ''}`;
  drawSpan();
}
function drawSpan() {
  const R = CUR.R, box = $('#slChart'); if (!R || !R.co) return;
  const H = chartH(0.55), { g, W } = setupCanvas(box, H), pl = 46, pr = 30, pt = 10, pb = 24;
  const ac = CUR.ac, w = ac.wing, cbar = ac.ref.S / ac.ref.b;
  const sp = R.co.span.filter(q => q.comp === 'wing').sort((a, b) => a.y - b.y);
  if (!sp.length || R.static) { g.fillStyle = INK3; uiFont(g); g.fillText('無升力', pl, 20); return; }
  const y0 = sp[0].y - (sp[1] ? (sp[1].y - sp[0].y) / 2 : 0);
  let A = sp[0].ccl * y0; for (let i = 0; i < sp.length; i++) { const dy = i === 0 ? (sp[1] ? (sp[1].y + sp[0].y) / 2 - y0 : 1) : i === sp.length - 1 ? w.semi - (sp[i].y + sp[i - 1].y) / 2 : (sp[i + 1].y - sp[i - 1].y) / 2; A += sp[i].ccl * dy; }
  const l0 = 4 * A / (Math.PI * w.semi);
  const pts = [[0, sp[0].ccl / cbar], [y0 / w.semi, sp[0].ccl / cbar], ...sp.map(q => [q.y / w.semi, q.ccl / cbar])];
  const vmax = Math.max(...pts.map(p => p[1]), l0 / cbar) * 1.12, vmin = Math.min(0, ...pts.map(p => p[1]));
  const X = v => pl + v * (W - pl - pr), Y = v => pt + (1 - (v - vmin) / (vmax - vmin)) * (H - pt - pb);
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(vmin, vmax, 3)) { const y = Y(v); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = INK3; g.fillText(v.toFixed(2), pl - 6, y); }
  g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of [0, 0.25, 0.5, 0.75]) { g.fillStyle = INK3; g.fillText(v.toFixed(2), X(v), H - pb + 6); }
  g.textAlign = 'right'; g.fillText('η', W - 2, H - pb + 6);
  // 機身範圍
  g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(X(0), pt, X(y0 / w.semi) - X(0), H - pt - pb);
  g.setLineDash([5, 4]); g.strokeStyle = INK2; g.beginPath(); for (let i = 0; i <= 60; i++) { const e = i / 60, v = l0 * Math.sqrt(Math.max(0, 1 - e * e)) / cbar; i ? g.lineTo(X(e), Y(v)) : g.moveTo(X(e), Y(v)); } g.stroke(); g.setLineDash([]);
  g.strokeStyle = '#45cfe0'; g.lineWidth = 2; g.beginPath(); pts.forEach((p, i) => { i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1])); }); g.lineTo(X(1), Y(0)); g.stroke(); g.lineWidth = 1;
  const eta = S.spanEta; g.strokeStyle = 'rgba(69,207,224,0.5)'; g.beginPath(); g.moveTo(X(eta), pt); g.lineTo(X(eta), H - pb); g.stroke();
  CHT.sl = { X, Y, pts, pl, pr, W, l0, cbar, semi: w.semi };
}

/* ============================================================
 *  推力與阻力 vs 馬赫數
 * ============================================================ */
function drawTD() {
  const box = $('#tdChart'); if (!CUR.ctx || !CUR.R) return;
  const pts = tdCurves(), H = chartH(), { g, W } = setupCanvas(box, H), pl = 50, pr = 12, pt = 14, pb = 28;
  const ac = CUR.ac, Ms = pts.map(p => p.M), M0 = Ms[0], M1 = Ms[Ms.length - 1];
  const ymax = Math.max(...pts.map(p => Math.max(p.T, p.Tab || 0)), ...pts.filter(p => !p.stall).map(p => p.D)) / 1000 * 1.08;
  const X = v => pl + (v - M0) / (M1 - M0) * (W - pl - pr), Y = v => pt + (1 - Math.max(-0.05 * ymax, v) / ymax) * (H - pt - pb);
  // 失速區
  const st = pts.filter(p => p.stall); if (st.length) { const xs = X(st[st.length - 1].M); g.fillStyle = 'rgba(242,90,79,0.08)'; g.fillRect(pl, pt, xs - pl, H - pt - pb); uiFont(g); g.fillStyle = '#f25a4f'; g.textAlign = 'left'; g.textBaseline = 'top'; if (xs - pl > 30) g.fillText('失速', pl + 4, pt + 2); }
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(0, ymax, 5)) { const y = Y(v); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = INK3; g.fillText(fmtN(v), pl - 6, y); }
  g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of niceTicks(M0, M1, 6)) { if (X(v) > W - pr - 22) continue; g.fillStyle = INK3; g.fillText(v.toFixed(1), X(v), H - pb + 6); }
  g.textAlign = 'right'; g.fillText('M∞', W - pr, H - pb + 6);
  g.save(); g.translate(11, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = INK3; g.fillText('kN', 0, 0); g.restore();
  const Mmo = ac.T.limits.Mmo; if (Mmo < M1) { const x = X(Mmo); g.setLineDash([3, 4]); g.strokeStyle = '#f25a4f'; g.beginPath(); g.moveTo(x, pt); g.lineTo(x, H - pb); g.stroke(); g.setLineDash([]); uiFont(g); g.fillStyle = '#f25a4f'; g.textAlign = 'left'; g.textBaseline = 'top'; g.fillText('M_MO', x + 3, pt); }
  const line = (f, c, dash) => { g.strokeStyle = c; g.lineWidth = 2; g.setLineDash(dash || []); g.beginPath(); let on = false; for (const p of pts) { const v = f(p); if (v == null) { on = false; continue; } const x = X(p.M), y = Y(v / 1000); on ? g.lineTo(x, y) : g.moveTo(x, y); on = true; } g.stroke(); g.setLineDash([]); g.lineWidth = 1; };
  g.save(); g.beginPath(); g.rect(pl, pt, W - pl - pr, H - pt - pb); g.clip();
  line(p => p.D, '#3987e5');
  line(p => p.T, '#3ed48b');
  if (ac.T.internal) line(p => p.Tab, '#f3b43f', [6, 4]);
  g.restore();
  const R = CUR.R; if (R.r) { const x = X(clamp(S.M, M0, M1)); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, Y(R.r.D / 1000), 4, 0, 2 * Math.PI); g.fill(); g.strokeStyle = '#fff'; g.beginPath(); g.arc(x, Y(R.r.T / 1000), 4, 0, 2 * Math.PI); g.stroke(); }
  CHT.td = { X, Y, pts, pl, pr, W, M0, M1 };
  $('#tdSub').textContent = `${fmtN(S.h)} m · ${fmtN(weight() / 1000, 1)} t${S.n > 1 ? ` · n ${S.n.toFixed(1)}` : ''}`;
  $('#tdKeys').innerHTML = `<span><i style="border-color:#3987e5"></i>所需推力（阻力）</span><span><i style="border-color:#3ed48b"></i>最大推力${ac.T.internal ? '（軍用）' : ''}</span>${ac.T.internal ? '<span><i class="d" style="border-color:#f3b43f"></i>最大推力（後燃）</span>' : ''}`;
}

/* ============================================================
 *  飛行包線（Ps 色階）
 * ============================================================ */
function drawEnv() {
  const env = PF.env, box = $('#envChart'); if (!env) return;
  const H = chartH(1.05), { g, W } = setupCanvas(box, H), pl = 46, pr = 58, pt = 12, pb = 28;
  const { hs, Ms, Ps, stall } = env, nh = hs.length, nm = Ms.length, M0 = Ms[0], M1 = Ms[nm - 1], h1 = hs[nh - 1];
  const X = v => pl + (v - M0) / (M1 - M0) * (W - pl - pr), Y = v => pt + (1 - v / h1) * (H - pt - pb);
  let pmax = 0; for (const row of Ps) for (const v of row) if (v > pmax) pmax = v;
  pmax = Math.max(5, pmax);
  const lut = LUTS.viridis;
  // 色階（雙線性）
  const iw = Math.max(2, Math.round((W - pl - pr) / 3)), ih = Math.max(2, Math.round((H - pt - pb) / 3)), img = g.createImageData(iw, ih);
  for (let yy = 0; yy < ih; yy++) for (let xx = 0; xx < iw; xx++) {
    const fm = xx / (iw - 1) * (nm - 1), fh = (1 - yy / (ih - 1)) * (nh - 1), i = Math.min(nh - 2, Math.floor(fh)), j = Math.min(nm - 2, Math.floor(fm)), ty = fh - i, tx = fm - j;
    const v = (1 - ty) * ((1 - tx) * Ps[i][j] + tx * Ps[i][j + 1]) + ty * ((1 - tx) * Ps[i + 1][j] + tx * Ps[i + 1][j + 1]);
    const s = (1 - ty) * ((1 - tx) * stall[i][j] + tx * stall[i][j + 1]) + ty * ((1 - tx) * stall[i + 1][j] + tx * stall[i + 1][j + 1]);
    const o = 4 * (yy * iw + xx);
    if (v <= 0 || s > 1) { img.data[o] = 22; img.data[o + 1] = 28; img.data[o + 2] = 36; img.data[o + 3] = 255; continue; }
    const li = Math.round(clamp(v / pmax, 0, 1) * 255) * 3; img.data[o] = lut[li] * 0.9; img.data[o + 1] = lut[li + 1] * 0.9; img.data[o + 2] = lut[li + 2] * 0.9; img.data[o + 3] = 255;
  }
  const oc = document.createElement('canvas'); oc.width = iw; oc.height = ih; oc.getContext('2d').putImageData(img, 0, 0);
  g.imageSmoothingEnabled = true; g.drawImage(oc, pl, pt, W - pl - pr, H - pt - pb);
  // 等值線（行進方格）
  const contour = (F, lvl, col, lw, dash) => {
    g.strokeStyle = col; g.lineWidth = lw; g.setLineDash(dash || []); g.beginPath();
    for (let i = 0; i < nh - 1; i++) for (let j = 0; j < nm - 1; j++) {
      const v = [F(i, j), F(i, j + 1), F(i + 1, j + 1), F(i + 1, j)].map(x => x - lvl), P = [[Ms[j], hs[i]], [Ms[j + 1], hs[i]], [Ms[j + 1], hs[i + 1]], [Ms[j], hs[i + 1]]], cr = [];
      for (let e = 0; e < 4; e++) { const a = v[e], b = v[(e + 1) % 4]; if ((a < 0) !== (b < 0)) { const t = a / (a - b), p = P[e], q = P[(e + 1) % 4]; cr.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]); } }
      if (cr.length >= 2) { g.moveTo(X(cr[0][0]), Y(cr[0][1])); g.lineTo(X(cr[1][0]), Y(cr[1][1])); }
      if (cr.length === 4) { g.moveTo(X(cr[2][0]), Y(cr[2][1])); g.lineTo(X(cr[3][0]), Y(cr[3][1])); }
    }
    g.stroke(); g.setLineDash([]); g.lineWidth = 1;
  };
  for (const lv of niceTicks(0, pmax, 4).filter(v => v > 0)) contour((i, j) => stall[i][j] > 1 ? -1e3 : Ps[i][j], lv, 'rgba(255,255,255,0.22)', 1);
  contour((i, j) => Ps[i][j], 0, '#e2e8ee', 2.2);
  contour((i, j) => stall[i][j], 1, '#f25a4f', 1.6, [5, 4]);
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(0, h1, 5)) { const y = Y(v); g.fillStyle = INK3; g.fillText(fmtN(v / 1000), pl - 6, y); }
  g.save(); g.translate(10, (pt + H - pb) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillStyle = INK3; g.fillText('高度 km', 0, 0); g.restore();
  g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of niceTicks(M0, M1, 6)) { if (X(v) > W - pr - 22) continue; g.fillStyle = INK3; g.fillText(v.toFixed(1), X(v), H - pb + 6); }
  g.textAlign = 'right'; g.fillText('M∞', W - pr, H - pb + 6);
  // 色條
  const cx = W - pr + 14, ch = H - pt - pb;
  for (let y = 0; y < ch; y++) { const li = Math.round((1 - y / ch) * 255) * 3; g.fillStyle = `rgb(${lut[li] * 0.9 | 0},${lut[li + 1] * 0.9 | 0},${lut[li + 2] * 0.9 | 0})`; g.fillRect(cx, pt + y, 10, 1); }
  g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillStyle = INK3; for (const v of niceTicks(0, pmax, 3)) g.fillText(fmtN(v), cx + 13, pt + (1 - v / pmax) * ch);
  // 任務航跡
  if (PF.mis && PF.mis.out.length) { g.strokeStyle = 'rgba(69,207,224,0.85)'; g.lineWidth = 1.5; g.beginPath(); PF.mis.out.forEach((p, i) => { const x = X(clamp(p.M, M0, M1)), y = Y(clamp(p.h, 0, h1)); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke(); g.lineWidth = 1; }
  // 目前工況
  const x = X(clamp(S.M, M0, M1)), y = Y(clamp(S.h, 0, h1)); g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 2 * Math.PI); g.stroke(); g.lineWidth = 1;
  CHT.env = { X, Y, env, pl, pr, pt, pb, W, H, M0, M1, h1 };
  $('#envSub').textContent = `${fmtN(env.W / 1000, 1)} t · ${env.ab ? '最大推力（後燃）' : '最大推力'}`;
  $('#envKeys').innerHTML = `<span><i style="border-color:#e2e8ee"></i>P<sub>s</sub> = 0</span><span><i class="d" style="border-color:#f25a4f"></i>失速邊界</span><span><i style="border-color:#45cfe0"></i>任務航跡</span>`;
}

/* ============================================================
 *  任務剖面
 * ============================================================ */
const PHC = { '起飛': '#3ed48b', '爬升': '#45cfe0', '巡航': '#3987e5', '巡航（去程）': '#3987e5', '超音速衝刺': '#f3b43f', '巡航（回程）': '#2f6fc0', '下降': '#9a7fd1', '降落': '#3ed48b' };
function drawMission() {
  const m = PF.mis, box = $('#msChart'); if (!m) return;
  const H = chartH(0.85), { g, W } = setupCanvas(box, H), pl = 44, pr = 44, pt = 22, pb = 26;
  const out = m.out, t1 = Math.max(60, out[out.length - 1].t) / 60, hmax = Math.max(1000, ...out.map(p => p.h)) * 1.1 / 1000, Mmax = Math.max(0.5, ...out.map(p => p.M)) * 1.1;
  const X = v => pl + v / t1 * (W - pl - pr), Y = v => pt + (1 - v / hmax) * (H - pt - pb), YM = v => pt + (1 - v / Mmax) * (H - pt - pb);
  uiFont(g); g.textBaseline = 'top'; g.textAlign = 'center';
  let alt = 0;
  for (const ph of m.phases) { const a = X(ph.t0 / 60), b = X(ph.t1 / 60); g.fillStyle = (alt++ % 2) ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.06)'; g.fillRect(a, pt, b - a, H - pt - pb); if (b - a > g.measureText(ph.name).width + 4) { g.fillStyle = PHC[ph.name] || INK2; g.fillText(ph.name, (a + b) / 2, 4); } }
  axisFont(g); g.textAlign = 'right'; g.textBaseline = 'middle';
  for (const v of niceTicks(0, hmax, 4)) { const y = Y(v); g.strokeStyle = GRIDC; g.beginPath(); g.moveTo(pl, Math.round(y) + 0.5); g.lineTo(W - pr, Math.round(y) + 0.5); g.stroke(); g.fillStyle = '#45cfe0'; g.fillText(fmtN(v, v < 10 && v % 1 ? 1 : 0), pl - 6, y); }
  g.textAlign = 'left'; for (const v of niceTicks(0, Mmax, 4)) { g.fillStyle = '#f3b43f'; g.fillText(v.toFixed(1), W - pr + 6, YM(v)); }
  g.textAlign = 'center'; g.textBaseline = 'top'; for (const v of niceTicks(0, t1, 6)) { if (X(v) > W - pr - 26) continue; g.fillStyle = INK3; g.fillText(fmtN(v), X(v), H - pb + 6); }
  g.textAlign = 'right'; g.fillText('分鐘', W - pr, H - pb + 6);
  g.textAlign = 'left'; g.fillStyle = '#45cfe0'; g.fillText('km', 2, pt - 14 < 0 ? 0 : pt - 12);
  g.strokeStyle = '#45cfe0'; g.lineWidth = 2; g.beginPath(); out.forEach((p, i) => { i ? g.lineTo(X(p.t / 60), Y(p.h / 1000)) : g.moveTo(X(p.t / 60), Y(p.h / 1000)); }); g.stroke();
  g.strokeStyle = '#f3b43f'; g.setLineDash([5, 4]); g.beginPath(); out.forEach((p, i) => { i ? g.lineTo(X(p.t / 60), YM(p.M)) : g.moveTo(X(p.t / 60), YM(p.M)); }); g.stroke(); g.setLineDash([]); g.lineWidth = 1;
  CHT.ms = { X, Y, YM, out, pl, pr, W, t1 };
  const fuel0 = m.fuel0, left = fuel0 - m.fuelUsed;
  $('#msSub').textContent = `${fmtN(S.mis.range)} km · 起飛 ${fmtN(m.out[0].W / 1000, 1)} t`;
  $('#msKeys').innerHTML = `<span><i style="border-color:#45cfe0"></i>高度</span><span><i class="d" style="border-color:#f3b43f"></i>馬赫數</span>`;
  const rows = m.phases.map(p => `<tr><td><span class="id" style="color:${PHC[p.name] || INK2}">■</span></td><td>${p.name}</td><td class="n">${fmtN(p.dt / 60, 1)}</td><td class="n">${fmtN(p.dx / 1000)}</td><td class="n">${fmtN(p.df)}</td><td class="n">${fmtN(p.h1)}</td></tr>`).join('');
  $('#msTable').innerHTML = `<thead><tr><th></th><th>階段</th><th>時間 (min)</th><th>距離 (km)</th><th>耗油 (kg)</th><th>結束高度 (m)</th></tr></thead><tbody>${rows}
    <tr><td></td><td><b>合計</b></td><td class="n"><b>${fmtN(out[out.length - 1].t / 60, 1)}</b></td><td class="n"><b>${fmtN(out[out.length - 1].x / 1000)}</b></td><td class="n"><b>${fmtN(m.fuelUsed)}</b></td><td class="n">剩餘 ${fmtN(left)} kg${left < m.reserve ? '（低於備份）' : ''}</td></tr>
    ${m.aborted ? `<tr><td></td><td colspan="5" style="color:var(--amber);text-align:left">⚠ ${m.aborted}</td></tr>` : ''}</tbody>`;
}

/* ---------- 圖表互動 ---------- */
const CHT = {};
function tipAt(box, mx, my, html) {
  const tip = box.querySelector('.tip'); if (!html) { tip.hidden = true; return; }
  tip.innerHTML = html; tip.hidden = false; const rc = box.getBoundingClientRect(), tw = tip.offsetWidth;
  tip.style.left = (mx + 14 + tw > rc.width ? mx - tw - 10 : mx + 14) + 'px'; tip.style.top = Math.max(0, my - 10) + 'px';
}
function initCharts() {
  const hook = (id, f) => { const b = $(id); b.addEventListener('pointermove', e => { const rc = b.getBoundingClientRect(); tipAt(b, e.clientX - rc.left, e.clientY - rc.top, f(e.clientX - rc.left, e.clientY - rc.top)); }); b.addEventListener('pointerleave', () => { b.querySelector('.tip').hidden = true; }); };
  hook('#dgChart', (mx, my) => { const A = CHT.dg; if (!A) return null; const it = A.items.find(i => my >= i.y0 && my <= i.y1); return it ? `<b>${it.n}</b><div>${fmtN(it.v * 1e4, 1)} counts（${fmtN(it.v / CUR.R.r.CD * 100, 1)} %）</div><div style="color:var(--ink-3)">${it.t}</div>` : null; });
  hook('#cpChart', (mx) => { const A = CHT.cp; if (!A || mx < A.pl) return null; const xc = (mx - A.pl) / (A.W - A.pl - A.pr); const nb = arr => arr.reduce((b, p) => Math.abs(p[0] - xc) < Math.abs(b[0] - xc) ? p : b, arr[0]); const u = nb(A.up), l = nb(A.lo); return `<b>x/c ≈ ${xc.toFixed(2)}</b><div class="r"><span style="color:#3987e5">上表面</span><span>${u[1].toFixed(3)}</span></div><div class="r"><span style="color:#d95926">下表面</span><span>${l[1].toFixed(3)}</span></div>`; });
  hook('#slChart', (mx) => { const A = CHT.sl; if (!A || mx < A.pl) return null; const e = clamp((mx - A.pl) / (A.W - A.pl - A.pr), 0, 1); const p = A.pts.reduce((b, q) => Math.abs(q[0] - e) < Math.abs(b[0] - e) ? q : b, A.pts[0]); return `<b>η ${e.toFixed(2)}</b><div class="r"><span>c·c<sub>l</sub>/c̄</span><span>${p[1].toFixed(3)}</span></div><div class="r"><span>橢圓</span><span>${(A.l0 * Math.sqrt(Math.max(0, 1 - e * e)) / A.cbar).toFixed(3)}</span></div>`; });
  hook('#tdChart', (mx) => { const A = CHT.td; if (!A || mx < A.pl) return null; const M = A.M0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.M1 - A.M0); const p = A.pts.reduce((b, q) => Math.abs(q.M - M) < Math.abs(b.M - M) ? q : b, A.pts[0]); return `<b>M ${p.M.toFixed(2)}</b><div class="r"><span style="color:#3987e5">阻力</span><span>${fmtN(p.D / 1000, 1)} kN</span></div><div class="r"><span style="color:#3ed48b">最大推力</span><span>${fmtN(p.T / 1000, 1)} kN</span></div>${p.Tab ? `<div class="r"><span style="color:#f3b43f">後燃</span><span>${fmtN(p.Tab / 1000, 1)} kN</span></div>` : ''}<div class="r"><span>C<sub>L</sub> · L/D</span><span>${p.CL.toFixed(2)} · ${(p.CL / p.CD).toFixed(1)}</span></div>${p.stall ? '<div style="color:var(--red)">失速</div>' : ''}`; });
  hook('#envChart', (mx, my) => { const A = CHT.env; if (!A || mx < A.pl || mx > A.W - A.pr || my < A.pt || my > A.H - A.pb) return null; const M = A.M0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.M1 - A.M0), h = (1 - (my - A.pt) / (A.H - A.pt - A.pb)) * A.h1; const e = A.env, i = clamp(Math.round(h / A.h1 * (e.hs.length - 1)), 0, e.hs.length - 1), j = clamp(Math.round((M - A.M0) / (A.M1 - A.M0) * (e.Ms.length - 1)), 0, e.Ms.length - 1); return `<b>M ${M.toFixed(2)} · ${fmtN(h)} m</b><div class="r"><span>P<sub>s</sub></span><span>${fmtS(e.Ps[i][j], 1)} m/s</span></div><div class="r"><span>C<sub>L</sub>/C<sub>L,max</sub></span><span>${fmtN(e.stall[i][j] * 100)} %</span></div><div style="color:var(--ink-3)">點擊設為目前工況</div>`; });
  $('#envChart').addEventListener('click', e => { const A = CHT.env; if (!A) return; const rc = $('#envChart').getBoundingClientRect(), mx = e.clientX - rc.left, my = e.clientY - rc.top; if (mx < A.pl || mx > A.W - A.pr || my < A.pt || my > A.H - A.pb) return; S.M = +(A.M0 + (mx - A.pl) / (A.W - A.pl - A.pr) * (A.M1 - A.M0)).toFixed(3); S.h = Math.round((1 - (my - A.pt) / (A.H - A.pt - A.pb)) * A.h1 / 50) * 50; S.preset = null; S.thrMode = 'level'; refreshControls(); request('cond', true); });
  hook('#msChart', (mx) => { const A = CHT.ms; if (!A || mx < A.pl) return null; const t = (mx - A.pl) / (A.W - A.pl - A.pr) * A.t1 * 60; const p = A.out.reduce((b, q) => Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b, A.out[0]); return `<b>${p.ph} · ${fmtN(p.t / 60, 1)} min</b><div class="r"><span>高度</span><span>${fmtN(p.h)} m</span></div><div class="r"><span>馬赫數</span><span>${p.M.toFixed(2)}</span></div><div class="r"><span>重量</span><span>${fmtN(p.W)} kg</span></div><div class="r"><span>燃油流量</span><span>${fmtN(p.ff * 3600)} kg/h</span></div><div class="r"><span>L/D</span><span>${p.LD ? p.LD.toFixed(1) : '—'}</span></div><div class="r"><span>SAT · TAT</span><span>${fmtS(p.SAT - 273.15, 1)} · ${fmtS(p.TAT - 273.15, 1)} °C</span></div>`; });
  const eta = $('#cpEta'); eta.value = S.spanEta * 1000; eta.addEventListener('input', () => { S.spanEta = eta.value / 1000; drawCp(); });
}
