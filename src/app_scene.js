/* ============================================================
 *  app_scene.js — Three.js 場景：機匣、葉片、剖面、粒子
 * ============================================================ */
const CMAPS = {
  thermal: ['#2a0593', '#41049d', '#5c01a6', '#7701a8', '#8f0da4', '#a62098', '#bb3488', '#cc4778', '#dc5b68', '#e97158', '#f48849', '#fca236', '#febd2a', '#f8db24', '#f0f921'],
  viridis: ['#46085c', '#482475', '#414487', '#355f8d', '#2a788e', '#21918c', '#22a884', '#44bf70', '#7ad151', '#bddf26', '#fde725'],
  flow: ['#18233f', '#1c3a6e', '#1d5a9a', '#1f7fb4', '#34a3c4', '#6cc6cc', '#aee3d6', '#e9f7ea'],
  mach: { stops: [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1], cols: ['#1b4fa8', '#3f74c4', '#7e98c2', '#a3a7ae', '#d59a6b', '#e56f3b', '#d83a22'] },
  cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#fee838'],
};
function hex2rgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function buildLUT(def) {
  const stops = Array.isArray(def) ? def.map((_, i) => i / (def.length - 1)) : def.stops;
  const cols = (Array.isArray(def) ? def : def.cols).map(hex2rgb);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1]) k++;
    const f = clamp((t - stops[k]) / (stops[k + 1] - stops[k]), 0, 1);
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(lerp(cols[k][c], cols[k + 1][c], f));
  }
  return lut;
}
const LUTS = {}; for (const k in CMAPS) LUTS[k] = buildLUT(CMAPS[k]);

const FIELDS = {
  T: { name: '靜溫', sym: 'T', unit: 'K', cmap: 'thermal', log: false, sc: 1, dec: 0 },
  Tt: { name: '總溫', sym: 'Tt', unit: 'K', cmap: 'thermal', log: false, sc: 1, dec: 0 },
  P: { name: '靜壓', sym: 'P', unit: 'kPa', cmap: 'viridis', log: true, sc: 1e-3, dec: 1 },
  Pt: { name: '總壓', sym: 'Pt', unit: 'kPa', cmap: 'viridis', log: true, sc: 1e-3, dec: 1 },
  V: { name: '速度', sym: 'V', unit: 'm/s', cmap: 'flow', log: false, sc: 1, dec: 0 },
  M: { name: '馬赫數', sym: 'M', unit: '', cmap: 'mach', log: false, sc: 1, dec: 2, diverge: true },
  rho: { name: '密度', sym: 'ρ', unit: 'kg/m³', cmap: 'cividis', log: true, sc: 1, dec: 3 },
};
/* 值 → [0,1] */
function makeNorm(key, range) {
  const f = FIELDS[key];
  const [a, b] = range;
  if (f.diverge) {
    const hi = Math.max(1.05, b);
    return v => v <= 1 ? 0.5 * clamp(v, 0, 1) : 0.5 + 0.5 * clamp((v - 1) / (hi - 1), 0, 1);
  }
  if (f.log) { const la = Math.log(a), lb = Math.log(b); return v => clamp((Math.log(v) - la) / (lb - la), 0, 1); }
  if (f.zc) { const m = Math.max(Math.abs(a), Math.abs(b), 1e-9); return v => clamp(0.5 + 0.5 * v / m, 0, 1); }
  return v => clamp((v - a) / (b - a), 0, 1);
}
function gridRange(G, key, extToo) {
  const A = G[key], R = G.reg;
  const vals = [];
  for (let i = 0; i < A.length; i += 3) { if (R[i] === 1) continue; if (!extToo && R[i] === 0) continue; const v = A[i]; if (v === v) vals.push(v); }
  if (!vals.length) return [0, 1];
  vals.sort((a, b) => a - b);
  let lo = vals[Math.floor(vals.length * 0.001)], hi = vals[vals.length - 1];
  if (key === 'V' || key === 'M') hi = vals[Math.floor(vals.length * 0.9995)];
  if (FIELDS[key].diverge) return [0, Math.max(1.2, hi)];
  if (FIELDS[key].zc) { const m = Math.max(Math.abs(vals[Math.floor(vals.length * 0.01)]), Math.abs(vals[Math.floor(vals.length * 0.99)]), 1e-6); return [-m, m]; }
  if (FIELDS[key].log) { lo = Math.max(lo, 1e-6); if (hi / lo < 1.2) { hi *= 1.1; lo /= 1.1; } }
  else if (hi - lo < 1e-6) { hi += 1; lo -= 1; }
  return [lo, hi];
}

/* ---------- 車削幾何（繞 x 軸） ---------- */
function latheGeo(poly, nSeg, open, uvScale) {
  const n = poly.length, E = open ? n - 1 : n;
  const en = [];
  for (let e = 0; e < E; e++) {
    const p = poly[e], q = poly[(e + 1) % n];
    const tx = q[0] - p[0], tr = q[1] - p[1], L = Math.hypot(tx, tr) || 1;
    en.push([-tr / L, tx / L, L]);
  }
  const cosT = Math.cos(40 * DEG);
  const nAt = (e, atEnd) => {
    const cur = en[e];
    const nb = atEnd ? (e + 1 < E ? en[e + 1] : (open ? null : en[0])) : (e > 0 ? en[e - 1] : (open ? null : en[E - 1]));
    if (!nb) return [cur[0], cur[1]];
    const d = cur[0] * nb[0] + cur[1] * nb[1];
    if (d < cosT) return [cur[0], cur[1]];
    const sx = cur[0] + nb[0], sr = cur[1] + nb[1], L = Math.hypot(sx, sr) || 1;
    return [sx / L, sr / L];
  };
  let per = 0; for (const e of en) per += e[2];
  const pos = [], nor = [], uv = [], idx = [];
  let acc = 0;
  for (let e = 0; e < E; e++) {
    const p = poly[e], q = poly[(e + 1) % n];
    const np = nAt(e, false), nq = nAt(e, true);
    const v0 = acc / per, v1 = (acc + en[e][2]) / per; acc += en[e][2];
    const base = pos.length / 3;
    for (let k = 0; k <= nSeg; k++) {
      const th = 2 * Math.PI * k / nSeg, c = Math.cos(th), s = Math.sin(th);
      pos.push(p[0], p[1] * c, p[1] * s, q[0], q[1] * c, q[1] * s);
      nor.push(np[0], np[1] * c, np[1] * s, nq[0], nq[1] * c, nq[1] * s);
      uv.push(k / nSeg, v0 * (uvScale || 1), k / nSeg, v1 * (uvScale || 1));
    }
    // 依法向決定繞向
    const ax = pos[base * 3], ay = pos[base * 3 + 1], az = pos[base * 3 + 2];
    const bx = pos[base * 3 + 3], by = pos[base * 3 + 4], bz = pos[base * 3 + 5];
    const cx = pos[base * 3 + 6], cy = pos[base * 3 + 7], cz = pos[base * 3 + 8];
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    let fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    let nn = [np[0], np[1], 0];
    if (Math.hypot(fx, fy, fz) < 1e-12) { // 軸上退化：改用 (b, d, c)
      const dx = pos[base * 3 + 9], dy = pos[base * 3 + 10], dz = pos[base * 3 + 11];
      const px = dx - bx, py = dy - by, pz = dz - bz, qx = cx - bx, qy = cy - by, qz = cz - bz;
      fx = py * qz - pz * qy; fy = pz * qx - px * qz; fz = px * qy - py * qx; nn = [nq[0], nq[1], 0];
    }
    const flip = fx * nn[0] + fy * nn[1] + fz * nn[2] < 0;
    for (let k = 0; k < nSeg; k++) {
      const a = base + 2 * k, b = a + 1, c = a + 2, d = a + 3;
      if (!flip) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ---------- 葉片 ---------- */
const BLADE = {
  fan: { st: [22, 60], cam: 0.07, tc: 0.045, sign: 1 },
  comp: { st: [36, 52], cam: 0.06, tc: 0.07, sign: 1 },
  vane: { st: [-26, -30], cam: 0.06, tc: 0.07, sign: 1 },
  igv: { st: [-10, -10], cam: 0.03, tc: 0.08, sign: 1 },
  ogv: { st: [-14, -12], cam: 0.06, tc: 0.07, sign: 1 },
  ngv: { st: [58, 54], cam: 0.16, tc: 0.14, sign: 1 },
  turb: { st: [-42, -52], cam: 0.2, tc: 0.13, sign: 1 },
  strut: { st: [0, 0], cam: 0, tc: 0.18, sign: 1 },
};
function bladeGeo(row, spec) {
  const st = spec.streams[row.stream];
  const xm = 0.5 * (row.x0 + row.x1);
  const rh = st.lo.at(xm), rt = st.hi.at(xm);
  const h = rt - rh, clr = 0.015 * h + 0.0008 * spec.s;
  const r0 = row.rotor ? rh + 0.001 : rh + clr, r1 = row.rotor ? rt - clr : rt - 0.001;
  const def = BLADE[row.role === 'igv' ? 'igv' : row.role === 'ogv' ? 'ogv' : row.kind] || BLADE.comp;
  const fan = row.kind === 'fan' && spec.type === 'hbtf';
  const small = (row.x1 - row.x0) < 0.05 * spec.s;
  const nS = fan ? 12 : small ? 3 : 5, nC = fan ? 10 : small ? 4 : 6;
  const cax = (row.x1 - row.x0);
  const pos = [], idx = [];
  const put = (x, r, t) => { const a = t / r; pos.push(x, r * Math.cos(a), r * Math.sin(a)); };
  for (let side = 0; side < 2; side++) {
    for (let j = 0; j <= nS; j++) {
      const t = j / nS, r = lerp(r0, r1, t);
      const beta = lerp(def.st[0], def.st[1], t) * DEG;
      const cb = Math.max(Math.cos(beta), 0.3);
      const caxT = fan ? cax * (0.72 + 0.28 * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1))) : cax;
      const cT = caxT / cb;
      const sweep = fan ? 0.12 * cax * t * t : 0;
      for (let i = 0; i <= nC; i++) {
        const u = i / nC - 0.5;
        const a = u * cT;
        const bc = def.cam * cT * (1 - 4 * u * u);
        const th = 0.5 * def.tc * cT * Math.sqrt(Math.max(0, 1 - 4 * u * u)) * (0.35 + 0.65 * (1 - t * 0.5));
        const b = bc + (side ? th : -th);
        const dx = a * Math.cos(beta) - b * Math.sin(beta);
        const dt = a * Math.sin(beta) + b * Math.cos(beta);
        put(xm + dx + sweep, r, dt);
      }
    }
  }
  const W = nC + 1, per = (nS + 1) * W;
  for (let side = 0; side < 2; side++) {
    const o = side * per;
    for (let j = 0; j < nS; j++) for (let i = 0; i < nC; i++) {
      const a = o + j * W + i, b = a + 1, c = a + W, d = c + 1;
      if (side) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
    }
  }
  // 葉尖封口
  const tipA = nS * W, tipB = per + nS * W;
  for (let i = 0; i < nC; i++) idx.push(tipA + i, tipB + i, tipA + i + 1, tipB + i, tipB + i + 1, tipA + i + 1);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ============================================================ */
const R3 = { built: false };
function initScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'gl';
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.02, 400);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.rotateSpeed = 0.8;
  controls.minDistance = 0.4; controls.maxDistance = 60;
  // 環境光照（程序生成反射環境）
  const pm = new THREE.PMREMGenerator(renderer);
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: 0x2a3440, side: THREE.BackSide }));
  env.add(room);
  const lamp = (w, h, x, y, z, c, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.x = Math.PI / 2; if (ry) m.rotation.y = ry; env.add(m); };
  lamp(18, 3, 0, 7.8, 0, 0xffffff); lamp(3, 10, 8, 7.5, -6, 0xcfe4ff); lamp(4, 12, -9, 7.5, 5, 0xfff1dc);
  const side = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: 0x9fb4c8 })); side.position.set(0, 1, -14.8); env.add(side);
  scene.environment = pm.fromScene(env, 0.035).texture;
  scene.add(new THREE.HemisphereLight(0xdfe8f3, 0x151a20, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(-3, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec0ff, 0.55); rim.position.set(6, 2, -5); scene.add(rim);
  const floor = new THREE.GridHelper(60, 120, 0x243140, 0x18222c);
  floor.material.transparent = true; floor.material.opacity = 0.55; floor.material.depthWrite = false;
  scene.add(floor);
  Object.assign(R3, { renderer, scene, camera, controls, floor, host });
  R3.clip = [new THREE.Plane(new THREE.Vector3(0, 0, -1), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
  R3.mats = makeMaterials();
  R3.engine = new THREE.Group(); scene.add(R3.engine);
  R3.spools = { LP: new THREE.Group(), HP: new THREE.Group() };
  R3.statics = new THREE.Group();
  R3.bodies = new THREE.Group();
  R3.engine.add(R3.bodies, R3.statics, R3.spools.LP, R3.spools.HP);
  // 剖面
  R3.texA = makeDataTex(4, 4); R3.texB = makeDataTex(4, 4);
  const sliceMat = t => new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide, transparent: true, alphaTest: 0.05, toneMapped: false });
  R3.sliceA = new THREE.Mesh(new THREE.BufferGeometry(), sliceMat(R3.texA));
  R3.sliceB = new THREE.Mesh(new THREE.BufferGeometry(), sliceMat(R3.texB));
  R3.sliceA.renderOrder = 1; R3.sliceB.renderOrder = 1;
  scene.add(R3.sliceA, R3.sliceB);
  // 橫截面
  R3.diskTex = makeDataTex(4, 4);
  R3.disk = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: R3.diskTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.5, toneMapped: false }));
  scene.add(R3.disk);
  R3.ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.004, 6, 128), new THREE.MeshBasicMaterial({ color: 0x45cfe0, toneMapped: false, transparent: true, opacity: 0.55 }));
  R3.ring.rotation.y = Math.PI / 2;
  scene.add(R3.ring);
  // 探針
  R3.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false }));
  R3.marker.renderOrder = 5; R3.marker.visible = false; scene.add(R3.marker);
  R3.pinGroup = new THREE.Group(); scene.add(R3.pinGroup);
  // 粒子
  initParticles();
  R3.raycaster = new THREE.Raycaster();
  R3.clock = new THREE.Clock();
  R3.built = true;
}
function makeDataTex(w, h) {
  const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat);
  t.encoding = THREE.sRGBEncoding; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
  t.needsUpdate = true; return t;
}
function resizeTex(t, w, h) {
  if (t.image.width === w && t.image.height === h) return t;
  t.image = { data: new Uint8Array(w * h * 4), width: w, height: h };
  t.dispose(); t.needsUpdate = true; return t;
}
function spiralTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#23282f'; g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const u = x / 256, v = y / 256;
    const f = ((u + v * 0.9) % 1 + 1) % 1;
    if (f < 0.07 && v < 0.93) { const i = (y * 256 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 238; }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
}
function makeMaterials() {
  const cp = () => ({ clippingPlanes: R3.clip, clipIntersection: true, side: THREE.DoubleSide });
  const M = (o) => new THREE.MeshStandardMaterial(Object.assign(cp(), o));
  const B = (o) => new THREE.MeshStandardMaterial(Object.assign({ side: THREE.DoubleSide }, o));
  return {
    nacelle: M({ color: 0xb9c0c8, metalness: 0.15, roughness: 0.5, envMapIntensity: 0.7 }),
    casing: M({ color: 0x8f98a2, metalness: 0.8, roughness: 0.34 }),
    hub: M({ color: 0x77808b, metalness: 0.82, roughness: 0.32 }),
    cowl: M({ color: 0xaab2bb, metalness: 0.45, roughness: 0.4 }),
    liner: M({ color: 0xb3905c, metalness: 0.7, roughness: 0.38 }),
    fh: M({ color: 0x6f6a64, metalness: 0.7, roughness: 0.45 }),
    spinner: M({ color: 0xffffff, metalness: 0.35, roughness: 0.35, map: spiralTexture() }),
    b_fan: B({ color: 0x8f98a3, metalness: 0.85, roughness: 0.3, envMapIntensity: 0.65 }),
    b_comp: B({ color: 0xa3abb4, metalness: 0.8, roughness: 0.34, envMapIntensity: 0.6 }),
    b_vane: B({ color: 0x7a838e, metalness: 0.75, roughness: 0.4, envMapIntensity: 0.6 }),
    b_ngv: B({ color: 0xcdbf9e, metalness: 0.25, roughness: 0.62 }),
    b_hpt: B({ color: 0xd9cdb2, metalness: 0.2, roughness: 0.6 }),
    b_lpt: B({ color: 0x7c8590, metalness: 0.78, roughness: 0.4, envMapIntensity: 0.6 }),
    b_strut: B({ color: 0x6d7580, metalness: 0.7, roughness: 0.45 }),
  };
}
function bladeMat(row) {
  const m = R3.mats;
  if (row.kind === 'fan') return m.b_fan;
  if (row.kind === 'comp') return m.b_comp;
  if (row.kind === 'vane') return m.b_vane;
  if (row.kind === 'strut') return m.b_strut;
  if (row.kind === 'ngv') return row.comp === 'hpt' || (row.comp === 'turb' && row.stage === 0) ? m.b_ngv : m.b_vane;
  if (row.kind === 'turb') return row.comp === 'hpt' || (row.comp === 'turb' && row.stage === 0) ? m.b_hpt : m.b_lpt;
  return m.b_comp;
}
function disposeGroup(g) {
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    if (c.geometry) c.geometry.dispose();
    g.remove(c);
  }
}
/* 建立機匣與葉片（引擎類型或尺寸改變時） */
function buildEngineMeshes(spec, bladesOnly) {
  if (!bladesOnly) buildBodies(spec);
  disposeGroup(R3.statics); disposeGroup(R3.spools.LP); disposeGroup(R3.spools.HP);
  const mm = new THREE.Matrix4();
  for (const row of spec.rows) {
    const g = bladeGeo(row, spec);
    const mesh = new THREE.InstancedMesh(g, bladeMat(row), row.n);
    const off = (row.x0 * 7.13) % 1;
    for (let i = 0; i < row.n; i++) { mm.makeRotationX(2 * Math.PI * (i + off) / row.n); mesh.setMatrixAt(i, mm); }
    mesh.instanceMatrix.needsUpdate = true;
    (row.rotor ? R3.spools[row.spool || 'HP'] : R3.statics).add(mesh);
  }
  // HBTF 整流錐（隨低壓軸旋轉）
  if (spec.type === 'hbtf') {
    const hub = spec.lines.hub, xs = 0.78 * spec.s;
    const pts = hub.pts.filter(p => p[0] <= xs);
    const m = new THREE.Mesh(latheGeo(pts, 96, true), R3.mats.spinner);
    R3.spools.LP.add(m);
  }
}
function buildBodies(spec) {
  disposeGroup(R3.bodies);
  for (const b of spec.bodies) {
    let pts = b.poly, open = false;
    if (b.mat === 'hub') {
      const hub = spec.lines.hub;
      pts = hub.pts; open = true;
      if (spec.type === 'hbtf') pts = hub.pts.filter(p => p[0] >= 0.775 * spec.s);
    }
    const g = latheGeo(pts, b.mat === 'liner' || b.mat === 'fh' ? 64 : 96, open);
    const m = new THREE.Mesh(g, R3.mats[b.mat] || R3.mats.casing);
    R3.bodies.add(m);
  }
}
/* 剖面網格：依非均勻映射斷點建立平面 */
function sliceGeometry(dom) {
  const pos = [], uv = [], idx = [];
  const nx = dom.xb.length, nr = dom.rb.length;
  for (let j = 0; j < nr; j++) for (let i = 0; i < nx; i++) { pos.push(dom.xb[i], dom.rb[j], 0); uv.push(dom.ub[i], dom.vb[j]); }
  for (let j = 0; j < nr - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
function diskGeometry(x, R, th0, th1) {
  const nT = 96, nR = 24, pos = [], uv = [], idx = [];
  for (let j = 0; j <= nR; j++) for (let i = 0; i <= nT; i++) {
    const r = R * j / nR, th = lerp(th0, th1, i / nT);
    pos.push(x, r * Math.cos(th), r * Math.sin(th));
    const u = (((th / (2 * Math.PI)) % 1) + 1) % 1;
    uv.push(u, j / nR);
  }
  for (let j = 0; j < nR; j++) for (let i = 0; i < nT; i++) {
    const a = j * (nT + 1) + i, b = a + 1, c = a + nT + 1, d = c + 1;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); return g;
}
/* 剖切楔形：clipIntersection 邏輯見 README 註解 */
function setWedge(phi, w) {
  const p1 = R3.clip[0], p2 = R3.clip[1];
  p1.normal.set(0, Math.sin(phi), -Math.cos(phi)); p1.constant = 0;
  p2.normal.set(0, -Math.sin(phi + w), Math.cos(phi + w)); p2.constant = 0;
  const on = w > 1e-3;
  for (const k in R3.mats) {
    const m = R3.mats[k];
    if (k.startsWith('b_')) continue;
    const want = on ? R3.clip : null;
    const inter = w <= Math.PI + 1e-6;
    if (m.clippingPlanes !== want || m.clipIntersection !== inter) { m.clippingPlanes = want; m.clipIntersection = inter; m.needsUpdate = true; }
  }
  R3.sliceA.rotation.x = phi; R3.sliceB.rotation.x = phi + w;
  R3.sliceA.visible = on; R3.sliceB.visible = on && w < 2 * Math.PI - 0.01;
}

/* ---------- 粒子 ---------- */
const PMAX = 8000;
function initParticles() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(PMAX), 1));
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uSize: { value: 0.02 }, uScale: { value: 400 } },
    vertexShader: `attribute vec3 color; attribute float alpha; uniform float uSize; uniform float uScale; varying vec3 vC; varying float vA;
      void main(){ vC=color; vA=alpha; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=max(1.5, uSize*uScale/(-mv.z)); gl_Position=projectionMatrix*mv; }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ vec2 d=gl_PointCoord-0.5; float r=length(d); if(r>0.5) discard;
      float a=smoothstep(0.5,0.18,r)*vA; vec3 c=mix(vC, vec3(1.0), 0.28*smoothstep(0.22,0.0,r)); gl_FragColor=vec4(c,a); }`,
    transparent: true, depthWrite: false,
  });
  R3.pts = new THREE.Points(g, mat);
  R3.pts.frustumCulled = false; R3.pts.renderOrder = 3;
  R3.scene.add(R3.pts);
  R3.P = { n: 0, x: new Float32Array(PMAX), psi: new Float32Array(PMAX), th: new Float32Array(PMAX), st: new Int8Array(PMAX), age: new Float32Array(PMAX), ext: new Uint8Array(PMAX) };
}
