/* v3 共用載入器：將 src 模組載入同一 vm 環境（與瀏覽器單一 HTML 相同的全域作用域） */
const fs = require('fs'), vm = require('vm'), path = require('path');
const FILES = ['physics', 'geometry', 'field', 'panel', 'aircraft', 'aero', 'perf', 'air_field', 'air_cfd'];
vm.runInThisContext(FILES.map(f => fs.readFileSync(path.join(__dirname, '..', 'src', f + '.js'), 'utf8').replace(/^if \(typeof module[^\n]*\n/gm, '')).join('\n'));
/* 各機型的引擎（海平面設計點決定噴嘴面積與幾何） */
globalThis.engineFor = function (type) {
  const T = AIRCRAFT_TYPES[type], et = T.engine, E = ENGINE_TYPES[et];
  const P = { type: et, design: { ...E.design }, eff: { ...DEFAULT_EFF }, alt: 0, M0: 0, thr: 1, ab: false, Tt7: et === 'lbtf' ? 2100 : 2000, nozzleType: E.nozzle };
  const sol = solveEngine(P), nz = sol.op.noz;
  const spec = buildSpec(et, 1, { r8: Math.sqrt(nz.Athroat / Math.PI), r9: Math.sqrt(Math.max(nz.A, nz.Athroat) / Math.PI), A9: sol.ref.noz && sol.ref.noz.A, A19: sol.ref.nozB && sol.ref.nozB.A });
  return { spec, sol, P };
};
