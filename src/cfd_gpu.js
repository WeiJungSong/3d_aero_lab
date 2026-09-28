/* ============================================================
 *  cfd_gpu.js — WebGL2 GPU 求解器（與 cfd_cpu.js 數值格式相同）
 *  每格一個片段：重新計算四個面的 HLLC 通量（MUSCL 重建）、源項與局部時間步。
 * ============================================================ */
const CFD_VS = `#version 300 es
in vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const CFD_FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uQ1, uQ2, uN1, uN2, uZA, uZB, uZC, uGX, uGR;
uniform int uW, uH, uStage, uOrder, uVisc;
uniform float uCfl, uHf, uDtCap;
uniform vec3 uFs;
uniform vec4 uComp[8];
layout(location = 0) out vec4 o1;
layout(location = 1) out vec4 o2;
const float RG = 287.05;
// 原始變數：w = (ρ, u_n, u_t, p)，另含 Y、γ
struct P { vec4 w; float Y; float g; };
float phiAt(ivec2 c) { return texelFetch(uZA, c, 0).x; }
bool solid(ivec2 c) { return texelFetch(uZA, c, 0).x <= 0.0; }
bool full(ivec2 c) { return texelFetch(uZA, c, 0).x > 0.999; }
P prim(ivec2 c, bool rdir) {
  vec4 a = texelFetch(uQ1, c, 0); float rY = texelFetch(uQ2, c, 0).x;
  float r = max(a.x, 1e-4), u = a.y / r, v = a.z / r, Y = clamp(rY / r, 0.0, 1.0), g = 1.4 - 0.07 * Y;
  float p = max(1.0, (g - 1.0) * (a.w - 0.5 * r * (u * u + v * v)));
  P q; q.w = rdir ? vec4(r, v, u, p) : vec4(r, u, v, p); q.Y = Y; q.g = g; return q;
}
vec4 mm4(vec4 a, vec4 b) { return 0.5 * (sign(a) + sign(b)) * min(abs(a), abs(b)); }
float mm1(float a, float b) { return 0.5 * (sign(a) + sign(b)) * min(abs(a), abs(b)); }
// HLLC：回傳 (質量, 法向動量, 切向動量, 能量)，fy 為 ρY 通量
vec4 hllc(vec4 L, float YL, float gL, vec4 R, float YR, float gR, out float fy) {
  float rL = L.x, uL = L.y, vL = L.z, pL = L.w, rR = R.x, uR = R.y, vR = R.z, pR = R.w;
  float cL = sqrt(gL * pL / rL), cR = sqrt(gR * pR / rR);
  float SL = min(uL - cL, uR - cR), SR = max(uL + cL, uR + cR);
  float EL = pL / (gL - 1.0) + 0.5 * rL * (uL * uL + vL * vL), ER = pR / (gR - 1.0) + 0.5 * rR * (uR * uR + vR * vR);
  if (SL >= 0.0) { fy = rL * uL * YL; return vec4(rL * uL, rL * uL * uL + pL, rL * uL * vL, uL * (EL + pL)); }
  if (SR <= 0.0) { fy = rR * uR * YR; return vec4(rR * uR, rR * uR * uR + pR, rR * uR * vR, uR * (ER + pR)); }
  float SM = (pR - pL + rL * uL * (SL - uL) - rR * uR * (SR - uR)) / (rL * (SL - uL) - rR * (SR - uR));
  if (SM >= 0.0) {
    float f = rL * (SL - uL) / (SL - SM);
    float Es = f * (EL / rL + (SM - uL) * (SM + pL / (rL * (SL - uL))));
    fy = rL * uL * YL + SL * (f * YL - rL * YL);
    return vec4(rL * uL + SL * (f - rL), rL * uL * uL + pL + SL * (f * SM - rL * uL), rL * uL * vL + SL * (f * vL - rL * vL), uL * (EL + pL) + SL * (Es - EL));
  }
  float f = rR * (SR - uR) / (SR - SM);
  float Es = f * (ER / rR + (SM - uR) * (SM + pR / (rR * (SR - uR))));
  fy = rR * uR * YR + SR * (f * YR - rR * YR);
  return vec4(rR * uR + SR * (f - rR), rR * uR * uR + pR + SR * (f * SM - rR * uR), rR * uR * vR + SR * (f * vR - rR * vR), uR * (ER + pR) + SR * (Es - ER));
}
P ffX(P I, float nsgn) { // x 邊界：法向 = u
  float r = I.w.x, un = I.w.y * nsgn, ut = I.w.z, p = I.w.w, g = I.g, c = sqrt(g * p / r);
  float g0 = 1.4, r0 = uFs.x, p0 = uFs.z, c0 = sqrt(g0 * p0 / r0), un0 = uFs.y * nsgn, ut0 = 0.0;
  P G; G.Y = 0.0; G.g = 1.4;
  if (un >= c) { return I; }
  if (un0 <= -c0) { G.w = vec4(r0, uFs.y, 0.0, p0); return G; }
  float Rp = un + 2.0 * c / (g - 1.0), Rm = un0 - 2.0 * c0 / (g0 - 1.0), unb = 0.5 * (Rp + Rm);
  float gb, s, utb, Yb;
  if (unb > 0.0) { gb = g; s = p / pow(r, g); utb = ut; Yb = I.Y; } else { gb = g0; s = p0 / pow(r0, g0); utb = ut0; Yb = 0.0; }
  float cb = max(1.0, 0.25 * (gb - 1.0) * (Rp - Rm));
  float rb = pow(cb * cb / (gb * s), 1.0 / (gb - 1.0));
  G.w = vec4(rb, unb * nsgn, utb, rb * cb * cb / gb); G.Y = Yb; G.g = 1.4 - 0.07 * Yb; return G;
}
P ffR(P I) { // 上邊界：法向 = v（外法向 +r），切向 = u
  float r = I.w.x, un = I.w.y, ut = I.w.z, p = I.w.w, g = I.g, c = sqrt(g * p / r);
  float g0 = 1.4, r0 = uFs.x, p0 = uFs.z, c0 = sqrt(g0 * p0 / r0), un0 = 0.0, ut0 = uFs.y;
  P G; G.Y = 0.0; G.g = 1.4;
  if (un >= c) { return I; }
  float Rp = un + 2.0 * c / (g - 1.0), Rm = un0 - 2.0 * c0 / (g0 - 1.0), unb = 0.5 * (Rp + Rm);
  float gb, s, utb, Yb;
  if (unb > 0.0) { gb = g; s = p / pow(r, g); utb = ut; Yb = I.Y; } else { gb = g0; s = p0 / pow(r0, g0); utb = ut0; Yb = 0.0; }
  float cb = max(1.0, 0.25 * (gb - 1.0) * (Rp - Rm));
  float rb = pow(cb * cb / (gb * s), 1.0 / (gb - 1.0));
  G.w = vec4(rb, unb, utb, rb * cb * cb / gb); G.Y = Yb; G.g = 1.4 - 0.07 * Yb; return G;
}
void recon(P A, P Am, bool hasAm, P B, P Bp, bool hasBp, out P L, out P R) {
  L = A; R = B;
  if (uOrder == 2) {
    if (hasAm) { L.w = A.w + 0.5 * mm4(A.w - Am.w, B.w - A.w); L.Y = A.Y + 0.5 * mm1(A.Y - Am.Y, B.Y - A.Y); }
    if (hasBp) { R.w = B.w - 0.5 * mm4(B.w - A.w, Bp.w - B.w); R.Y = B.Y - 0.5 * mm1(B.Y - A.Y, Bp.Y - B.Y); }
    if (L.w.x <= 0.0 || L.w.w <= 0.0) L = A;
    if (R.w.x <= 0.0 || R.w.w <= 0.0) R = B;
    L.g = 1.4 - 0.07 * L.Y; R.g = 1.4 - 0.07 * R.Y;
  }
}
// x 面：a 與 a+(1,0) 之間（乘開口分率 αE）；回傳 (ρ, ρu, ρv, E) 通量，fy 為 ρY
vec4 fluxX(ivec2 a, out float fy) {
  ivec2 b = a + ivec2(1, 0);
  fy = 0.0;
  float al;
  if (a.x < 0) al = solid(b) ? 0.0 : 1.0; else if (b.x >= uW) al = solid(a) ? 0.0 : 1.0; else al = texelFetch(uZC, a, 0).x;
  if (al <= 0.0) return vec4(0.0);
  vec4 F;
  if (a.x < 0) { P B = prim(b, false); P G = ffX(B, -1.0); F = hllc(G.w, G.Y, G.g, B.w, B.Y, B.g, fy); }
  else if (b.x >= uW) { P A = prim(a, false); P G = ffX(A, 1.0); F = hllc(A.w, A.Y, A.g, G.w, G.Y, G.g, fy); }
  else {
    P A = prim(a, false), B = prim(b, false), Am = A, Bp = B;
    ivec2 am = a - ivec2(1, 0), bp = b + ivec2(1, 0);
    bool fa = full(a) && full(b);
    bool hAm = fa && am.x >= 0 && full(am), hBp = fa && bp.x < uW && full(bp);
    if (hAm) Am = prim(am, false);
    if (hBp) Bp = prim(bp, false);
    P L, R; recon(A, Am, hAm, B, Bp, hBp, L, R);
    F = hllc(L.w, L.Y, L.g, R.w, R.Y, R.g, fy);
  }
  fy *= al; return al * F;
}
// r 面：a 與 a+(0,1) 之間（乘開口分率 αN）；含混合長度黏性；nu 輸出渦黏係數
vec4 fluxR(ivec2 a, out float fy, out float nu) {
  ivec2 b = a + ivec2(0, 1);
  fy = 0.0; nu = 0.0;
  if (a.y < 0) return vec4(0.0);
  float al = b.y >= uH ? (solid(a) ? 0.0 : 1.0) : texelFetch(uZC, a, 0).y;
  if (al <= 0.0) return vec4(0.0);
  vec4 F; float fyy = 0.0;
  if (b.y >= uH) {
    P A = prim(a, true); P G = ffR(A); F = hllc(A.w, A.Y, A.g, G.w, G.Y, G.g, fyy);
    fy = al * fyy; return al * vec4(F.x, F.z, F.y, F.w);
  }
  P A = prim(a, true), B = prim(b, true), Am = A, Bp = B;
  ivec2 am = a - ivec2(0, 1), bp = b + ivec2(0, 1);
  bool fa = full(a) && full(b);
  bool hAm = fa && am.y >= 0 && full(am), hBp = fa && bp.y < uH && full(bp);
  if (hAm) Am = prim(am, true);
  if (hBp) Bp = prim(bp, true);
  P L, R; recon(A, Am, hAm, B, Bp, hBp, L, R);
  F = hllc(L.w, L.Y, L.g, R.w, R.Y, R.g, fyy);
  vec4 out4 = vec4(F.x, F.z, F.y, F.w); fy = fyy;
  if (uVisc == 1) {
    float drc = texelFetch(uGR, ivec2(b.y, 0), 0).x - texelFetch(uGR, ivec2(a.y, 0), 0).x;
    float uA = A.w.z, uB = B.w.z;   // r 方向：切向 = 軸向速度 u
    float dudr = (uB - uA) / drc;
    float l = 0.5 * (texelFetch(uZA, a, 0).w + texelFetch(uZA, b, 0).w);
    float nut = l * l * abs(dudr), rho = 0.5 * (A.w.x + B.w.x), mu = rho * nut;
    float TA = A.w.w / (A.w.x * RG), TB = B.w.w / (B.w.x * RG);
    float ga = 0.5 * (A.g + B.g), cp = ga * RG / (ga - 1.0);
    float tau = mu * dudr;
    out4.y -= tau;
    out4.w -= 0.5 * (uA + uB) * tau + mu * cp / 0.9 * (TB - TA) / drc;
    fy -= mu / 0.9 * (B.Y - A.Y) / drc;
    nu = nut;
  }
  fy *= al; return al * out4;
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 za = texelFetch(uZA, c, 0);
  vec4 n1 = texelFetch(uN1, c, 0), n2 = texelFetch(uN2, c, 0);
  if (za.x <= 0.0) { o1 = n1; o2 = n2; return; }
  vec4 q1 = texelFetch(uQ1, c, 0), q2 = texelFetch(uQ2, c, 0);
  vec4 gx = texelFetch(uGX, ivec2(c.x, 0), 0), gr = texelFetch(uGR, ivec2(c.y, 0), 0);
  float dx = gx.y, rc = gr.x, dr = gr.y, rlo = gr.z, rhi = gr.w;
  float fyP, fyM, gyP, gyM, nuP, nuM;
  vec4 FP = fluxX(c, fyP), FM = fluxX(c - ivec2(1, 0), fyM);
  vec4 GP = fluxR(c, gyP, nuP), GM = fluxR(c - ivec2(0, 1), gyM, nuM);
  float ph = za.x;
  vec4 R = (-(FP - FM) / dx - (GP * rhi - GM * rlo) / (rc * dr)) / ph;
  float RY = (-(fyP - fyM) / dx - (gyP * rhi - gyM * rlo) / (rc * dr)) / ph;
  P C = prim(c, false);
  float rho = C.w.x, u = C.w.y, v = C.w.z, p = C.w.w, g = C.g;
  vec4 zc = texelFetch(uZC, c, 0);
  float aw = c.x > 0 ? texelFetch(uZC, c - ivec2(1, 0), 0).x : 1.0;
  float aS = c.y > 0 ? texelFetch(uZC, c - ivec2(0, 1), 0).y : 0.0;
  R.y += p * (zc.x - aw) / (dx * ph);
  R.z += p * (zc.y * rhi - aS * rlo) / (rc * dr * ph);
  int id = int(za.y + 0.5);
  float mfx = 0.5 * (FP.x + FM.x), srcOut = 0.0; // 兩側軸向面質量通量平均（含開口分率）
  if (id > 0) {
    vec4 cp4 = uComp[id], zb = texelFetch(uZB, c, 0);
    float cp = g * RG / (g - 1.0), T = p / (rho * RG), Tt = T + 0.5 * (u * u + v * v) / cp, mf = mfx / ph;
    int ty = int(cp4.z + 0.5);
    if (ty == 1 || ty == 2) {
      // 葉片排：每格總溫比 τ^(權重·dx)，上游總焓取西面能量通量/質量通量，功以通過質量通量計
      float fac = ty == 1 ? 1.0 : clamp(mf / (0.3 * zb.w), 0.0, 1.0);
      float HU = FM.x > 1e-9 ? FM.w / FM.x : cp * Tt;
      if (!(HU > 0.0)) HU = cp * Tt;
      float a = cp4.x * za.z * fac * dx;
      float em1 = abs(a) < 1e-3 ? a * (1.0 + 0.5 * a) : exp(a) - 1.0;
      float w = HU * em1 / dx;
      R.y += ty == 1 ? cp4.y * rho * w : rho * w / cp4.y;
      R.w += mf * w; srcOut = mf * w;
    } else if (zb.y > 0.0) {
      // 熱源：目標 = 基準 + (逐格目標 − 基準)·K
      float tgt = cp4.x + (zb.x - cp4.x) * (cp4.y > 0.0 ? cp4.y : 1.0);
      float m0 = max(mf, 0.0);
      float q = m0 * cp * max(0.0, tgt - Tt) * zb.y;
      float mfu = q / uHf;
      R.w += q; R.x += mfu; RY += m0 * (1.0 - C.Y) * zb.z + mfu; srcOut = mfu;
    }
  }
  float dt;
  if (uStage == 0) {
    float cs = sqrt(g * p / rho), nu = max(nuP, nuM);
    dt = uCfl * max(ph, 0.25) / ((abs(u) + cs) / dx + (abs(v) + cs) / dr + 2.2 * nu / (dr * dr));
    dt = min(dt, uDtCap);
  } else dt = q2.y;
  vec4 A1; float AY;
  if (uStage == 0) { A1 = n1 + dt * R; AY = n2.x + dt * RY; }
  else { A1 = 0.5 * n1 + 0.5 * (q1 + dt * R); AY = 0.5 * n2.x + 0.5 * (q2.x + dt * RY); }
  // 正值保護
  float r2 = max(A1.x, 1e-3); A1.x = r2;
  float Y2 = clamp(AY / r2, 0.0, 1.0); AY = Y2 * r2;
  float g2 = 1.4 - 0.07 * Y2, ke = 0.5 * (A1.y * A1.y + A1.z * A1.z) / r2;
  if ((g2 - 1.0) * (A1.w - ke) < 50.0) A1.w = 50.0 / (g2 - 1.0) + ke;
  o1 = A1; o2 = vec4(AY, dt, srcOut, mfx);
}`;

function GPUSolver(grid, zones, comps, fs, Q0, opt) {
  this.opt = Object.assign({ cfl: 0.6, order: 2, visc: true, hf: 0.99 * 43e6 }, opt || {});
  const cv = document.createElement('canvas'); cv.width = 1; cv.height = 1;
  const gl = cv.getContext('webgl2', { antialias: false, depth: false, stencil: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
  if (!gl) throw new Error('此瀏覽器不支援 WebGL2');
  if (!gl.getExtension('EXT_color_buffer_float')) throw new Error('此 GPU 不支援浮點渲染目標（EXT_color_buffer_float）');
  this.gl = gl; this.grid = grid; this.W = grid.W; this.H = grid.H; this.iter = 0;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const pg = gl.createProgram();
  gl.attachShader(pg, sh(gl.VERTEX_SHADER, CFD_VS)); gl.attachShader(pg, sh(gl.FRAGMENT_SHADER, CFD_FS));
  gl.bindAttribLocation(pg, 0, 'aPos'); gl.linkProgram(pg);
  if (!gl.getProgramParameter(pg, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pg));
  this.pg = pg;
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  this.vao = gl.createVertexArray(); gl.bindVertexArray(this.vao);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  this.U = {};
  for (const n of ['uQ1', 'uQ2', 'uN1', 'uN2', 'uZA', 'uZB', 'uZC', 'uGX', 'uGR', 'uW', 'uH', 'uStage', 'uOrder', 'uVisc', 'uCfl', 'uHf', 'uDtCap', 'uFs', 'uComp']) this.U[n] = gl.getUniformLocation(pg, n);
  const W = this.W, H = this.H;
  this.tex = (w, h, data) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data || null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  this.S = [0, 1, 2].map(() => {
    const t1 = this.tex(W, H), t2 = this.tex(W, H), fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t1, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, t2, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('無法建立浮點 framebuffer');
    return { t1, t2, fb };
  });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const gx = new Float32Array(W * 4), gr = new Float32Array(H * 4);
  for (let i = 0; i < W; i++) { gx[i * 4] = grid.xc[i]; gx[i * 4 + 1] = grid.dx[i]; }
  for (let j = 0; j < H; j++) { gr[j * 4] = grid.rc[j]; gr[j * 4 + 1] = grid.dr[j]; gr[j * 4 + 2] = grid.rf[j]; gr[j * 4 + 3] = grid.rf[j + 1]; }
  this.tGX = this.tex(W, 1, gx); this.tGR = this.tex(H, 1, gr);
  this.tZA = this.tex(W, H); this.tZB = this.tex(W, H); this.tZC = this.tex(W, H);
  this.cur = 0;
  this.setZones(zones); this.setComps(comps); this.setFs(fs); this.setState(Q0);
  this.buf1 = new Float32Array(W * H * 4); this.buf2 = new Float32Array(W * H * 4);
}
GPUSolver.prototype.setZones = function (z) {
  const gl = this.gl, N = this.W * this.H, a = new Float32Array(N * 4), b = new Float32Array(N * 4), c = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) {
    a[k * 4] = z.solid[k] ? 0 : z.phi[k]; a[k * 4 + 1] = z.comp[k]; a[k * 4 + 2] = z.wgt[k]; a[k * 4 + 3] = z.lmix[k];
    b[k * 4] = z.tgt[k]; b[k * 4 + 1] = z.rate[k]; b[k * 4 + 2] = z.yrate[k]; b[k * 4 + 3] = z.mfd[k] || 1;
    c[k * 4] = z.ae[k]; c[k * 4 + 1] = z.an[k];
  }
  gl.bindTexture(gl.TEXTURE_2D, this.tZA); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, a);
  gl.bindTexture(gl.TEXTURE_2D, this.tZC); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, c);
  gl.bindTexture(gl.TEXTURE_2D, this.tZB); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, b);
  this.zones = z;
};
GPUSolver.prototype.setComps = function (c) { this.comps = Float32Array.from(c); };
GPUSolver.prototype.setFs = function (fs) { this.fs = fs; };
GPUSolver.prototype.setState = function (Q) {
  const gl = this.gl, N = this.W * this.H, a = new Float32Array(N * 4), b = new Float32Array(N * 4);
  for (let k = 0; k < N; k++) { a[k * 4] = Q[0][k]; a[k * 4 + 1] = Q[1][k]; a[k * 4 + 2] = Q[2][k]; a[k * 4 + 3] = Q[3][k]; b[k * 4] = Q[4][k]; }
  for (const s of this.S) {
    gl.bindTexture(gl.TEXTURE_2D, s.t1); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, a);
    gl.bindTexture(gl.TEXTURE_2D, s.t2); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, this.W, this.H, gl.RGBA, gl.FLOAT, b);
  }
  this.iter = 0;
};
GPUSolver.prototype.pass = function (stage, qa, qn, out) {
  const gl = this.gl, U = this.U;
  gl.bindFramebuffer(gl.FRAMEBUFFER, out.fb);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  gl.viewport(0, 0, this.W, this.H);
  const bind = (unit, t, loc) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(loc, unit); };
  bind(0, qa.t1, U.uQ1); bind(1, qa.t2, U.uQ2); bind(2, qn.t1, U.uN1); bind(3, qn.t2, U.uN2);
  bind(4, this.tZA, U.uZA); bind(5, this.tZB, U.uZB); bind(6, this.tGX, U.uGX); bind(7, this.tGR, U.uGR); bind(8, this.tZC, U.uZC);
  gl.uniform1i(U.uStage, stage);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
};
GPUSolver.prototype.step = function (n) {
  const gl = this.gl, U = this.U, o = this.opt;
  gl.useProgram(this.pg); gl.bindVertexArray(this.vao);
  gl.uniform1i(U.uW, this.W); gl.uniform1i(U.uH, this.H);
  gl.uniform1i(U.uOrder, o.order); gl.uniform1i(U.uVisc, o.visc ? 1 : 0);
  gl.uniform1f(U.uCfl, o.cfl); gl.uniform1f(U.uHf, o.hf); gl.uniform1f(U.uDtCap, o.dtCap || 1e9);
  gl.uniform3f(U.uFs, this.fs.r, this.fs.u, this.fs.p);
  gl.uniform4fv(U.uComp, this.comps);
  for (let it = 0; it < n; it++) {
    const a = this.S[this.cur], b = this.S[(this.cur + 1) % 3], c = this.S[(this.cur + 2) % 3];
    this.pass(0, a, a, b);
    this.pass(1, b, a, c);
    this.cur = (this.cur + 2) % 3;
    this.iter++;
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
};
GPUSolver.prototype.read = function (Q) {
  const gl = this.gl, W = this.W, H = this.H, N = W * H, s = this.S[this.cur];
  gl.bindFramebuffer(gl.FRAMEBUFFER, s.fb);
  gl.readBuffer(gl.COLOR_ATTACHMENT0); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, this.buf1);
  gl.readBuffer(gl.COLOR_ATTACHMENT1); gl.readPixels(0, 0, W, H, gl.RGBA, gl.FLOAT, this.buf2);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (!Q) Q = [0, 1, 2, 3, 4].map(() => new Float32Array(N));
  const a = this.buf1, b = this.buf2;
  if (!this.src || this.src.length !== N) { this.src = new Float32Array(N); this.mfx = new Float32Array(N); }
  const src = this.src, mfx = this.mfx;
  for (let k = 0; k < N; k++) { Q[0][k] = a[k * 4]; Q[1][k] = a[k * 4 + 1]; Q[2][k] = a[k * 4 + 2]; Q[3][k] = a[k * 4 + 3]; Q[4][k] = b[k * 4]; src[k] = b[k * 4 + 2]; mfx[k] = b[k * 4 + 3]; }
  return Q;
};
GPUSolver.prototype.finish = function () { this.gl.finish(); };
GPUSolver.prototype.dispose = function () {
  const gl = this.gl;
  for (const s of this.S) { gl.deleteTexture(s.t1); gl.deleteTexture(s.t2); gl.deleteFramebuffer(s.fb); }
  for (const t of [this.tGX, this.tGR, this.tZA, this.tZB, this.tZC]) gl.deleteTexture(t);
  gl.deleteProgram(this.pg);
  const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
};
