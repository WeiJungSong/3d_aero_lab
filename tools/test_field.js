const fs=require('fs'), vm=require('vm');
const code = ['physics','geometry','field'].map(f=>fs.readFileSync('src/'+f+'.js','utf8').replace(/if \(typeof module[^\n]*\n/g,'')).join('\n');
vm.runInThisContext(code + '\nglobalThis.API={solveEngine,ENGINE_TYPES,DEFAULT_EFF,buildSpec,FieldModel,GridMap,computeGrid,computeSection,tsPath,axialSeries,plumeSeries};');
const {solveEngine,ENGINE_TYPES,DEFAULT_EFF,buildSpec,FieldModel,GridMap,computeGrid,tsPath,axialSeries} = API;
function make(type, alt, M0, thr, ab){
  const T=ENGINE_TYPES[type];
  const P={type,design:{...T.design},eff:{...DEFAULT_EFF},alt,M0,thr,ab,Tt7:type==='lbtf'?2100:2000,nozzleType:T.nozzle};
  const sol=solveEngine(P);
  const s=Math.sqrt(P.design.mdot/T.design.mdot);
  const noz = sol.op.noz; 
  const nozR = {r8: Math.sqrt(noz.Athroat/Math.PI), r9: Math.sqrt(noz.A/Math.PI)};
  const spec=buildSpec(type,s,nozR);
  const m=new FieldModel(spec,sol,P);
  return {P,sol,spec,m};
}
for (const [type,alt,M0,thr,ab] of [['hbtf',0,0,1,false],['hbtf',10668,0.78,0.88,false],['tj',0,0,1,true],['lbtf',11000,1.6,1,true]]) {
  const {m,spec}=make(type,alt,M0,thr,ab);
  console.log('==',type,alt,M0,thr,ab,'chokes',m.chokes.length, 'exits', m.exits.map(e=>`${e.key} R=${e.R.toFixed(3)} U=${e.U.toFixed(0)} Tt=${e.Tt.toFixed(0)} P=${(e.P/1000).toFixed(1)} Ls=${e.Ls.toFixed(2)}`).join(' | '));
  for (const key in m.kn) console.log(key, m.kn[key].map(k=>`${k.x.toFixed(2)}:${k.Tt.toFixed(0)}/${(k.Pt/1000).toFixed(0)}/M${k.M.toFixed(2)}`).join(' '));
  const pts = [[-1,0],[0.2,0.5],[0.7,0.5],[1.1,0.36],[1.1,0.65],[1.8,0.2],[2.25,0.26],[2.25,0.33],[2.3,0.27],[2.9,0.3],[3.3,0.3],[4,0.1],[6,0.3],[8,0.1],[4,0.6],[3.6,1.2]];
  const o={};
  for (const [x,r] of pts){ m.sample(x*spec.s,r*spec.s,0,o); console.log(`  (${x},${r}) ${o.region}/${o.stream||o.mat||''}/${o.zone||''}`+(o.solid?'':` T=${o.T.toFixed(0)} Tt=${o.Tt.toFixed(0)} P=${(o.P/1000).toFixed(1)} V=${o.V.toFixed(0)} M=${o.M.toFixed(2)}`)); }
  const map=new GridMap(spec.domain,800,176);
  let t=Date.now(); const G=computeGrid(m,map,0); console.log('grid ms',Date.now()-t);
  let nan=0; for (let i=0;i<G.T.length;i++) if (G.reg[i]!==1 && !(G.T[i]>0)) nan++; console.log('nan fluid',nan);
  let mn=[1e9,1e9], mx=[0,0]; for (let i=0;i<G.T.length;i++) if (G.reg[i]!==1){mn[0]=Math.min(mn[0],G.T[i]);mx[0]=Math.max(mx[0],G.T[i]);mn[1]=Math.min(mn[1],G.M[i]);mx[1]=Math.max(mx[1],G.M[i]);}
  console.log('T range',mn[0].toFixed(0),mx[0].toFixed(0),'M range',mn[1].toFixed(2),mx[1].toFixed(2));
  const ts=tsPath(m); console.log('ts', ts.pts.filter(p=>p.id).map(p=>`${p.id}:${p.T.toFixed(0)}K,s=${p.s.toFixed(0)}`).join(' '));
}
