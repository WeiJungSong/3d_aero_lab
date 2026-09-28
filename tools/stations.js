const { setup } = require('./cfdlib.js');
const [type = 'hbtf', level = 'xcoarse'] = process.argv.slice(2);
const C = setup(type, level, { load: `/tmp/Q_${type}_${level}.bin` });
const { A, grid, zones, S, spec, op } = C, { W, H, rc, dr } = grid;
S.prim(S.Q); S.residual(S.Q, true);
const fr = A.cfdForces(grid, zones, S.Q, C.comps, C.fl.P0, C.P.eff.etb * C.P.eff.LHV, { S: S.src, F: S.mfx });
console.log('F', (fr.F / 1000).toFixed(1), '1D', (op.F / 1000).toFixed(1), 'fuel', fr.mfuel.toFixed(3), '1D', op.mfuel.toFixed(3), 'body', (fr.Fb / 1000).toFixed(1), 'wall', (fr.Fw / 1000).toFixed(1));
const st = type === 'hbtf' ? [['2', 0.58, 'inlet'], ['13', 0.95, 'bypass'], ['25', 1.47, 'core'], ['3', 2.05, 'core'], ['4', 2.43, 'core'], ['45', 2.62, 'core'], ['5', 3.08, 'core'], ['19', 2.19, 'bypass']] : type === 'tj' ? [['2', 0.36, 'core'], ['3', 1.55, 'core'], ['4', 2.21, 'core'], ['5', 2.62, 'core'], ['7', 4.29, 'core'], ['9', 4.89, 'core']] : [['2', 0.3, 'inlet'], ['13', 0.9, 'bypass'], ['3', 1.55, 'core'], ['4', 2.0, 'core'], ['5', 2.55, 'core'], ['6A', 3.0, 'ab'], ['9', 4.94, 'ab']];
for (const [id, x, sn] of st) {
  const si = spec.order.indexOf(sn), i = A.colAt(grid, x);
  let m = 0, tt = 0, pt = 0, wsum = 0;
  for (let j = 0; j < H; j++) { const k = j * W + i; if (zones.solid[k] || zones.stream[k] !== si) continue; const f = 0.5 * (S.Fx[0][j * (W + 1) + i] + S.Fx[0][j * (W + 1) + i + 1]) * 2 * Math.PI * rc[j] * dr[j]; m += f;
    const q = A.cfdPrim(S.Q, k), cp = q.g * 287.05 / (q.g - 1), T = q.p / (q.r * 287.05), Tt = T + 0.5 * (q.u * q.u + q.v * q.v) / cp, Pt = q.p * Math.pow(Tt / T, q.g / (q.g - 1)); const wk = Math.max(f, 0); tt += wk * Tt; pt += wk * Pt; wsum += wk; }
  const d = op.S[id] || {};
  console.log(id.padEnd(3), 'x', x, 'ṁ', m.toFixed(1), 'Tt', (tt / wsum).toFixed(0), '1D', d.Tt ? d.Tt.toFixed(0) : '-', 'Pt', (pt / wsum / 1000).toFixed(1), '1D', d.Pt ? (d.Pt / 1000).toFixed(1) : '-', 'zone', zones.comp[((H / 2) | 0) * W + i]);
}
console.log('1D mdot', op.mdot.toFixed(1), 'bpr', op.bpr && op.bpr.toFixed(2));
