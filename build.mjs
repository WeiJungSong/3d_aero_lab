import fs from 'fs';
const rd = f => fs.readFileSync(f, 'utf8');
const strip = s => s.replace(/^if \(typeof module !== 'undefined'\)[^\n]*\n?/gm, '');
const bundle = files => files.map(f => `/* ---- ${f}.js ---- */\n` + strip(rd(`src/${f}.js`))).join('\n');
const fonts = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=B612:wght@400;700&family=B612+Mono:wght@400;700&family=Noto+Sans+TC:wght@400;500;700&display=swap">';
const cdn = '<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/build/three.min.js"></script>\n<script src="https://cdn.jsdelivr.net/npm/three@0.147.0/examples/js/controls/OrbitControls.js"></script>';
const three = rd('node_modules/three/build/three.min.js');
const orbit = rd('node_modules/three/examples/js/controls/OrbitControls.js');
const css = rd('src/style.css');
function make({ files, body, title, out, debug }) {
  const js = `(function(){'use strict';\n${bundle(files)}\nboot();${process.env.DEBUG ? debug : ''}\nif (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { try { onResize(); } catch (e) {} });\n})();`;
  const t = `<title>${title}</title>`, b = rd(body);
  // Artifact 版（無 doctype 骨架，由平台包裝）
  const art = `${t}\n${fonts}\n<style>\n${css}\n</style>\n${b}\n${cdn}\n<script>\n${js}\n</script>\n`;
  fs.writeFileSync(`dist/${out}.html`, art);
  // 本機獨立版（內嵌 three.js，可離線開啟）
  const sa = `<!doctype html>\n<html lang="zh-Hant">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${t}\n${fonts}\n<style>\n${css}\n</style>\n</head>\n<body>\n${b}\n<script>${three}</script>\n<script>${orbit}</script>\n<script>\n${js}\n</script>\n</body>\n</html>\n`;
  fs.writeFileSync(`dist/${out}-standalone.html`, sa);
  console.log(out, 'artifact', (art.length / 1024).toFixed(0) + 'KB', 'standalone', (sa.length / 1024).toFixed(0) + 'KB');
}
const which = process.argv[2] || 'all';
if (which === 'all' || which === 'v1') make({ files: ['physics', 'geometry', 'field', 'app_scene', 'app_main'], body: 'src/body.html', title: '引擎剖面實驗室', out: 'engine-lab', debug: 'window.__EL={S,CUR,R3,request,setView};' });
if (which === 'all' || which === 'cfd') make({ files: ['physics', 'geometry', 'field', 'app_scene', 'cfd_grid', 'cfd_cpu', 'cfd_post', 'cfd_gpu', 'app_cfd'], body: 'src/body_cfd.html', title: '引擎 CFD 實驗室', out: 'engine-cfd', debug: 'window.__EL={S,CUR,R3,CFD,request,setView,toggleRun};' });
if (which === 'all' || which === 'air') make({ files: ['physics', 'geometry', 'field', 'app_scene', 'panel', 'aircraft', 'aero', 'perf', 'air_field', 'air_scene', 'air_charts', 'air_cfd', 'app_air'], body: 'src/body_air.html', title: '全機氣動實驗室', out: 'aircraft-lab', debug: 'window.__AL={S,CUR,R3,SL,G3,PF,CFD3,CFD_GRIDS,cfdGrid,cfdGeom,cfdForceList,cfdForces,CfdGPU,CfdCPU,CG,DEG,request,setView,updateCondition,rebuildGeometry,switchType,setMode};' });
