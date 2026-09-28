import { chromium } from 'playwright';
const file = process.argv[2] || 'dist/engine-cfd-standalone.html';
const secs = +(process.argv[3] || 60), out = process.argv[4] || '';
const w = +(process.argv[5] || 1440), h = +(process.argv[6] || 1000);
const pre = process.argv[7] || '';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
const errs = [];
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning' || m.text().startsWith('[cfd]')) errs.push(m.type() + ': ' + m.text()); });
page.on('pageerror', e => errs.push('pageerror: ' + e.message + '\n' + e.stack));
await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
const t0 = Date.now();
await page.goto('file://' + process.cwd() + '/' + file);
await page.waitForTimeout(1500);
if (pre) { await eval(`(async()=>{${pre}})()`); }
for (let t = 0; t < secs; t += 5) {
  await page.waitForTimeout(5000);
  const st = await page.evaluate(() => { const E = window.__EL; if (!E) return 'no hook'; const C = E.CFD;
    return { kind: C.kind, N: C.grid && C.grid.N, lvl: C.grid && C.grid.level, seq: C.seqTarget, it: C.itTotal, res: C.res, ips: C.ips, F: C.forces && +(C.forces.F / 1000).toFixed(2), ratios: C.ratios && Array.from(C.ratios).map(v => +v.toFixed(3)), conv: C.conv, run: E.S.running, err: C.error || C.gpuError || null }; });
  console.log(((Date.now() - t0) / 1000).toFixed(0) + 's', JSON.stringify(st));
}
if (out) { await page.evaluate(() => { if (window.__EL) { window.__EL.S.anim = 0; window.__EL.R3.paused = false; } }); await page.waitForTimeout(600); await page.screenshot({ path: out, fullPage: true, timeout: 180000 }); }
console.log(errs.slice(0, 30).join('\n') || 'no console errors');
await browser.close();
