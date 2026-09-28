// 檢查：各流道在其 x 範圍內部是否與其他流體區直接相通（缺壁）
const { setup } = require('./cfdlib.js');
for (const type of ['hbtf', 'tj', 'lbtf']) for (const level of ['xcoarse', 'medium']) {
  const C = setup(type, level); const { grid, zones, spec } = C, { W, H, xc } = grid; const bad = {};
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W; i++) {
    const k = j * W + i, ku = k + W; if (zones.solid[k] || zones.solid[ku] || zones.an[k] <= 0) continue;
    const a = zones.stream[k], b = zones.stream[ku]; if (a === b) continue;
    for (const s of [a, b]) { if (s < 0) continue; const st = spec.streams[spec.order[s]]; if (xc[i] > st.x0 + 0.03 && xc[i] < st.x1 - 0.03) { const key = spec.order[s] + '↔' + (s === a ? b : a); (bad[key] = bad[key] || []).push(xc[i].toFixed(2)); } }
  }
  console.log(type, level, Object.entries(bad).map(([k, v]) => `${k}: ${v.length} @ ${[...new Set(v)].slice(0, 8).join(',')}`).join(' | ') || 'OK');
}
