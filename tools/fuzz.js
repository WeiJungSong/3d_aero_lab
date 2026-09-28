const fs=require('fs'), vm=require('vm');
const code = ['physics','geometry','field'].map(f=>fs.readFileSync('src/'+f+'.js','utf8').replace(/if \(typeof module[^\n]*\n/g,'')).join('\n');
vm.runInThisContext(code + '\nglobalThis.API={solveEngine,ENGINE_TYPES,DEFAULT_EFF,buildSpec,FieldModel,GridMap,computeGrid,computeSection,tsPath};');
const {solveEngine,ENGINE_TYPES,DEFAULT_EFF,buildSpec,FieldModel,GridMap,computeGrid,computeSection,tsPath}=API;
const R={hbtf:{mdot:[150,700],opr:[15,55],fpr:[1.3,2.0],bpr:[3,12],pibst:[1.2,3.0],Tt4max:[1300,1900]},tj:{mdot:[30,150],opr:[5,25],Tt4max:[1000,1600]},lbtf:{mdot:[50,200],opr:[15,40],fpr:[2.2,5.0],Tt4max:[1400,2000]}};
let bad=0, n=0, warnCount={}, negF=0;
const rnd=(a,b)=>a+Math.random()*(b-a);
for (let it=0; it<600; it++) {
  const type=['hbtf','tj','lbtf'][it%3], T=ENGINE_TYPES[type];
  const design={...T.design}; for (const k in R[type]) design[k]=rnd(...R[type][k]);
  const eff={...DEFAULT_EFF, ef:rnd(.8,.95), ec:rnd(.8,.95), et:rnd(.8,.95), etb:rnd(.9,1), pib:rnd(.9,.99), pidmax:rnd(.9,1), pin:rnd(.95,1)};
  const P={type,design,eff,alt:rnd(0,T.hmax),M0:rnd(0,T.Mmax),thr:rnd(.5,1),ab:Math.random()<.5,Tt7:rnd(1500,2300),nozzleType:Math.random()<.5?'cd':'conv'};
  if (type==='hbtf') P.nozzleType='conv';
  let sol; try { sol=solveEngine(P); } catch(e){ console.log('THROW solve',e.message); bad++; continue; }
  const o=sol.op; n++;
  for (const w of o.warn) warnCount[w]=(warnCount[w]||0)+1;
  if (o.F<0) negF++;
  const vals=[o.F,o.tsfc,o.mdot,o.Tt5,o.Pt5,o.noz.V,o.noz.A,o.opr,o.bpr];
  if (vals.some(v=>!isFinite(v))) { bad++; if (bad<6) console.log('NaN', type, JSON.stringify({d:design,alt:P.alt,M0:P.M0,thr:P.thr,ab:P.ab}), vals.map(v=>+v.toFixed?.(3))); continue; }
  if (it%10===0) {
    const s=Math.sqrt(design.mdot/T.design.mdot), nz=o.noz;
    const spec=buildSpec(type,s,{r8:Math.sqrt(nz.Athroat/Math.PI), r9:Math.sqrt(Math.max(nz.A,nz.Athroat)/Math.PI)});
    let m; try { m=new FieldModel(spec,sol,P); } catch(e){ console.log('THROW model',type,e.message); bad++; continue; }
    const G=computeGrid(m,new GridMap(spec.domain,200,50),0.3);
    let nan=0; for (let i=0;i<G.T.length;i++) if (G.reg[i]!==1 && !(G.T[i]>0 && G.P[i]>0 && isFinite(G.M[i]))) nan++;
    const sec=computeSection(m, spec.comb.x1, spec.secR, 40, 20);
    const ts=tsPath(m); const tsBad=ts.pts.some(p=>!isFinite(p.s)||!isFinite(p.T));
    if (nan||tsBad) { bad++; console.log('field NaN',type,nan,tsBad, JSON.stringify({d:design,alt:P.alt|0,M0:P.M0.toFixed(2),thr:P.thr.toFixed(2),ab:P.ab,noz:P.nozzleType})); }
  }
}
console.log('runs',n,'bad',bad,'negF',negF); console.log(warnCount);
