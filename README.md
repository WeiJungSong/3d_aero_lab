# 引擎剖面實驗室 Engine Lab

3D 噴射引擎與全機氣動模擬器，三個獨立的單一 HTML 頁面（Three.js r147）：

| 頁面 | 檔案 | 流場來源 |
|---|---|---|
| 引擎剖面實驗室（v1） | `dist/engine-lab-standalone.html` | 一維熱力循環 + 場重建（即時） |
| 引擎 CFD 實驗室（v2） | `dist/engine-cfd-standalone.html` | 軸對稱可壓縮 Navier–Stokes，WebGL2 GPU 求解（需迭代收斂） |
| 全機氣動實驗室（v3） | `dist/aircraft-lab-standalone.html` | 3D 面元法 + 工程估算（即時）；可切換 3D Euler CFD（WebGL2 GPU） |

三型引擎可切換：高涵道渦扇（HBTF，分離排氣）、渦輪噴射（TJ，含後燃器）、低涵道後燃渦扇（LBTF，混合排氣）。介面為繁體中文附英文術語。

## 開啟

直接用瀏覽器開啟 `dist/*-standalone.html`（已內嵌 three.js，可離線使用；字型需連網，否則使用系統字型）。
`dist/engine-lab.html`、`dist/engine-cfd.html` 為不含 `<!doctype>` 骨架、自 CDN 載入 three.js 的片段版本。

CFD 版需要支援 WebGL2 與 `EXT_color_buffer_float` 的瀏覽器；不支援時自動改用 CPU 極粗網格。

## 建置

```bash
npm install
npm run build        # 三個頁面
npm run build:air    # 只建 v3 全機版
npm run build:cfd    # 只建 CFD 版
npm run build:v1     # 只建 v1
```

`build.mjs` 將 `src/` 串接成單一 HTML，輸出到 `dist/`。

> 註：`dist/engine-lab*.html` 是 v1 最初交付的建置。之後為 CFD 版修正了共用的 `src/geometry.js`（HBTF 過渡段、核心整流罩外形線、噴嘴出口面積），因此執行 `npm run build:v1` 產生的 v1 會包含這些幾何修正。

## 原始碼結構

```
src/
  physics.js     大氣（ISA）、一維參數／非設計點循環（Mattingly）
  geometry.js    三型引擎流道、機體、葉片排幾何
  field.js       v1 流場重建（節點內插、邊界層、燃燒室、噴流、震波胞）
  app_scene.js   Three.js 場景、色階、剖面與粒子（兩版共用）
  app_main.js    v1 介面、圖表、探針
  cfd_grid.js    CFD 網格、切割格、流道標記、葉片排／熱源區、初始場
  cfd_cpu.js     CPU 參考求解器（與 GPU 版數值格式相同）
  cfd_gpu.js     WebGL2 片段著色器求解器
  cfd_post.js    衍生場、推力、截面平均、出口總溫控制迴路
  app_cfd.js     CFD 版介面、網格序列、收斂判定
  panel.js       v3 3D 低階面元法（Morino 源＋偶極、對稱半模、Kutta 尾跡、Göthert 可壓縮修正、Trefftz 平面）
  aircraft.js    v3 參數化機型（機身、翼、平尾、垂尾、短艙／內置引擎）與面元網格、濕面積、截面積分布
  aero.js        v3 配平、超音速局部傾角法、Raymer 組件累加阻力、波阻、升力線斜率
  perf.js        v3 引擎資料（一維循環）、點性能、飛行包線、起降距離、任務剖面
  air_field.js   v3 場點速度（三組單位解線性重組）、體內判定、狀態量換算
  air_scene.js   v3 Three.js 全機場景、表面著色、裝機引擎、剖面、流線
  air_charts.js  v3 EICAS、阻力分解、翼面 Cp、推力／阻力、包線、任務圖
  air_cfd.js     v3 3D Euler：伸展直角網格、切割格（體積分率＋面開口率）、薄翼隔板、HLLC＋MUSCL、GPU／CPU
  app_air.js     v3 介面、計算管線、探針
  style.css, body.html, body_cfd.html, body_air.html
tools/           Node 測試與診斷腳本（自專案根目錄執行）
```

## CFD 方法摘要

- 守恆變數 ρ、ρu、ρv、E、ρY；γ 隨燃燒產物分率 Y 由 1.40 線性變到 1.33。
- 有限體積、HLLC、MUSCL-minmod、SSP-RK2、局部時間步；直角拉伸網格 + 切割格壁面；粗網格預收斂後內插到目標網格。
- 葉片排為體積力：溫比 τ 取自一維循環，每格總溫比 τ^(權重·Δx)，以上游面總焓為基準、以兩側面質量通量計功，穩態時整排溫比等於 τ。轉速固定，不做轉軸功率匹配；轉軸功率比作為診斷值顯示。
- 燃燒室／後燃器：熱源鬆弛至目標總溫；出口平均總溫以閉迴路控制維持在設定的 Tt4／Tt7。
- 紊流：Prandtl 混合長度（可關閉成 Euler）。推力為葉片體積力與壁面表壓力的軸向合力。

## 驗證（CPU 參考求解器，海平面 M0.25、100% 油門）

| 引擎 | 網格 | 迭代 | CFD 推力 | 一維推力 |
|---|---|---|---|---|
| TJ | 中（12 萬格） | 14,000 | 56.9 kN | 55.4 kN |
| HBTF | 中（12.6 萬格） | 14,000 | 89.2 kN | 95.8 kN |
| LBTF | 極粗（2.2 萬格） | 10,000 | 68.8 kN | 70.2 kN |

GPU 與 CPU 求解器結果差異在單精度浮點誤差內（相對 1e-7～3e-6）。

已知差異：HBTF 核心流量比一維低 14%、核心總壓低約 7%；未模擬葉片阻塞；壁面為滑移壁。

## 全機氣動實驗室（v3）

三款通用機型（非特定真實機型），各自安裝對應引擎：雙發窄體客機＋兩具高涵道渦扇（翼下短艙）、單發超音速攔截機＋渦輪噴射、單發多用途戰機＋低涵道後燃渦扇（機身內置）。機身、機翼、尾翼尺寸與引擎設計參數可調。

- 面元法：常強度源＋偶極四邊形面元、Kutta 尾跡（根部尾跡沿機身收至對稱面）；升力面以條帶環量計算升力與力矩，機體以壓力積分；全動平尾與攻角同時配平。M ≤ 0.85 以 Göthert 法則，M ≥ 1.15 表面 Cp 以局部傾角法，之間線性內插。
- 周圍流場：三組單位解（沿 x、沿 z、平尾偏轉）的場點速度預先計算，任意攻角與平尾偏轉即時線性重組；疊加一維循環的噴流模型；引擎內部流道取自 v1 場重建模型。
- 阻力：Raymer 組件累加（摩擦×形狀因子×干擾因子×濕面積）、雜項、Korn／Lock 跨音速波阻、Sears–Haack 超音速波阻、K = 1/(πAe) + 0.38 C_D0；展向效率 e 取自面元法 Trefftz 平面。
- 性能：一維循環逐點計算推力（轉速上限 105%），平飛自動求油門；飛行包線 P_s、起降滾行積分、任務剖面（起飛、爬升、巡航／超音速衝刺、下降、降落）。
- 3D CFD：對稱半域 3D Euler，切割格表示機體（壁面壓力以源項加入），厚度小於 1.5 格的翼面以中弧面隔板加穿透條件（w = u·dz/dx）表示；短艙進氣面與噴嘴出口為固定狀態格（一維循環工作點）；表面壓力積分得 C_L、C_m、壓力阻力，Trefftz 平面得誘導阻力。

### v3 驗證

| 項目 | 結果 |
|---|---|
| 球體面元解 | 表面 Cp 誤差 0.012，場點速度誤差約 2% |
| 矩形翼 A = 6 | C_Lα 4.57 /rad（Helmbold 4.53），e 0.971 |
| 客機巡航（11 km、M0.78、72.6 t） | C_L 0.60、C_D 339 counts、L/D 17.8、TSFC 19.4 g/(kN·s)、3000 km 任務耗油約 10.0 t |
| 3D CFD GPU 與 CPU（戰機 3 萬格、M0.6、α 3°、δ 3°、200 迭代） | C_L 0.1927 / 0.1927、C_D 0.04406 / 0.04406 |
| 球體數值阻力（M0.4，無黏理論值 0） | 本版切割格＋HLLC：半徑 2.4 格 C_d 0.86、4.8 格 0.56；階梯格＋HLL（半徑 2.4 格）1.24 |

已知限制：3D CFD 網格較粗時數值耗散會造成額外壓力阻力（機鼻與機尾最明顯），網格加密後下降；Euler 方程不含摩擦阻力；襟翼未納入面元幾何。

## 工具

```bash
node tools/test_phys.js                 # 一維循環各工況
node tools/fuzz.js                      # v1 隨機參數模糊測試
node tools/wallchk.js                   # 檢查流道缺壁
FRESH=1 node tools/longrun.js tj medium 14000 2000   # CPU 長時間求解（狀態存到 /tmp）
node tools/stations.js tj medium        # 讀取上一步結果，列出站位對照
node tools/gpucmp.mjs tj 5 xcoarse      # GPU 與 CPU 逐格比對（需 playwright）
node tools/test_air.js medium           # v3 三機型配平、巡航、起降、任務摘要
node tools/test_cfd3.js fighter 40000 400 0.6 3   # v3 3D Euler CPU 求解與受力
```

## 授權

尚未指定授權條款。
