# 引擎剖面實驗室 Engine Lab

3D 噴射引擎模擬器，兩個獨立的單一 HTML 頁面（Three.js r147）：

| 頁面 | 檔案 | 流場來源 |
|---|---|---|
| 引擎剖面實驗室（v1） | `dist/engine-lab-standalone.html` | 一維熱力循環 + 場重建（即時） |
| 引擎 CFD 實驗室（v2） | `dist/engine-cfd-standalone.html` | 軸對稱可壓縮 Navier–Stokes，WebGL2 GPU 求解（需迭代收斂） |

三型引擎可切換：高涵道渦扇（HBTF，分離排氣）、渦輪噴射（TJ，含後燃器）、低涵道後燃渦扇（LBTF，混合排氣）。介面為繁體中文附英文術語。

## 開啟

直接用瀏覽器開啟 `dist/*-standalone.html`（已內嵌 three.js，可離線使用；字型需連網，否則使用系統字型）。
`dist/engine-lab.html`、`dist/engine-cfd.html` 為不含 `<!doctype>` 骨架、自 CDN 載入 three.js 的片段版本。

CFD 版需要支援 WebGL2 與 `EXT_color_buffer_float` 的瀏覽器；不支援時自動改用 CPU 極粗網格。

## 建置

```bash
npm install
npm run build        # 兩個頁面
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
  style.css, body.html, body_cfd.html
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

## 工具

```bash
node tools/test_phys.js                 # 一維循環各工況
node tools/fuzz.js                      # v1 隨機參數模糊測試
node tools/wallchk.js                   # 檢查流道缺壁
FRESH=1 node tools/longrun.js tj medium 14000 2000   # CPU 長時間求解（狀態存到 /tmp）
node tools/stations.js tj medium        # 讀取上一步結果，列出站位對照
node tools/gpucmp.mjs tj 5 xcoarse      # GPU 與 CPU 逐格比對（需 playwright）
```

## 授權

尚未指定授權條款。
