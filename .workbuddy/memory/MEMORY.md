# 项目长期备忘 — Space Cadet 复刻（微信小游戏）

## 项目约定

- **ADR 文件名必须是 ASCII `NNNN-slug.md`**，中文标题只写在正文 H1 里。
  理由：grill-with-docs 的 `adr_scanner.py` 只接受 ASCII slug，中文文件名会让每个文件都报 `filename-pattern` FAIL，即使编号和内容都对。
- **文档语言中文，代码注释中文，标识符英文。**
- **台面坐标只写在 `src/table/data.ts`**。几何、碰撞、贴图三方都只读这份数据，不在别处写坐标字面量。这是 ADR-0002 / ADR-0005 的落地要求。
- **围边的数据出口只能有一个：`wallSpecs()`。** 它带 id（几何网格挂 `name`、物理碰撞体用同一个 id），几何与物理共享这份返回值。历史 bug：几何里手写了一遍「跳过坠毁开口」而 `wallSegments()` 又把它当墙。同一份数据两个解释正是 ADR-0002 要消灭的东西。
- **物理与渲染必须可独立运行**：物理要能在没有渲染的情况下跑（调试图、测试），渲染要能在没有物理的情况下跑（静态台面预览）。
- **`src/physics/` 里禁止出现 `import ... from 'three'` 与 `wx.`**。这是调试图与 Node 断言能存在的前提。
- **`src/render/` 里禁止出现 `wx.` 与 `GameGlobal`。** 渲染层与小游戏 API 的唯一接触点是**画布来源**，走 `setCanvasFactory()` 注入（`src/render/texture.ts`）。不注入时默认走 wx（小游戏真实路径），注入时走 `document.createElement('canvas')`（浏览器预览路径）。这是 ADR-0010 的硬约束，也是 `npm run preview` 能存在的前提。
- **测试替身必须比真机更严格，不能更宽松。** `tools/mock-env.ts` 刻意让 `GameGlobal` 与 `globalThis` 是两个不同对象、且 `GameGlobal` 是空壳。任何为「让测试通过」而放松替身忠实度的改动都要先自问：这条差异真机上真的不存在吗？

## 原版事实基线（来自反编译资源，作为台面重建的真值来源）

- 上游项目：`k4zmu2a/SpaceCadetPinball`（原版反编译），资源格式 `PARTOUT(4.0)RESOURCE`，共 541 个 group。
- **原版内部坐标系是 600 × 416**，且那是**整个游戏画面**（含右侧计分面板），不是台面本身。映射到我们的逻辑平面（100 × 172，只有台面）**不是等比缩放**，必须先把台面边界从画面里定出来。
- 台面元素精确数量：`attack_bumpers` **4 个**（我们目前 3 个）；`a_targ1`…`a_targ22`（我们目前 6 个）。
- **灯是一等公民**：`lite1`…`lite322` 共 300+ 灯图形、20+ 逻辑灯组。中央灯环 = 中圈 9 + 外圈 19 = **28 盏**；燃料条 = **6 格**（长度递减 `14 12 10 8 6 4`）。
- 原版侧边面板：标题艺术字 + 插画 + `BALL 1` + 分数 + `Player 1` + `Awaiting Deployment`。
- 网络：`api.github.com` 可通；`raw.githubusercontent.com` / `upload.wikimedia.org` / `en.wikipedia.org` **不可通**（raw 只解析到无出口的 IPv6）。取仓库文件走 GitHub Contents API（返回 base64）再本地解码。

## 术语 ↔ 代码标识符映射

领域术语是中文、标识符是英文，两者必须能对上。新增术语或改标识符时同步这张表。

| 术语 | 标识符 | 位置 |
|---|---|---|
| 台面 | `TABLE` | `src/table/data.ts` |
| 逻辑平面 | `PlanePoint` / `planeToWorld()` | `src/table/data.ts` |
| 球 | `ball` / `TABLE.ballRadius` / `BallBody` | `data.ts` / `physics/world.ts` |
| 挡板 | `flippers` / `FlipperSpec` / `FlipperCollider` | `data.ts` / `physics/colliders.ts` |
| 反弹器 | `rebounds` | `src/table/data.ts` |
| 缓冲器 | `bumpers` / `CircleCollider`(role `bumper`) | `data.ts` / `physics/colliders.ts` |
| 击倒目标 | `dropTargets` | `src/table/data.ts` |
| 使命目标 | `missionTargets` | `src/table/data.ts` |
| 发射器 | `plunger` | `src/table/data.ts` |
| 发射航道 | `launchLane` / `wall:lane-inner` | `src/table/data.ts` |
| 围边 | `wallSpecs()` / `wallSegments()` / `SegmentCollider` | `data.ts` / `physics/colliders.ts` |
| 坠毁开口 | `OUTLINE_OPEN_EDGES` | `src/table/data.ts` |
| 坠毁 | `World.outOfBounds` | `src/physics/world.ts` |
| 攻击缓冲器 | 待落地（计划 `attackBumpers`） | `src/table/data.ts` |
| 发射缓冲器 | 待落地（计划 `launchBumpers`） | `src/table/data.ts` |
| 虫洞 | 待落地（计划 `wormholes`） | `src/table/data.ts` |
| 超空间发射 | 待落地（计划 `hyperspace`） | `src/table/data.ts` |
| 燃料条 | 待落地（计划 `fuelBar`，6 格，长度递减 `14 12 10 8 6 4`） | `src/table/data.ts` |
| 灯 | 待落地（计划 `LampSpec` / `lamps`） | `src/table/data.ts` |
| 灯组 | 待落地（计划 `LampGroup` / 按组批量更新） | `src/table/data.ts` / `src/render/` |

尚未落地到代码的术语（M5+ 实现）：使命、军衔、进度灯、扩大战场、技能发射、重玩球、加分球、倾斜、黑洞、坡道、航道、点亮目标（泛称）。

> `glossary_code_consistency.py` 会把这些报成 dead glossary，因为该脚本只统计代码、不读注释，而我们的领域词都写在中文注释里。这是已知的工具局限，判据以这张映射表为准。

## 环境约定

- 本机 `$HOME` 未设置，跑 npm / git 前先 `export HOME=/home/LiangBo`。
- Node 用托管版：`/home/LiangBo/.workbuddy/binaries/node/versions/22.22.2/bin/`。
- 构建产物与测试临时文件都在 `.gitignore` 里（`dist/`、`demo/`、`.smoke/`、`.Trash-0/`）。

## 已知技术地雷（都是实测踩出来的，别重踩）

1. **three@0.117.0 几何类双命名。** 短名 `BoxGeometry` / `ExtrudeGeometry` / `PlaneGeometry` / `CylinderGeometry` / `SphereGeometry` 在这版是遗留 `Geometry`（只有 `.vertices`，无 `.attributes` / `.setAttribute`）。BufferGeometry 变体带 `BufferGeometry` 后缀，两组名字定义在同一源文件里。**必须用 `*BufferGeometry`。** r125 之后短名才合并。
2. **polyfill 必须先于业务代码执行。** three.js 模块级代码加载时就访问 `window` / `document`。所以拆 `dist/polyfill.js` + `dist/app.js` 两个产物，顺序由 `game.js` 显式保证，不依赖 `import` 次序。
3. **小游戏第一次 `wx.createCanvas()` 才是屏幕画布**，后续调用返回离屏画布。必须挂全局复用，否则「渲染成功但屏幕全黑」。
4. **真机 WebGL 2 支持不完整**（工具正常、真机异常）。显式传 `getContext('webgl')` + 锁 three r117 双保险。
5. **相机适配不能用解析近似**，要对真实投影做数值求解（近端离相机近，解析式会低估投影量，实测近端被裁掉 19%）。
6. **小游戏主包 ≤ 4M、合计 ≤ 30M。** 未压缩打包 3.7M，构建默认压缩。
7. **小游戏没有 WXML**，所有 UI 必须用 canvas 或 3D 浮动平面自绘。
8. **小游戏账号类型注册后不可逆**（小游戏 ≠ 小程序，AppID 独立）。
9. **`GameGlobal` 与 `globalThis` 在不同 JS 引擎/基础库上关系不一致**，可能是同一个也可能是两个独立对象。只写一边不报错，而是「一边能读到、一边读不到」。所以全局写入必须双写，判断全局能力必须两边都查（`readGlobal`）。踩过的坑：`if (!g.performance)` 在 `g = GameGlobal` 时恒为真，把真实 `performance` 覆盖成 `Date.now()` 实现，真机表现为周期性卡顿。见 ADR-0007。
10. **满速球会一步跨过零厚度围边**（700/120 = 5.83 位移 vs 半径 2.3）。必须子步进。见 ADR-0008。
11. **围边碰撞体必须双面**，因为发射航道隔墙是零厚度线、球在它两侧都可能存在。单面会让球在航道那侧被推向错误方向直接穿墙。见 ADR-0009。
12. **挡板角速度必须用「实际转过量 / dt」而不是设定角速度**，否则球会在挡板已静止后被凭空推一把。
13. **Node 自带而小游戏没有的全局**（如 Node 21+ 的 `navigator`）要在 `tools/mock-env.ts` 里显式清掉，否则 polyfill 会（正确地）跳过替身安装，替身就不再忠实于真机。
14. **没有 `import`/`export` 的 `.ts` 文件会被 TS 当作全局脚本**，其顶层 `const` 变成全局声明，和别的同类文件撞名（`src/env/polyfill.ts` 与 `tools/demo-harness.ts` 的 `const g` 就撞过）。给这类文件加一行 `export {}` 即可，不影响打包。顶层 `await` 也要求文件是模块。
15. **渲染层的画布来源必须可注入，且两条路径都要有明确行为。** 三点落地细节：① 判断 `wx` 是否存在要用 `typeof wx !== 'undefined'`，**不能写 `wx.xxx`**——`typeof` 对未声明的标识符安全，属性访问会抛 `ReferenceError`；② 不注入工厂且没有 wx 环境时应当**明确抛错**，不要静默返回一张空白画布——空白贴图在真机上看起来像「配色错了」，极难归因；③ 注入必须发生在 `buildTable()` 之前，否则贴图已经用错误来源画完了。见 ADR-0010。
16. **两个校验器在本沙箱里用 CLI 直调会静默退出（exit 1、零输出）。** `adr_scanner.py` 与 `context_md_linter.py` 直接 `python3 <script> <path>` 拿不到任何输出（连 `--sample` 也一样）。绕过方式：用 `importlib.util.spec_from_file_location` 加载模块，直接调 `scan_directory()` / `lint()` 读返回的 dict。这不是脚本有 bug，是沙箱环境的问题。

## 验证手段

- `npm run verify` = typecheck + smoke + demo-check + preview-check + build（五步）。
- `npm run smoke` 在 Node 里用替身环境（`tools/mock-env.ts`）跑真实模块，覆盖 polyfill（含「双写」「不得覆盖真实 performance」两条回归护栏）、台面几何管线、相机适配（多比例俯角恒定 / 不裁切）、主循环定步长与卡顿防护、**物理求解器五条断言**。改代码后有秒级反馈。
- `npm run demo` → `demo/index.html`：把同一份 `src/physics` 单独打包成自包含 HTML。调手感用，不用等小游戏构建、不用真机预览。
- `npm run preview` → `demo/preview.html`：把 `src/table` + `src/render` 打包成自包含 HTML，看**真正的 three.js 台面**。改美术时的即时反馈回路，见 ADR-0010。
- `npm run preview-check`：`tools/preview-harness.ts` 注入浏览器式画布工厂 → `buildTable()` 应不抛异常且贴图确实画出来（`30 次 2D 调用，其中描边 6 次、带贴图材质 1 个`）；再断言 `setCanvasFactory(null)` 在无 wx 环境时**明确报错**。**不验 WebGL**——本机没有 GL 上下文。
- `npm run trace`：球轨迹追踪（位置/速率/子步数 + 各类碰撞体命中次数）。回答「球会不会被卡住」「能不能自然坠毁」。M3 校准台面时逐次对照它。
- `npm run probe`：主循环每帧步数分布。定位时序类缺陷的专用工具（假时钟 bug 就是它找出来的）。
- 冒烟测试**不能**替代真机验证：WebGL 上下文创建、真实 GPU 渲染结果、触摸坐标只能在真机看。预览页也一样——它显式取 WebGL 1 并在读数里标出实际版本，就是为了避免拿浏览器的效果去推断真机。
