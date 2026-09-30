/* ============================================================
 *  air_scene.js — 全機 3D 場景：機體表面網格（依場變數著色）、裝機引擎、剖面、流線粒子
 *  場景以 world 群組承載機體座標（x 向後、y 右翼、z 向上），world 旋轉使 z 朝螢幕上方
 * ============================================================ */
const LUTL = {};
function lutLinear(key) {
  if (LUTL[key]) return LUTL[key];
  const s = LUTS[key], l = new Float32Array(768);
  for (let i = 0; i < 768; i++) { const c = s[i] / 255; l[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  return (LUTL[key] = l);
}
const HATCH_AIR = { 1: [40, 48, 58], 2: [96, 80, 58] };

function initAirScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.localClippingEnabled = true;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'gl';
  host.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.2, 5000);
  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.rotateSpeed = 0.8;
  controls.minDistance = 2; controls.maxDistance = 900;
  const pm = new THREE.PMREMGenerator(renderer), env = new THREE.Scene();
  env.add(new THREE.Mesh(new THREE.BoxGeometry(30, 16, 30), new THREE.MeshBasicMaterial({ color: 0x2a3440, side: THREE.BackSide })));
  const lamp = (w, h, x, y, z, c) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: c, side: THREE.DoubleSide })); m.position.set(x, y, z); m.rotation.x = Math.PI / 2; env.add(m); };
  lamp(18, 3, 0, 7.8, 0, 0xffffff); lamp(3, 10, 8, 7.5, -6, 0xcfe4ff); lamp(4, 12, -9, 7.5, 5, 0xfff1dc);
  scene.environment = pm.fromScene(env, 0.035).texture;
  scene.add(new THREE.HemisphereLight(0xdfe8f3, 0x151a20, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(-3, 7, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9ec0ff, 0.5); rim.position.set(6, 2, -5); scene.add(rim);
  const floor = new THREE.GridHelper(1600, 160, 0x243140, 0x18222c);
  floor.material.transparent = true; floor.material.opacity = 0.5; floor.material.depthWrite = false;
  scene.add(floor);
  const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world); world.updateMatrixWorld(true);
  Object.assign(R3, { renderer, scene, camera, controls, floor, host, world });
  R3.cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0);
  R3.clipOn = false;
  const cp = { clippingPlanes: [R3.cut], side: THREE.DoubleSide };
  R3.m = {
    skin: new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, metalness: 0.08, roughness: 0.52, envMapIntensity: 0.55 }, cp)),
    casing: new THREE.MeshStandardMaterial(Object.assign({ color: 0x8f98a2, metalness: 0.8, roughness: 0.34 }, cp)),
    hub: new THREE.MeshStandardMaterial(Object.assign({ color: 0x77808b, metalness: 0.82, roughness: 0.32 }, cp)),
    cowl: new THREE.MeshStandardMaterial(Object.assign({ color: 0xaab2bb, metalness: 0.45, roughness: 0.4 }, cp)),
    liner: new THREE.MeshStandardMaterial(Object.assign({ color: 0xb3905c, metalness: 0.7, roughness: 0.38 }, cp)),
    fh: new THREE.MeshStandardMaterial(Object.assign({ color: 0x6f6a64, metalness: 0.7, roughness: 0.45 }, cp)),
    nacelle: new THREE.MeshStandardMaterial(Object.assign({ color: 0xb9c0c8, metalness: 0.15, roughness: 0.5 }, cp)),
    spinner: new THREE.MeshStandardMaterial(Object.assign({ color: 0xffffff, metalness: 0.35, roughness: 0.35, map: spiralTexture() }, cp)),
    blade: new THREE.MeshStandardMaterial(Object.assign({ color: 0x97a0aa, metalness: 0.85, roughness: 0.3 }, cp)),
    bladeHot: new THREE.MeshStandardMaterial(Object.assign({ color: 0xd9cdb2, metalness: 0.2, roughness: 0.6 }, cp)),
  };
  R3.air = new THREE.Group(); R3.engs = new THREE.Group(); world.add(R3.air, R3.engs);
  R3.sliceTex = makeDataTex(4, 4);
  R3.slice = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: R3.sliceTex, side: THREE.DoubleSide, transparent: true, alphaTest: 0.02, toneMapped: false, depthWrite: true }));
  R3.slice.renderOrder = 1; world.add(R3.slice);
  R3.sliceEdge = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x45cfe0, transparent: true, opacity: 0.55, toneMapped: false }));
  world.add(R3.sliceEdge);
  R3.marker = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false }));
  R3.marker.renderOrder = 5; R3.marker.visible = false; world.add(R3.marker);
  R3.pin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xf3b43f, toneMapped: false, depthTest: false }));
  R3.pin.renderOrder = 5; R3.pin.visible = false; world.add(R3.pin);
  initAirParticles();
  R3.raycaster = new THREE.Raycaster();
  R3.clock = new THREE.Clock();
  R3.built = true;
}
/* 剖切：保留 n·p + c ≥ 0 的一側（機體座標），轉換到世界座標 */
function setCut(on, nA, cA) {
  R3.clipOn = !!on;
  const want = on ? [R3.cut] : [];
  R3.cutA = on ? [nA[0], nA[1], nA[2], cA] : null;
  if (on) { R3.cut.normal.set(nA[0], nA[1], nA[2]); R3.cut.constant = cA; R3.cut.applyMatrix4(R3.world.matrixWorld); }
  for (const k in R3.m) { const m = R3.m[k]; if (m.clippingPlanes.length !== want.length) { m.clippingPlanes = want; m.needsUpdate = true; } }
}

/* ---------- 機體表面網格（顯示用細面元集合） ---------- */
function buildAirMesh(disp) {
  disposeGroup(R3.air);
  const pos = [], idx = [], vq = [], triQ = [], patchOf = [];
  let base = 0;
  for (let pi = 0; pi < disp.patches.length; pi++) {
    const pt = disp.patches[pi], N = pt.nodes, ni = pt.ni, nj = pt.nj, W = nj + 1;
    for (let i = 0; i <= ni; i++) for (let j = 0; j <= nj; j++) { const p = N[i][j]; pos.push(p[0], p[1], p[2]); vq.push([]); }
    for (let i = 0; i < ni; i++) for (let j = 0; j < nj; j++) {
      const q = pt.idx[i][j]; if (q < 0) continue;
      const a = base + i * W + j, b = base + (i + 1) * W + j, c = base + (i + 1) * W + j + 1, d = base + i * W + j + 1;
      if (!pt.flip) idx.push(a, b, c, a, c, d); else idx.push(a, d, c, a, c, b);
      triQ.push(q, q);
      vq[a - 0].push(q); vq[b].push(q); vq[c].push(q); vq[d].push(q);
    }
    base += (ni + 1) * W;
  }
  const nv = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(nv * 3).fill(0.6), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // 頂點 → 相鄰顯示面元（最多 6）
  const vOff = new Int32Array(nv + 1), vList = [];
  for (let v = 0; v < nv; v++) { vOff[v] = vList.length; for (const q of vq[v]) vList.push(q); }
  vOff[nv] = vList.length;
  const m1 = new THREE.Mesh(g, R3.m.skin), m2 = new THREE.Mesh(g, R3.m.skin);
  m2.scale.y = -1;
  R3.air.add(m1, m2);
  R3.airGeo = g; R3.airV = { off: vOff, list: Int32Array.from(vList), triQ: Int32Array.from(triQ), nv };
}
/* 顯示面元值 → 頂點色 */
function paintAirMesh(qVal, norm, lutKey) {
  const V = R3.airV; if (!V) return;
  const col = R3.airGeo.attributes.color.array, lut = lutLinear(lutKey);
  for (let v = 0; v < V.nv; v++) {
    let s = 0, n = 0;
    for (let k = V.off[v]; k < V.off[v + 1]; k++) { const x = qVal[V.list[k]]; if (x === x) { s += x; n++; } }
    if (!n) continue;
    const li = Math.round(norm(s / n) * 255) * 3;
    col[3 * v] = lut[li]; col[3 * v + 1] = lut[li + 1]; col[3 * v + 2] = lut[li + 2];
  }
  R3.airGeo.attributes.color.needsUpdate = true;
}
function setXray(on) {
  const m = R3.m.skin, t = !!on;
  if (m.transparent !== t) { m.transparent = t; m.opacity = t ? 0.16 : 1; m.depthWrite = !t; m.needsUpdate = true; }
}

/* ---------- 裝機引擎（機匣、葉片、整流錐）---------- */
function buildEngineGroups(ac) {
  disposeGroup(R3.engs);
  R3.spools = [];
  const sp = ac.spec, hb = sp.type === 'hbtf';
  const mm = new THREE.Matrix4();
  const one = () => {
    const g = new THREE.Group(), LP = new THREE.Group(), HP = new THREE.Group();
    for (const b of sp.bodies) {
      if (b.mat === 'nacelle') continue; // 短艙外罩以機體網格呈現（含表面著色）
      let pts = b.poly, open = false;
      if (b.mat === 'hub') { pts = sp.lines.hub.pts; open = true; if (hb) pts = pts.filter(p => p[0] >= 0.775 * sp.s); }
      g.add(new THREE.Mesh(latheGeo(pts, b.mat === 'liner' || b.mat === 'fh' ? 48 : 72, open), R3.m[b.mat] || R3.m.casing));
    }
    for (const row of sp.rows) {
      const geo = bladeGeo(row, sp), hot = row.kind === 'turb' || row.kind === 'ngv';
      const mesh = new THREE.InstancedMesh(geo, hot ? R3.m.bladeHot : R3.m.blade, row.n);
      const off = (row.x0 * 7.13) % 1;
      for (let i = 0; i < row.n; i++) { mm.makeRotationX(2 * Math.PI * (i + off) / row.n); mesh.setMatrixAt(i, mm); }
      mesh.instanceMatrix.needsUpdate = true;
      (row.rotor ? (row.spool === 'LP' ? LP : HP) : g).add(mesh);
    }
    if (hb) { const pts = sp.lines.hub.pts.filter(p => p[0] <= 0.78 * sp.s); LP.add(new THREE.Mesh(latheGeo(pts, 72, true), R3.m.spinner)); }
    g.add(LP, HP); R3.spools.push({ LP, HP });
    return g;
  };
  for (const e of ac.engines) {
    const g = one(); g.position.set(e.x0, e.y, e.z); R3.engs.add(g);
    if (e.y > 0.01) { const g2 = one(); g2.position.set(e.x0, -e.y, e.z); R3.engs.add(g2); }
  }
}

/* ---------- 剖面平面 ---------- */
function setSliceGeometry(sl) {
  const g = new THREE.BufferGeometry(), [u0, u1] = sl.U, [v0, v1] = sl.V, P = (u, v) => sl.to3(u, v);
  const c = [P(u0, v0), P(u1, v0), P(u1, v1), P(u0, v1)];
  g.setAttribute('position', new THREE.Float32BufferAttribute([...c[0], ...c[1], ...c[2], ...c[3]], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  R3.slice.geometry.dispose(); R3.slice.geometry = g;
  const e = new THREE.BufferGeometry(); e.setAttribute('position', new THREE.Float32BufferAttribute([...c[0], ...c[1], ...c[1], ...c[2], ...c[2], ...c[3], ...c[3], ...c[0]], 3));
  R3.sliceEdge.geometry.dispose(); R3.sliceEdge.geometry = e;
}

/* ---------- 流線粒子（短流線段：頭亮尾淡） ---------- */
const APMAX = 6000;
function initAirParticles() {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(APMAX * 6), 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(APMAX * 6), 3));
  g.setAttribute('alpha', new THREE.BufferAttribute(new Float32Array(APMAX * 2), 1));
  g.setDrawRange(0, 0);
  const mat = new THREE.ShaderMaterial({
    vertexShader: `attribute vec3 color; attribute float alpha; varying vec3 vC; varying float vA;
      void main(){ vC=color; vA=alpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `varying vec3 vC; varying float vA; void main(){ gl_FragColor=vec4(vC,vA); }`,
    transparent: true, depthWrite: false,
  });
  R3.pts = new THREE.LineSegments(g, mat); R3.pts.frustumCulled = false; R3.pts.renderOrder = 3;
  R3.world.add(R3.pts);
  R3.P = { n: 0, x: new Float32Array(APMAX), y: new Float32Array(APMAX), z: new Float32Array(APMAX), age: new Float32Array(APMAX), life: new Float32Array(APMAX), ex: new Uint8Array(APMAX) };
}
