/* v3：三機型面元法配平、巡航性能、起降與任務剖面摘要
 *  node tools/test_air.js [coarse|medium|fine] */
require('./airlib.js');
const res = process.argv[2] || 'medium';
for (const type of ['airliner', 'interceptor', 'fighter']) {
  const t0 = Date.now(), eng = engineFor(type), ac = buildAircraft(type, {}, eng), set = aircraftPanels(ac, res), areas = aircraftAreas(ac, set);
  const m = ac.T.mission, at = isa(m.cruiseH), q = 0.5 * at.rho * (m.cruiseM * at.a) ** 2, W = ac.mass.W, CL = W * G0 / (q * ac.ref.S);
  const pa = new PanelAero(ac, set, Math.min(m.cruiseM, 0.85)).prepareSync(), tr = pa.trim(CL);
  const CLt = tr.r.byc.htail || 0, trimK = (CLt / CL) ** 2 * ac.ref.S / (Math.PI * ac.htail.A * 0.9 * ac.htail.S);
  const deck = new EngineDeck(eng.P.type, eng.P.design, eng.P.eff, { Tt7: eng.P.Tt7 });
  const ctx = new PerfCtx(ac, areas, deck, { kA: tr.CLa / liftSlope(ac, pa.Mp), eInv: tr.r.e, trimK });
  const r = ctx.point(m.cruiseH, m.cruiseM, W, { thr: 'level' }), to = ctx.takeoff(W, 0, ac.T.internal), ld = ctx.landing(W * 0.85, 0), mi = ctx.mission(m, W);
  console.log(`${type}: 面元 ${pa.solver.N}（${Date.now() - t0} ms） α ${tr.alpha.toFixed(2)}° δ ${tr.delta.toFixed(2)}° CLα ${tr.CLa.toFixed(2)}/rad 靜穩定裕度 ${(-tr.Cma / tr.CLa * 100).toFixed(1)}% MAC e ${tr.r.e.toFixed(3)}`);
  console.log(`   巡航 h${m.cruiseH} M${m.cruiseM}: CL ${r.CL.toFixed(3)} CD ${(r.CD * 1e4).toFixed(0)} counts L/D ${r.LD.toFixed(1)} 油門 ${(r.thr * 100).toFixed(1)}% TSFC ${(r.sfc * 1e6).toFixed(1)} g/(kN·s)`);
  console.log(`   起飛地面滾行 ${to.sGround.toFixed(0)} m、降落 ${ld.sTotal.toFixed(0)} m；任務 ${m.range} km 耗油 ${mi.fuelUsed.toFixed(0)} kg ${mi.aborted ? '（' + mi.aborted + '）' : ''}`);
}
