# Space Cadet 复刻 — 微信小游戏

复刻 Microsoft 3D Pinball: Space Cadet。

当前进度：**M1（工程骨架）与 M2（物理核心）代码完成、自动化验证全绿；M3 已由「台面几何校准」重定义为「台面重建」**（见 `docs/plan.md` 第八节）。

台面重建的动因是：对照原版反编译资源后发现，当前台面的元素密度与美术水准都远低于原版（原版 18 个组件类、300 余盏灯，我们目前 2 类、0 盏灯）。为让美术改动有即时反馈，本轮先补了一个**浏览器 3D 预览**（`npm run preview`），它跑的是 `src/table` + `src/render` 的同一份代码。

M1 的真机确认仍是**阻断项**——它没通过之前，后面所有工作都建立在一个未验证的前提上。

- 架构决策 → `docs/adr/`
- 领域术语（**台面**、**挡板**、**使命**、**军衔**…）→ `CONTEXT.md`
- 实施计划与里程碑 → `docs/plan.md`

## 快速开始

```bash
npm install
npm run verify      # 类型检查 + 冒烟测试 + 调试图验证 + 预览验证 + 构建
npm run preview     # 生成 3D 台面预览 demo/preview.html（打开即可看）
npm run demo        # 生成物理调试图 demo/index.html
```

`npm run verify` 依次跑五件事：

| 命令 | 作用 |
|---|---|
| `npm run typecheck` | `tsc --noEmit`，覆盖 `src/` 与 `tools/` |
| `npm run smoke` | 在 Node 里用替身环境跑真实模块，验证 polyfill、台面几何管线、相机适配、主循环、物理求解器 |
| `npm run demo-check` | 生成物理调试图并做无头验证（元素查找、渲染循环、输入链路） |
| `npm run preview-check` | 生成 3D 预览并做无头验证（渲染层不与小游戏 API 耦合、贴图确实画出来了） |
| `npm run build` | 产出 `dist/polyfill.js` 与 `dist/app.js` |

> 冒烟测试**不能替代真机验证**。WebGL 上下文创建、真实 GPU 的渲染结果、触摸事件坐标，这三样只能在真机上看。

## 物理调试图

`npm run demo` 会生成 `demo/index.html` —— **单个自包含文件**，直接双击就能在浏览器里打开。

它不是一份简化复制品，而是把 `src/physics/` 的同一份代码单独打包出来的。之所以能做到，是因为物理层有一条硬约束（`docs/adr/0003`）：不依赖 three.js、也不碰任何小游戏 API。代价是物理层不能顺手用 three 的向量类，收益是调手感时不用等小游戏构建、也不用真机预览。

页面上能拨重力、围边弹性、挡板角速度、缓冲器推力，还能切到「无损模式」（关重力/阻尼、弹性取 1）来观察求解器本身会不会吞能量。左半屏/右半屏点击或 <kbd>←</kbd> <kbd>→</kbd> 拍挡板。

## 3D 台面预览

`npm run preview` 会生成 `demo/preview.html` —— 同样是单个自包含文件，打开就能看到**真正的 three.js 台面**，可拖动旋转、滚轮缩放、切换模拟机型、用方向键拍挡板。

它跑的是 `src/table` + `src/render` 的同一份代码，只是把宿主从微信换成浏览器。之所以能这样做，是因为本次重构把 `src/render/texture.ts` 的画布来源改成了可注入的工厂——那是渲染层里唯一一处小游戏 API。见 `docs/adr/0010`。

**它不替代真机验证。** WebGL 扩展支持、GPU 实际表现、着色器编译、触摸坐标都只能在真机上看。浏览器预览解决的是另一件事：改美术时立刻看得见。预览显式取 WebGL 1 与真机一致，读数里会标出实际拿到的版本——如果浏览器给的是 WebGL 2，读数会写明「真机不支持」，免得拿浏览器的效果去推断真机。

## 在微信开发者工具里跑

1. 微信开发者工具 → 新建项目 → 项目类型选 **小游戏**
2. 目录选本项目根目录
3. AppID 填你自己的小游戏 AppID（`project.config.json` 里是占位文本），或直接选「测试号」
4. 先执行 `npm run build`，再在工具里点「编译」

`project.config.json` 里有两个不能改的设定：`compileType` 必须是 `game`；`setting.es6` 必须是 `false`——我们的代码已由 esbuild 定好目标语法，让工具再转译一遍是重复劳动，还可能引入差异。

## M1 真机验证清单

M1 的**唯一目的**是确认 three.js r117 + WebGL 1 在真机上渲染正常。逐条核对：

- [ ] 能看到深色台面，上窄下宽呈梯形（不是矩形，也不是上下颠倒的）
- [ ] 贴图方向正确：橙色拱线在**远端**（画面上方），环形灯带在台面中部
- [ ] 台面完整落在屏幕内、四周留白、没有被裁切
- [ ] 左右挡板都在，拍下去能抬起、松开能落回
- [ ] 台面元素按当前 `src/table/data.ts` 的清单齐备（M3 重建前是「3 个缓冲器、6 个击倒目标」这一版；重建后应对齐 `CONTEXT.md` 里的原版骨架清单）
- [ ] 调试面板 `WebGL2:` 一行显示 `no`
- [ ] 调试面板 `GL:` 一行的版本串里不含 `WebGL 2` 字样
- [ ] 触摸屏幕左半区左挡板抬起、右半区右挡板抬起、两指同时按能同时抬起
- [ ] FPS 稳定在 30 以上（低端机可放宽到 24）
- [ ] 无异常显示：花屏、纹理错位、几何缺面

**任一条失败就停下来**，先解决它——真机 WebGL 1 渲染是后面所有工作的前提。记录机型、系统版本、微信版本与现象。

> 触摸左右半屏是 M4 热区设计的最小预览，只为验证「触摸 → 视觉反馈」这条链路是通的，不是最终实现。

## 项目结构

```
game.js                小游戏入口：先 require polyfill，再 require app
game.json              小游戏配置（竖屏）
project.config.json    开发者工具配置
build.mjs              esbuild 构建脚本

src/
  env/polyfill.ts      小游戏环境 polyfill（window/document/canvas/navigator）
  core/screen.ts       屏幕度量、像素比夹取、安全区
  core/loop.ts         定步长主循环，逻辑与渲染解耦
  table/data.ts        台面声明式数据 —— 单一真值来源
  table/geometry.ts    台面数据 → three.js 几何
  physics/vector2.ts   二维向量（原地写入，不分配）
  physics/colliders.ts 线段 / 圆 / 旋转线段（挡板胶囊）
  physics/world.ts     定步长积分 + 子步进 + 碰撞求解 + 事件
  physics/tuning.ts    手感参数，全部集中在这里
  physics/table-world.ts  台面数据 → 物理世界
  render/texture.ts    程序化画布与贴图
  render/camera.ts     竖屏固定斜俯视相机（俯角恒定，只改距离）
  render/scene.ts      场景与灯光
  hud/debug.ts         自绘调试面板（小游戏无 WXML，UI 只能自绘）
  main.ts              入口装配
  preview.ts           浏览器 3D 预览入口（把宿主从微信换成浏览器，非小游戏代码）

tools/
  mock-env.ts          Node 替身环境（wx / 屏幕画布 / 2D 上下文 / 受控时钟）
  smoke.ts             冒烟测试（含物理求解器的五条断言）
  trace-ball.ts        球轨迹追踪 —— 台面会不会卡球、能不能正常坠毁
  probe-loop.ts        主循环每帧步数分布 —— 定位时序类缺陷
  physics-demo.ts      物理调试图的逻辑
  demo-harness.ts      调试图的无头验证（DOM 替身，验证元素查找/循环/输入链路）
  demo-shell.html      调试图的页面骨架
  build-demo.mjs       把调试图打包成单个自包含 HTML
  preview-harness.ts   预览的无头验证（注入画布工厂，验证渲染层不碰 wx）
  preview-shell.html   预览页的页面骨架
  build-preview.mjs    把预览打包成单个自包含 HTML

demo/index.html        物理调试图（`npm run demo` 生成，构建产物）
demo/preview.html      3D 台面预览（`npm run preview` 生成，构建产物）
docs/adr/              架构决策记录
CONTEXT.md             领域术语表
docs/plan.md           实施计划 M1–M8
```

> `src/physics/` 里**不允许**出现 `import ... from 'three'`，也不允许出现 `wx.`。这是 `docs/adr/0003` 的硬约束，也是物理调试图与 Node 断言能存在的前提。

## 已知坑

这些都是实测出来的，不是猜的。

**1. three@0.117.0 的几何类有双命名。** 短名 `BoxGeometry` / `ExtrudeGeometry` / `PlaneGeometry` / `CylinderGeometry` / `SphereGeometry` 在这个版本里仍是**遗留 `Geometry` 类**——只有 `.vertices` / `.faces`，没有 `.attributes` / `.setAttribute`。真正的 BufferGeometry 变体带 `BufferGeometry` 后缀。我们要手工写台面 UV，所以全程必须用 `*BufferGeometry`。r125 之后短名才指向 BufferGeometry。详见 `docs/adr/0004`。

**2. polyfill 必须先于业务代码执行。** three.js 的模块级代码在加载时就会访问 `window` / `document`，顺序反了会崩在模块初始化阶段，且报错位置指向 three 内部。因此拆成两个产物，顺序由 `game.js` 显式保证，而不是依赖 `import` 次序。

**3. 屏幕画布只能拿一次。** 小游戏里第一次 `wx.createCanvas()` 返回屏幕上那块画布，之后返回的是离屏画布。必须把它挂到全局复用，否则会「渲染成功但屏幕全黑」。

**4. 全局写入只写一边会静默出错。** 真机上 `GameGlobal` 与 `globalThis` 的关系在不同 JS 引擎/基础库上并不一致——有的同一个对象，有的 `GameGlobal` 是独立对象。只写一边不会报错，而是「一边能读到、一边读不到」。同时 three.js 打包后的代码用的是**裸标识符** `window` / `document`，所以两个目标都得写。判断「某个全局能力是否存在」时也必须两边都查，不能只看 `GameGlobal`——曾经因此把真实 `performance` 覆盖成 `Date.now()` 低精度实现，真机上表现为周期性卡顿且完全无法归因。详见 `docs/adr/0007`。

**5. 相机适配不能用解析近似。** 「台面长度 × sin(俯角)」会系统性低估竖直投影量——实测 NDC 冲到 1.191，近端被裁掉约 19%，因为近端离相机近得多。必须对真实投影做数值求解。详见 `docs/adr/0006`。

**6. 真机 WebGL 2 支持不完整。** 开发者工具里正常、真机上异常。已用两道保险规避：显式传 WebGL 1 上下文 + 锁定 r117。

**7. 满速球会一步跨过零厚度的围边。** 球速上限 700、步长 1/120 秒时单步位移 5.83，而球半径只有 2.3。必须子步进，见 `docs/adr/0008`。

**8. 围边碰撞体必须双面。** 发射航道隔墙是一条零厚度线，球在它左右两侧都可能存在（航道内与台面内）。单面法线会让球在航道那侧被推向错误方向、直接穿墙。见 `docs/adr/0009`。

**9. 挡板角速度要用「实际转过量」而不是设定值。** 挡板到达行程终点会停下，若仍按设定角速度算接触点的表面速度，球会在挡板已经静止后被凭空推一把。`advanceFlipper` 返回实际转过的角度，世界再用它除以 dt。

**10. 主包上限 4M，合计 30M。** 未压缩打包是 3.7M，一不留神就吃光预算。构建脚本默认压缩，需要调试时用 `npm run dev`。

**11. 渲染层里唯一一处小游戏 API 是画布来源，它必须可注入。** `src/render/texture.ts` 原本直接调 `wx.createOffscreenCanvas` / `wx.createCanvas`，这一个人就让渲染层绑死在微信上，浏览器预览无从谈起。现在改为 `setCanvasFactory()` 注入：不注入时走 wx（小游戏真实路径），注入时走 `document.createElement('canvas')`（预览路径）。要留意的两点：一是注入必须发生在 `buildTable()` 之前，否则贴图已经用错误来源画完了；二是不注入且没有 wx 环境时应当**明确抛错**，而不是静默产出一张空白贴图——空白贴图在真机上看起来像「颜色配错了」，极难归因。见 `docs/adr/0010`。

## 构建命令

| 命令 | 说明 |
|---|---|
| `npm run build` | 压缩产物，发布用（默认） |
| `npm run dev` | 不压缩 + 内联 sourcemap，调试用 |
| `npm run watch` | 监听 `src/` 自动重建（强制内联 sourcemap） |
| `npm run typecheck` | 类型检查 |
| `npm run smoke` | Node 冒烟测试（含物理求解器断言） |
| `npm run demo` | 生成 `demo/index.html` 物理调试图 |
| `npm run demo-check` | 生成调试图并做无头验证 |
| `npm run preview` | 生成 `demo/preview.html` 3D 台面预览 |
| `npm run preview-check` | 生成预览并做无头验证（渲染层不碰 wx、贴图确实画出来） |
| `npm run trace` | 跑一遍完整台面并输出球轨迹与命中统计 |
| `npm run probe` | 输出主循环每帧的步数分布 |
| `npm run verify` | 类型检查 + 冒烟测试 + 调试图验证 + 预览验证 + 构建（五步） |
