const P = require('../src/physics.js');
function run(type, alt, M0, thr, ab, extra={}) {
  const T = P.ENGINE_TYPES[type];
  const p = { type, design: Object.assign({}, T.design, extra.design||{}), eff: Object.assign({}, P.DEFAULT_EFF), alt, M0, thr, ab, Tt7: extra.Tt7||2000, nozzleType: extra.noz || T.nozzle };
  const s = P.solveEngine(p); const o = s.op;
  const f = (v,d=1)=>v.toFixed(d);
  console.log(`${type} h=${alt} M=${M0} thr=${thr} ab=${ab}: F=${f(o.F/1000)}kN mdot=${f(o.mdot)} bpr=${f(o.bpr,2)} opr=${f(o.opr,1)} Tt4=${f(o.Tt4,0)} Tt3=${f(o.Tt3,0)} Tt5=${f(o.Tt5,0)} f=${f(o.f,4)} TSFC=${f(o.tsfc*1e6,2)}g/kNs (${f(o.tsfc*3600*9.80665,3)} lb/lbfh) etaTh=${f(o.etaTh,3)} etaP=${f(o.etaP,3)} N=${JSON.stringify(Object.fromEntries(Object.entries(o.N).map(([k,v])=>[k,+(v*100).toFixed(1)])))} lim=${o.limited} noz M=${f(o.noz.M,2)} V=${f(o.noz.V,0)} A=${f(o.noz.A,3)} At=${f(o.noz.Athroat,3)} ch=${o.noz.choked} ${o.nozB?`byp M=${f(o.nozB.M,2)} V=${f(o.nozB.V,0)} A=${f(o.nozB.A,3)}`:''} warn=${o.warn.join('|')}`);
  return s;
}
run('hbtf',0,0,1,false);
run('hbtf',0,0.25,1,false);
run('hbtf',10668,0.78,0.88,false);
run('hbtf',10668,0.78,1,false);
run('hbtf',0,0,0.6,false);
run('tj',0,0,1,false);
run('tj',0,0,1,true);
run('tj',11000,2.0,1,true);
run('tj',11000,0.9,0.8,false);
run('lbtf',0,0,1,false);
run('lbtf',0,0,1,true,{Tt7:2100});
run('lbtf',11000,1.6,1,true,{Tt7:2100});
run('lbtf',11000,0.9,0.8,false);
run('lbtf',0,0,0.6,false);
