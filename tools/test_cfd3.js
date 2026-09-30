/* v3：3D Euler CPU 求解器（與 GPU 著色器相同演算法），列出各部位受力
 *  node tools/test_cfd3.js [機型] [格數] [迭代] [M] [α 度] [平尾 δ 度] */
require('./airlib.js');
const type = process.argv[2] || 'fighter', cells = +(process.argv[3] || 40000), iters = +(process.argv[4] || 400), M = +(process.argv[5] || 0.6), alpha = +(process.argv[6] || 3), delta = +(process.argv[7] || 0);
const ac = buildAircraft(type, {}, engineFor(type)); aircraftPanels(ac, 'medium');
const G = new AirGeom(ac); CFD_GRIDS.coarse.cells = cells;
const g = cfdGrid(ac, 'coarse'), geo = cfdGeom(ac, G, g, delta), list = cfdForceList(g, geo);
console.log(`${type} 網格 ${g.NX}×${g.NY}×${g.NZ} = ${g.N}，近場格距 ${g.h.toFixed(3)} m，實體 ${geo.nSolid}、切割 ${geo.nCut}、受力格 ${list.length}`);
const s = new CfdCPU(g, geo), a = alpha * DEG, F = [1, M * Math.cos(a), 0, M * Math.sin(a), 1 / (CG * (CG - 1)) + 0.5 * M * M];
s.setFree(F); s.setFix([F, F, F]); s.reset();
const t0 = Date.now();
for (let it = 50; it <= iters; it += 50) { s.step(50); const f = cfdForces(g, list, s.read(), alpha, M, ac.ref.S, ac.ref.xcg, 0, ac.ref.c); console.log(`  迭代 ${it}: CL ${f.CL.toFixed(4)} CD ${f.CD.toFixed(5)} Cm ${f.Cm.toFixed(4)}（${((Date.now() - t0) / it).toFixed(0)} ms/迭代）`); }
