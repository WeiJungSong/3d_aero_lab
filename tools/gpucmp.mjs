import { chromium } from 'playwright';
import fs from 'fs';
const files = ['physics','geometry','field','cfd_grid','cfd_cpu','cfd_post','cfd_gpu'].map(f => fs.readFileSync('src/'+f+'.js','utf8').replace(/^if \(typeof module[^\n]*\n/gm,''));
const type = process.argv[2] || 'tj', iters = +(process.argv[3] || 5), level = process.argv[4] || 'xcoarse';
const html = `<!doctype html><html><body><script>${files.join('\n')}
window.runCmp = function(type, iters, level){
  const T=ENGINE_TYPES[type];
  const P={type,design:{...T.design},eff:{...DEFAULT_EFF},alt:0,M0:0.3,thr:1,ab:type!=='hbtf',Tt7:2000,nozzleType:T.nozzle};
  const sol=solveEngine(P), op=sol.op, fl=sol.fl, nz=op.noz;
  const spec=buildSpec(type,1,{r8:Math.sqrt(nz.Athroat/Math.PI), r9:Math.sqrt(Math.max(nz.A,nz.Athroat)/Math.PI), A9:sol.ref.noz&&sol.ref.noz.A, A19:sol.ref.nozB&&sol.ref.nozB.A});
  const model=new FieldModel(spec,sol,P);
  const grid=buildCFDGrid(spec,level), zones=buildZones(grid,spec,model,op,P), comps=compParams(type,op,P);
  const Q0=initialState(grid,zones,spec,model,fl,false);
  const fsS={r:fl.P0/(287.05*fl.T0),u:fl.V0,p:fl.P0};
  const cpu=new CPUSolver(grid,zones,comps,fsS,Q0,{cfl:0.6,order:2,visc:true});
  let gpu; try { gpu=new GPUSolver(grid,zones,comps,fsS,Q0,{cfl:0.6,order:2,visc:true}); } catch(e){ return 'GPU ERR '+e.message; }
  const t0=performance.now(); cpu.step(iters); const t1=performance.now(); gpu.step(iters); const Qg=gpu.read(); const t2=performance.now();
  const names=['rho','rhou','rhov','E','rhoY']; const out=[];
  for (let q=0;q<5;q++){ let md=0, mi=-1, scale=0; for(let k=0;k<grid.N;k++){ if(zones.solid[k]) continue; scale=Math.max(scale,Math.abs(cpu.Q[q][k])); }
    for(let k=0;k<grid.N;k++){ if(zones.solid[k]) continue; const d=Math.abs(cpu.Q[q][k]-Qg[q][k]); if(d>md){md=d;mi=k;} }
    out.push(names[q]+' maxdiff/scale='+(md/scale).toExponential(2)+' at '+(mi%grid.W)+','+((mi/grid.W)|0)+' cpu='+cpu.Q[q][mi]?.toFixed?.(3)+' gpu='+Qg[q][mi]?.toFixed?.(3)); }
  for (const [nm, A1, A2] of [['src', cpu.src, gpu.src], ['mfx', cpu.mfx, gpu.mfx]]) { let md=0, sc=0, mi=-1; for(let k=0;k<grid.N;k++){ if(zones.solid[k]) continue; sc=Math.max(sc,Math.abs(A1[k])); const d=Math.abs(A1[k]-A2[k]); if(d>md){md=d;mi=k;} } out.push(nm+' maxdiff/scale='+(md/(sc||1)).toExponential(2)+' at '+(mi%grid.W)+','+((mi/grid.W)|0)+' cpu='+A1[mi]+' gpu='+A2[mi]); }
  const fc=cfdForces(grid,zones,cpu.Q,comps,fl.P0,0,{S:cpu.src,F:cpu.mfx}), fg=cfdForces(grid,zones,Qg,comps,fl.P0,0,{S:gpu.src,F:gpu.mfx});
  out.push('F cpu '+(fc.F/1e3).toFixed(3)+' gpu '+(fg.F/1e3).toFixed(3)+' pw cpu '+Array.from(fc.pw).map(v=>(v/1e6).toFixed(3)).join(',')+' gpu '+Array.from(fg.pw).map(v=>(v/1e6).toFixed(3)).join(',')+' fuel '+fc.mfuel.toFixed(4)+'/'+fg.mfuel.toFixed(4));
  // bench
  const tb=performance.now(); gpu.step(20); gpu.read(); const tb2=performance.now();
  out.push('cpu ms/it '+((t1-t0)/iters).toFixed(1)+' gpu ms/it(swiftshader) '+((tb2-tb)/20).toFixed(1)+' cells '+grid.N);
  return out.join('\\n');
};
</script></body></html>`;
fs.writeFileSync('/tmp/gpucmp.html', html);
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('console', m => console.log('console:', m.text()));
page.on('pageerror', e => console.log('pageerror:', e.message));
await page.goto('file:///tmp/gpucmp.html');
const r = await page.evaluate(([t, n, l]) => window.runCmp(t, n, l), [type, iters, level]);
console.log(r);
await browser.close();
