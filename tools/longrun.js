const { setup, save, rowDiag } = require('./cfdlib.js');
const [type = 'tj', level = 'xcoarse', iters = '20000', every = '1000'] = process.argv.slice(2);
const f = `/tmp/Q_${type}_${level}.bin`;
const C = setup(type, level, { load: process.env.FRESH ? null : f, cfl: +(process.env.CFL || 0.6) });
const t0 = Date.now(); let prev = Float64Array.from(C.S.Q[0]);
let ctl = null;
for (let n = 0; n < +iters; n += +every) {
  for (let m = 0; m < +every; m += 250) { C.S.step(250); if (!process.env.NOCTL) { const f0 = C.A.cfdForces(C.grid, C.zones, C.S.Q, C.comps, C.fl.P0, 0, { S: C.S.src, F: C.S.mfx }); ctl = C.A.cfdControl(type, C.spec, C.grid, C.zones, C.S.Q, C.S.mfx, C.comps, C.base, f0.pw, C.op, C.P.eff.etam, 250); } }
  let r2 = 0, c = 0; for (let k = 0; k < C.grid.N; k++) if (!C.zones.solid[k]) { const d = (C.S.Q[0][k] - prev[k]) / prev[k]; r2 += d * d; c++; } prev = Float64Array.from(C.S.Q[0]);
  const fr = C.A.cfdForces(C.grid, C.zones, C.S.Q, C.comps, C.fl.P0, C.P.eff.etb * C.P.eff.LHV, { S: C.S.src, F: C.S.mfx });
  const rd = rowDiag(C).map(r => `${r.id}:τ${r.TtRatio}/${r.tau} m${r.mIn}→${r.mOut}`).join(' ');
  console.log('it', n + +every, 'res/it', (Math.sqrt(r2 / c) / +every).toExponential(2), 'F', (fr.F / 1000).toFixed(2), 'pw', C.A.spoolRatios(type, fr.pw, C.P.eff.etam).map(v => v.toFixed(3)).join('/'), 'τt', [5, 6].filter(id => C.comps[id * 4 + 2]).map(id => Math.exp(C.comps[id * 4]).toFixed(3) + '/' + Math.exp(C.base[id * 4]).toFixed(3)).join(' '), 'K4', C.comps[17].toFixed(3), ctl ? 'Tt4 ' + ctl.Tt4.toFixed(0) + '/' + C.op.Tt4.toFixed(0) : '', 'fuel', fr.mfuel.toFixed(3), rd, ((Date.now() - t0) / 1000).toFixed(0) + 's');
}
if (!process.env.NOSAVE) save(C, f);
