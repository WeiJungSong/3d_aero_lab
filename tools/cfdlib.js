// 測試用共用設定：載入原始碼並建立指定引擎的 CFD 問題
const fs = require('fs'), vm = require('vm');
const code = ['physics', 'geometry', 'field', 'cfd_grid', 'cfd_cpu', 'cfd_post'].map(f => fs.readFileSync(__dirname + '/../src/' + f + '.js', 'utf8').replace(/^if \(typeof module[^\n]*\n/gm, '')).join('\n');
vm.runInThisContext(code + '\nglobalThis.API={cfdControl,solveEngine,ENGINE_TYPES,DEFAULT_EFF,buildSpec,FieldModel,buildCFDGrid,buildZones,compParams,initialState,CPUSolver,cfdForces,cfdSection,cfdDerived,cfdPrim,colAt,spoolMatch,spoolRatios,COMP_NAME,RGAS};');
const A = API;
function setup(type, level, o = {}) {
  const T = A.ENGINE_TYPES[type];
  const P = { type, design: { ...T.design }, eff: { ...A.DEFAULT_EFF }, alt: o.alt || 0, M0: o.M0 ?? 0.25, thr: o.thr ?? 1, ab: !!o.ab, Tt7: type === 'lbtf' ? 2100 : 2000, nozzleType: T.nozzle };
  const sol = A.solveEngine(P), op = sol.op, fl = sol.fl, nz = op.noz;
  const spec = A.buildSpec(type, 1, { r8: Math.sqrt(nz.Athroat / Math.PI), r9: Math.sqrt(Math.max(nz.A, nz.Athroat) / Math.PI), A9: sol.ref.noz && sol.ref.noz.A, A19: sol.ref.nozB && sol.ref.nozB.A });
  const model = new A.FieldModel(spec, sol, P);
  const grid = A.buildCFDGrid(spec, level);
  const zones = A.buildZones(grid, spec, model, op, P);
  const comps = A.compParams(type, op, P);
  let Q0 = A.initialState(grid, zones, spec, model, fl, false);
  if (o.load && fs.existsSync(o.load)) { const b = new Float64Array(fs.readFileSync(o.load).buffer.slice(0)); if (b.length === 5 * grid.N) Q0 = [0, 1, 2, 3, 4].map(q => b.slice(q * grid.N, (q + 1) * grid.N)); }
  if (o.load && fs.existsSync(o.load + '.comps.json')) { const cj = JSON.parse(fs.readFileSync(o.load + '.comps.json', 'utf8')); if (cj.length === comps.length) { const base0 = Float64Array.from(comps); comps.set(cj); comps.__base = base0; } }
  const S = new A.CPUSolver(grid, zones, comps, { r: fl.P0 / (A.RGAS * fl.T0), u: fl.V0, p: fl.P0 }, Q0, { cfl: o.cfl || 0.6, order: 2, visc: true, hf: P.eff.etb * P.eff.LHV });
  return { A, P, sol, op, fl, spec, model, grid, zones, comps, base: comps.__base || Float64Array.from(comps), S, type };
}
function save(C, file) { const N = C.grid.N, b = new Float64Array(5 * N); for (let q = 0; q < 5; q++) b.set(C.S.Q[q], q * N); fs.writeFileSync(file, Buffer.from(b.buffer)); fs.writeFileSync(file + '.comps.json', JSON.stringify(Array.from(C.comps))); }
// 各轉子葉片排：進出口截面質量平均 Tt、Pt 比
function rowDiag(C) {
  const { A, grid, zones, S, comps, spec } = C, { W, H } = grid, out = [];
  for (let id = 1; id < 8; id++) {
    if (id === 4 || id === 7 || !comps[id * 4 + 2]) continue;
    let i0 = 1e9, i1 = -1, si = -9; const cnt = {};
    for (let k = 0; k < grid.N; k++) if (zones.comp[k] === id) { const i = k % W; i0 = Math.min(i0, i); i1 = Math.max(i1, i); cnt[zones.stream[k]] = (cnt[zones.stream[k]] || 0) + 1; }
    if (i1 < 0) continue;
    si = +Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
    const a = A.cfdSection(grid, zones, S.Q, grid.xc[Math.max(0, i0 - 1)], si, S.mfx), b = A.cfdSection(grid, zones, S.Q, grid.xc[Math.min(W - 1, i1 + 1)], si, S.mfx);
    // 覆蓋率：各 j 之 Σ wgt·dx
    const cov = []; for (let j = 0; j < H; j++) { let s = 0, any = false; for (let i = i0; i <= i1; i++) { const k = j * W + i; if (zones.comp[k] === id) { s += zones.wgt[k] * grid.dx[i]; any = true; } } if (any) cov.push(s); }
    const tau = Math.exp(comps[id * 4]);
    out.push({ id, name: A.COMP_NAME[id], cells: i1 - i0 + 1, tau: +tau.toFixed(4), TtRatio: +(b.Tt / a.Tt).toFixed(4), PtRatio: +(b.Pt / a.Pt).toFixed(4), mIn: +a.mdot.toFixed(1), mOut: +b.mdot.toFixed(1), covMin: +Math.min(...cov).toFixed(3), covMax: +Math.max(...cov).toFixed(3), rowsJ: cov.length });
  }
  return out;
}
module.exports = { setup, save, rowDiag, A };
