/* ============================================================
 *  panel.js — 3D 低階面元法（Morino 公式：常強度源＋偶極四邊形面元）
 *  - 內部 Dirichlet 條件（內部擾動位勢 = 0），σ = v_n,指定 − n·V∞，μ = 外表面擾動位勢
 *  - 升力面後緣 Kutta 條件：尾跡偶極強度 = μ上 − μ下，尾跡沿 +x 延伸
 *  - 對稱半模（y ≥ 0），鏡像以反射場點計算
 *  - 可壓縮：Göthert 法則（x 伸長 1/β，α' = atan(β tanα)，Cp = Cp'/β²）
 *  座標：x 向後、y 向右翼、z 向上（機體座標，單位 m）
 * ============================================================ */
const FOUR_PI = 4 * Math.PI;

/* ---------- 基本向量運算（以陣列 [x,y,z]） ---------- */
const v3 = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
};

/* ============================================================
 *  面元集合
 *  addPatch({ name, comp, nodes: [ni+1][nj+1] 節點, state: [ni][nj]（1 有效、0 退化略過、-1 孔洞）,
 *             flip, vn: (i,j)=>transpiration 係數, te: [{up:[i,j], lo:[i,j]}...] 升力面後緣 })
 * ============================================================ */
function PanelSet() {
  this.P = []; // 面元
  this.patches = [];
  this.wakes = [];
}
PanelSet.prototype.addPatch = function (pt) {
  const { nodes } = pt, ni = nodes.length - 1, nj = nodes[0].length - 1;
  const idx = [];
  for (let i = 0; i < ni; i++) {
    idx.push(new Int32Array(nj).fill(-1));
    for (let j = 0; j < nj; j++) {
      const st = pt.state ? pt.state[i][j] : 1;
      if (st !== 1) continue;
      let c = [nodes[i][j], nodes[i + 1][j], nodes[i + 1][j + 1], nodes[i][j + 1]];
      if (pt.flip) c = [c[0], c[3], c[2], c[1]];
      const pan = makePanel(c);
      if (!pan || pan.A < 1e-4 * pan.D * pan.D) continue; // 退化面元（面積相對尺寸極小）
      pan.comp = pt.comp; pan.patch = this.patches.length; pan.i = i; pan.j = j;
      pan.vn = pt.vn ? pt.vn(i, j) : 0;
      idx[i][j] = this.P.length;
      this.P.push(pan);
    }
  }
  const rec = { name: pt.name, comp: pt.comp, ni, nj, idx, state: pt.state, wrapI: !!pt.wrapI, nodes, flip: !!pt.flip, vnf: pt.vn || null };
  this.patches.push(rec);
  // 後緣尾跡
  if (pt.te) for (const t of pt.te) {
    const ku = idx[t.up[0]][t.up[1]], kl = idx[t.lo[0]][t.lo[1]];
    if (ku < 0 || kl < 0) continue;
    this.wakes.push({ up: ku, lo: kl, a: t.a, b: t.b, comp: pt.comp, inner: !!t.inner, quad: t.quad || null });
  }
  return rec;
};
/* 由四角點建立面元：平均平面、投影角點、面積、形心、法向量、特徵尺寸 */
function makePanel(c) {
  let n = v3.cross(v3.sub(c[2], c[0]), v3.sub(c[3], c[1]));
  const nl = v3.len(n); if (nl < 1e-14) return null;
  n = v3.scale(n, 1 / nl);
  const cm = [(c[0][0] + c[1][0] + c[2][0] + c[3][0]) / 4, (c[0][1] + c[1][1] + c[2][1] + c[3][1]) / 4, (c[0][2] + c[1][2] + c[2][2] + c[3][2]) / 4];
  const q = c.map(p => { const d = v3.dot(v3.sub(p, cm), n); return v3.sub(p, v3.scale(n, d)); });
  // 兩個三角形（0,1,2）與（0,2,3）
  const t1 = v3.cross(v3.sub(q[1], q[0]), v3.sub(q[2], q[0])), t2 = v3.cross(v3.sub(q[2], q[0]), v3.sub(q[3], q[0]));
  const a1 = 0.5 * v3.dot(t1, n), a2 = 0.5 * v3.dot(t2, n), A = a1 + a2;
  if (!(A > 0)) return null;
  const g1 = [(q[0][0] + q[1][0] + q[2][0]) / 3, (q[0][1] + q[1][1] + q[2][1]) / 3, (q[0][2] + q[1][2] + q[2][2]) / 3];
  const g2 = [(q[0][0] + q[2][0] + q[3][0]) / 3, (q[0][1] + q[2][1] + q[3][1]) / 3, (q[0][2] + q[2][2] + q[3][2]) / 3];
  const cen = [(g1[0] * a1 + g2[0] * a2) / A, (g1[1] * a1 + g2[1] * a2) / A, (g1[2] * a1 + g2[2] * a2) / A];
  let D = 0; for (const p of q) D = Math.max(D, v3.len(v3.sub(p, cen)));
  // 邊：外向面內法向量 ν = (b−a) × n / l（逆時針排列時朝外）
  const edges = [];
  for (let e = 0; e < 4; e++) {
    const a = q[e], b = q[(e + 1) % 4], d = v3.sub(b, a), l = v3.len(d);
    if (l < 1e-12) continue;
    edges.push({ a, b, l, nu: v3.scale(v3.cross(d, n), 1 / l) });
  }
  return { c: c, q, n, A, cen, D: 2 * D, edges };
}

/* ---------- 影響係數 ---------- */
// 三角形立體角（+n 側為正），Van Oosterom–Strackee
function solidTri(P, a, b, c) {
  const R1x = a[0] - P[0], R1y = a[1] - P[1], R1z = a[2] - P[2];
  const R2x = b[0] - P[0], R2y = b[1] - P[1], R2z = b[2] - P[2];
  const R3x = c[0] - P[0], R3y = c[1] - P[1], R3z = c[2] - P[2];
  const r1 = Math.sqrt(R1x * R1x + R1y * R1y + R1z * R1z), r2 = Math.sqrt(R2x * R2x + R2y * R2y + R2z * R2z), r3 = Math.sqrt(R3x * R3x + R3y * R3y + R3z * R3z);
  const num = R1x * (R2y * R3z - R2z * R3y) + R1y * (R2z * R3x - R2x * R3z) + R1z * (R2x * R3y - R2y * R3x);
  if (Math.abs(num) < 1e-13 * r1 * r2 * r3) return 0;
  const den = r1 * r2 * r3 + (R1x * R2x + R1y * R2y + R1z * R2z) * r3 + (R1x * R3x + R1y * R3y + R1z * R3z) * r2 + (R2x * R3x + R2y * R3y + R2z * R3z) * r1;
  return -2 * Math.atan2(num, den);
}
function solidQuad(P, q) { return solidTri(P, q[0], q[1], q[2]) + solidTri(P, q[0], q[2], q[3]); }
/* 面元在 P 點的單位偶極位勢 D 與單位源位勢 S（φ = μD + σS），近場精確、遠場點近似 */
function influencePot(pan, P, out) {
  const dx = P[0] - pan.cen[0], dy = P[1] - pan.cen[1], dz = P[2] - pan.cen[2];
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > 25 * pan.D * pan.D) {
    const d = Math.sqrt(d2), nR = pan.n[0] * dx + pan.n[1] * dy + pan.n[2] * dz;
    out.D = pan.A * nR / (FOUR_PI * d2 * d);
    out.S = -pan.A / (FOUR_PI * d);
    return out;
  }
  const Om = solidQuad(P, pan.q);
  const h = pan.n[0] * dx + pan.n[1] * dy + pan.n[2] * dz;
  let I = -Math.abs(h) * Math.abs(Om);
  for (const e of pan.edges) {
    const ra = Math.hypot(P[0] - e.a[0], P[1] - e.a[1], P[2] - e.a[2]), rb = Math.hypot(P[0] - e.b[0], P[1] - e.b[1], P[2] - e.b[2]);
    const de = (e.a[0] - P[0]) * e.nu[0] + (e.a[1] - P[1]) * e.nu[1] + (e.a[2] - P[2]) * e.nu[2];
    const s = ra + rb, den = s - e.l;
    if (den > 1e-12 * s && Math.abs(de) > 1e-14) I += de * Math.log((s + e.l) / den);
  }
  out.D = Om / FOUR_PI;
  out.S = -I / FOUR_PI;
  return out;
}
/* 面元在 P 點的速度（單位偶極 vD、單位源 vS），近場：源用解析式、偶極等效渦環 */
function influenceVel(pan, P, vD, vS) {
  const dx = P[0] - pan.cen[0], dy = P[1] - pan.cen[1], dz = P[2] - pan.cen[2];
  const d2 = dx * dx + dy * dy + dz * dz, n = pan.n;
  if (d2 > 25 * pan.D * pan.D) {
    const d = Math.sqrt(d2), d3 = d2 * d, d5 = d3 * d2, nR = n[0] * dx + n[1] * dy + n[2] * dz, k = pan.A / FOUR_PI;
    vS[0] = k * dx / d3; vS[1] = k * dy / d3; vS[2] = k * dz / d3;
    vD[0] = k * (n[0] / d3 - 3 * nR * dx / d5); vD[1] = k * (n[1] / d3 - 3 * nR * dy / d5); vD[2] = k * (n[2] / d3 - 3 * nR * dz / d5);
    return;
  }
  const h = n[0] * dx + n[1] * dy + n[2] * dz;
  const Om = Math.abs(solidQuad(P, pan.q)), sg = h >= 0 ? 1 : -1;
  let sx = sg * Om * n[0], sy = sg * Om * n[1], sz = sg * Om * n[2];
  vD[0] = 0; vD[1] = 0; vD[2] = 0;
  for (const e of pan.edges) {
    const ax = P[0] - e.a[0], ay = P[1] - e.a[1], az = P[2] - e.a[2], bx = P[0] - e.b[0], by = P[1] - e.b[1], bz = P[2] - e.b[2];
    const ra = Math.sqrt(ax * ax + ay * ay + az * az), rb = Math.sqrt(bx * bx + by * by + bz * bz), s = ra + rb, den = s - e.l;
    if (den > 1e-12 * s) { const L = Math.log((s + e.l) / den); sx += e.nu[0] * L; sy += e.nu[1] * L; sz += e.nu[2] * L; }
    // 渦段（環量 1，方向 b→a），Biot–Savart；與偶極位勢梯度一致（已以位勢差分驗證）
    const cx = ay * bz - az * by, cy = az * bx - ax * bz, cz = ax * by - ay * bx;
    const c2 = cx * cx + cy * cy + cz * cz, dd = ra * rb * (ra * rb + ax * bx + ay * by + az * bz);
    if (c2 > 1e-20 * ra * ra * rb * rb && dd > 1e-20) { const f = -(ra + rb) / dd / FOUR_PI; vD[0] += f * cx; vD[1] += f * cy; vD[2] += f * cz; }
  }
  vS[0] = sx / FOUR_PI; vS[1] = sy / FOUR_PI; vS[2] = sz / FOUR_PI;
}

/* ============================================================
 *  求解器
 *  opt: { beta（x 伸長係數倒數）, wakeLen }
 * ============================================================ */
function PanelSolver(set, opt) {
  this.set = set; this.opt = Object.assign({ beta: 1, wakeLen: 200, wakeAng: 1.5 }, opt || {});
  this.build();
}
/* 以伸長座標（x/β）建立面元與尾跡 */
PanelSolver.prototype.build = function () {
  const b = this.opt.beta, st = p => [p[0] / b, p[1], p[2]];
  const P = this.set.P.map(p => { const q = makePanel(p.c.map(st)); Object.assign(q, { comp: p.comp, vn: p.vn, patch: p.patch, i: p.i, j: p.j }); return q; });
  // 固定尾跡：沿參考方向（機體 x 軸上仰 wakeAng，近似巡航攻角減下洗角）延伸
  const wAng = this.set.wakeAng !== undefined ? this.set.wakeAng : (this.opt.wakeAng || 0);
  const L = this.opt.wakeLen / b, wa = wAng * Math.PI / 180, ex = Math.cos(wa) * L, ez = Math.sin(wa) * this.opt.wakeLen;
  const W = this.set.wakes.map(w => {
    let q;
    if (w.quad) q = makePanel(w.quad.map(st));
    else { const a = st(w.a), bb = st(w.b); q = makePanel([a, [a[0] + ex, a[1], a[2] + ez], [bb[0] + ex, bb[1], bb[2] + ez], bb]); }
    return q ? Object.assign(q, { up: w.up, lo: w.lo, comp: w.comp }) : null;
  }).filter(Boolean);
  this.Ps = P; this.Ws = W; this.N = P.length;
};
/* 組裝並 LU 分解；S 矩陣（源影響）保留以便多組右端項 */
PanelSolver.prototype.assemble = function () {
  const N = this.N, P = this.Ps, W = this.Ws;
  const A = new Float64Array(N * N), S = new Float64Array(N * N), o = { D: 0, S: 0 };
  for (let i = 0; i < N; i++) {
    const c = P[i].cen, cm = [c[0], -c[1], c[2]], row = i * N;
    for (let k = 0; k < N; k++) {
      let d, s;
      if (k === i) { d = -0.5; influencePot(P[k], [c[0] - 1e-9 * P[k].n[0], c[1] - 1e-9 * P[k].n[1], c[2] - 1e-9 * P[k].n[2]], o); s = o.S; }
      else { influencePot(P[k], c, o); d = o.D; s = o.S; }
      influencePot(P[k], cm, o); // 鏡像
      A[row + k] = d + o.D; S[row + k] = s + o.S;
    }
    for (const w of W) {
      influencePot(w, c, o); let d = o.D; influencePot(w, cm, o); d += o.D;
      A[row + w.up] += d; A[row + w.lo] -= d;
    }
  }
  this.S = S; this.LU = A; this.piv = luDecompose(A, N);
};
/* 分時版本（瀏覽器）：每段最多 budget ms，回傳 Promise；onProgress(0..1) */
PanelSolver.prototype.assembleAsync = function (onProgress, budget) {
  budget = budget || 24;
  const N = this.N, P = this.Ps, W = this.Ws, self = this;
  const A = new Float64Array(N * N), S = new Float64Array(N * N), o = { D: 0, S: 0 };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  let i = 0, k = 0; const piv = new Int32Array(N);
  return new Promise((resolve, reject) => {
    const stepAsm = () => {
      const t0 = now();
      while (i < N && now() - t0 < budget) {
        const c = P[i].cen, cm = [c[0], -c[1], c[2]], row = i * N;
        for (let q = 0; q < N; q++) {
          let d, sv;
          if (q === i) { d = -0.5; influencePot(P[q], [c[0] - 1e-9 * P[q].n[0], c[1] - 1e-9 * P[q].n[1], c[2] - 1e-9 * P[q].n[2]], o); sv = o.S; }
          else { influencePot(P[q], c, o); d = o.D; sv = o.S; }
          influencePot(P[q], cm, o);
          A[row + q] = d + o.D; S[row + q] = sv + o.S;
        }
        for (const w of W) { influencePot(w, c, o); let d = o.D; influencePot(w, cm, o); d += o.D; A[row + w.up] += d; A[row + w.lo] -= d; }
        i++;
      }
      if (onProgress) onProgress(0.55 * i / N);
      if (i < N) setTimeout(stepAsm, 0); else setTimeout(stepLU, 0);
    };
    const stepLU = () => {
      const t0 = now();
      while (k < N && now() - t0 < budget) {
        let p = k, mx = Math.abs(A[k * N + k]);
        for (let r = k + 1; r < N; r++) { const v = Math.abs(A[r * N + k]); if (v > mx) { mx = v; p = r; } }
        piv[k] = p;
        if (p !== k) for (let j = 0; j < N; j++) { const t = A[k * N + j]; A[k * N + j] = A[p * N + j]; A[p * N + j] = t; }
        const akk = A[k * N + k] || 1e-30, rk = k * N;
        for (let r = k + 1; r < N; r++) { const ri = r * N, f = A[ri + k] / akk; if (f === 0) continue; A[ri + k] = f; for (let j = k + 1; j < N; j++) A[ri + j] -= f * A[rk + j]; }
        k++;
      }
      if (onProgress) onProgress(0.55 + 0.45 * (1 - ((N - k) / N) ** 3));
      if (k < N) setTimeout(stepLU, 0); else { self.S = S; self.LU = A; self.piv = piv; resolve(self); }
    };
    setTimeout(stepAsm, 0);
  });
};
/* 右端項：freestream 方向 V（伸長空間單位向量）與額外法向速度；回傳 μ */
PanelSolver.prototype.solve = function (V, extra, vnScale) {
  const N = this.N, P = this.Ps, sig = new Float64Array(N), rhs = new Float64Array(N);
  const vs = vnScale !== undefined ? vnScale : Math.hypot(V[0], V[1], V[2]);
  for (let k = 0; k < N; k++) sig[k] = P[k].vn * vs - (P[k].n[0] * V[0] + P[k].n[1] * V[1] + P[k].n[2] * V[2]) + (extra ? extra[k] : 0);
  for (let i = 0; i < N; i++) { let s = 0; const row = i * N; for (let k = 0; k < N; k++) s += this.S[row + k] * sig[k]; rhs[i] = -s; }
  luSolve(this.LU, this.piv, N, rhs);
  return { mu: rhs, sig, V: V.slice() };
};

/* ---------- LU（部分主元） ---------- */
function luDecompose(A, N) {
  const piv = new Int32Array(N);
  for (let k = 0; k < N; k++) {
    let p = k, mx = Math.abs(A[k * N + k]);
    for (let i = k + 1; i < N; i++) { const v = Math.abs(A[i * N + k]); if (v > mx) { mx = v; p = i; } }
    piv[k] = p;
    if (p !== k) for (let j = 0; j < N; j++) { const t = A[k * N + j]; A[k * N + j] = A[p * N + j]; A[p * N + j] = t; }
    const akk = A[k * N + k] || 1e-30, rk = k * N;
    for (let i = k + 1; i < N; i++) {
      const ri = i * N, f = A[ri + k] / akk;
      if (f === 0) continue;
      A[ri + k] = f;
      for (let j = k + 1; j < N; j++) A[ri + j] -= f * A[rk + j];
    }
  }
  return piv;
}
function luSolve(A, piv, N, b) {
  for (let k = 0; k < N; k++) { const p = piv[k]; if (p !== k) { const t = b[k]; b[k] = b[p]; b[p] = t; } }
  for (let i = 0; i < N; i++) { let s = b[i]; const ri = i * N; for (let j = 0; j < i; j++) s -= A[ri + j] * b[j]; b[i] = s; }
  for (let i = N - 1; i >= 0; i--) { let s = b[i]; const ri = i * N; for (let j = i + 1; j < N; j++) s -= A[ri + j] * b[j]; b[i] = s / A[ri + i]; }
  return b;
}

/* ============================================================
 *  表面速度（伸長空間）：V_t = V∞,t + ∇_t μ；法向 = v_n,指定
 *  ∇_t μ 以同一 patch 內相鄰面元最小平方求得
 * ============================================================ */
PanelSolver.prototype.neighbors = function () {
  if (this.nb) return this.nb;
  const set = this.set, nb = [];
  for (let k = 0; k < this.N; k++) {
    const p = set.P[k], pt = set.patches[p.patch], list = [];
    const look = (di, dj) => {
      let i = p.i, j = p.j;
      for (let s = 0; s < 8; s++) {
        i += di; j += dj;
        if (pt.wrapI) i = (i + pt.ni) % pt.ni;
        if (i < 0 || j < 0 || i >= pt.ni || j >= pt.nj) return;
        const st = pt.state ? pt.state[i][j] : 1;
        if (st === -1 || st === -2) return;
        const q = pt.idx[i][j];
        if (q >= 0) { list.push(q); return; }
      }
    };
    look(1, 0); look(-1, 0); look(0, 1); look(0, -1);
    nb.push(list);
  }
  this.nb = nb; return nb;
};
PanelSolver.prototype.surface = function (sol) {
  const N = this.N, P = this.Ps, nb = this.neighbors(), mu = sol.mu, V = sol.V;
  const vel = new Float64Array(3 * N);
  for (let k = 0; k < N; k++) {
    const p = P[k], n = p.n;
    // 最小平方：μ_nb − μ_k = g·(c_nb − c_k)，g 在切平面內
    let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0;
    // 切平面正交基底
    const t1 = Math.abs(n[0]) < 0.9 ? v3.cross(n, [1, 0, 0]) : v3.cross(n, [0, 1, 0]); const l1 = v3.len(t1); t1[0] /= l1; t1[1] /= l1; t1[2] /= l1;
    const t2 = v3.cross(n, t1);
    for (const q of nb[k]) {
      // 鄰點偏移投影到切平面後「展開」為實際距離（弧長近似），避免曲率大處（前緣）梯度被放大
      const d = v3.sub(P[q].cen, p.cen), dl = v3.len(d);
      let x1 = v3.dot(d, t1), x2 = v3.dot(d, t2); const pl = Math.hypot(x1, x2);
      if (pl > 1e-12) { x1 *= dl / pl; x2 *= dl / pl; }
      const w = 1 / Math.max(1e-12, x1 * x1 + x2 * x2), dm = mu[q] - mu[k];
      a11 += w * x1 * x1; a12 += w * x1 * x2; a22 += w * x2 * x2; b1 += w * x1 * dm; b2 += w * x2 * dm;
    }
    const det = a11 * a22 - a12 * a12;
    let g1 = 0, g2 = 0;
    if (Math.abs(det) > 1e-14 * (a11 * a22 + 1e-30)) { g1 = (a22 * b1 - a12 * b2) / det; g2 = (a11 * b2 - a12 * b1) / det; }
    else if (a11 > 0) g1 = b1 / a11;
    const Vn = n[0] * V[0] + n[1] * V[1] + n[2] * V[2], vnS = p.vn * (sol.vnScale !== undefined ? sol.vnScale : Math.hypot(V[0], V[1], V[2]));
    for (let c = 0; c < 3; c++) vel[3 * k + c] = V[c] - Vn * n[c] + g1 * t1[c] + g2 * t2[c] + vnS * n[c];
  }
  return vel;
};
/* 場點速度（伸長空間，單位 freestream），含鏡像與尾跡；回傳擾動速度 */
PanelSolver.prototype.fieldPert = function (sol, Pt, out) {
  const P = this.Ps, W = this.Ws, mu = sol.mu, sig = sol.sig;
  const vD = [0, 0, 0], vS = [0, 0, 0], Pm = [Pt[0], -Pt[1], Pt[2]];
  let u = 0, v = 0, w = 0;
  for (let k = 0; k < P.length; k++) {
    influenceVel(P[k], Pt, vD, vS);
    u += mu[k] * vD[0] + sig[k] * vS[0]; v += mu[k] * vD[1] + sig[k] * vS[1]; w += mu[k] * vD[2] + sig[k] * vS[2];
    influenceVel(P[k], Pm, vD, vS); // 鏡像：y 分量反號
    u += mu[k] * vD[0] + sig[k] * vS[0]; v -= mu[k] * vD[1] + sig[k] * vS[1]; w += mu[k] * vD[2] + sig[k] * vS[2];
  }
  for (const wk of W) {
    const m = mu[wk.up] - mu[wk.lo];
    influenceVel(wk, Pt, vD, vS); u += m * vD[0]; v += m * vD[1]; w += m * vD[2];
    influenceVel(wk, Pm, vD, vS); u += m * vD[0]; v -= m * vD[1]; w += m * vD[2];
  }
  out[0] = u; out[1] = v; out[2] = w;
  return out;
};
/* 場點擾動位勢（驗證用） */
PanelSolver.prototype.fieldPot = function (sol, Pt) {
  const P = this.Ps, W = this.Ws, o = { D: 0, S: 0 }, Pm = [Pt[0], -Pt[1], Pt[2]];
  let phi = 0;
  for (let k = 0; k < P.length; k++) {
    influencePot(P[k], Pt, o); phi += sol.mu[k] * o.D + sol.sig[k] * o.S;
    influencePot(P[k], Pm, o); phi += sol.mu[k] * o.D + sol.sig[k] * o.S;
  }
  for (const wk of W) { const m = sol.mu[wk.up] - sol.mu[wk.lo]; influencePot(wk, Pt, o); phi += m * o.D; influencePot(wk, Pm, o); phi += m * o.D; }
  return phi;
};

/* ============================================================
 *  Trefftz 平面：以尾跡環量分布 Γ(y)（Γ = μ上 − μ下，Γ>0 產生升力）求展向效率 e
 *  對每個升力面分別以正弦級數 Γ(θ) = Σ A_n sin nθ（n 奇數，y = s·cosθ 半展 s）最小平方擬合，
 *  e = 1 / (1 + Σ n (A_n/A_1)²)。機身內（y < 根部）以根部環量延續（升力跨越機身）。
 * ============================================================ */
PanelSolver.prototype.trefftz = function (sol) {
  const W = this.set.wakes, mu = sol.mu, byComp = {};
  for (const w of W) {
    if (w.inner) continue; // 機身內延伸條帶（附著機身的尾跡）不列入展向分布
    const G = mu[w.up] - mu[w.lo];
    (byComp[w.comp] = byComp[w.comp] || []).push({ y0: w.a[1], y1: w.b[1], G });
  }
  const out = {};
  for (const comp in byComp) {
    const st = byComp[comp].sort((a, b) => a.y0 - b.y0), semi = st[st.length - 1].y1;
    const pts = st.map(s => [0.5 * (s.y0 + s.y1), s.G, s.y1 - s.y0]);
    const yr = st[0].y0;
    if (yr > 1e-6) for (let q = 0; q < 3; q++) pts.push([yr * (q + 0.5) / 3, st[0].G, yr / 3]);
    const nm = 5, M = Array.from({ length: nm }, () => new Float64Array(nm + 1));
    let GdY = 0;
    for (const [y, G, dy] of pts) {
      const th = Math.acos(Math.min(1, y / semi)), f = [];
      for (let n = 0; n < nm; n++) f.push(Math.sin((2 * n + 1) * th));
      for (let a = 0; a < nm; a++) { for (let b = 0; b < nm; b++) M[a][b] += dy * f[a] * f[b]; M[a][nm] += dy * f[a] * G; }
      GdY += G * dy;
    }
    // 高斯消去
    for (let k = 0; k < nm; k++) { let p = k; for (let i = k + 1; i < nm; i++) if (Math.abs(M[i][k]) > Math.abs(M[p][k])) p = i; [M[k], M[p]] = [M[p], M[k]]; for (let i = k + 1; i < nm; i++) { const f = M[i][k] / M[k][k]; for (let j = k; j <= nm; j++) M[i][j] -= f * M[k][j]; } }
    const A = new Float64Array(nm); for (let k = nm - 1; k >= 0; k--) { let v = M[k][nm]; for (let j = k + 1; j < nm; j++) v -= M[k][j] * A[j]; A[k] = v / M[k][k]; }
    let sum = 0; for (let n = 1; n < nm; n++) sum += (2 * n + 1) * (A[n] / A[0]) ** 2;
    out[comp] = { e: A[0] !== 0 ? 1 / (1 + sum) : 1, semi, GdY: 2 * GdY, strips: st, A: Array.from(A) };
  }
  return out;
};

if (typeof module !== 'undefined') module.exports = { PanelSet, PanelSolver, makePanel, influencePot, influenceVel, solidTri, luDecompose, luSolve, v3 };
