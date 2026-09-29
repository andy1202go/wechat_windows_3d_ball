# 用浏览器 3D 预览做美术的反馈回路

Status: accepted

美术工作缺一个反馈回路。物理能靠数字断言验证（能量漂移 0.0000%、挡板峰值 323.8），视觉不能 —— 看不见就调不动。而当时的处境是：唯一能看到的画面是 `demo/index.html` 那个 2D 碰撞体线框图，真正的 three.js 台面**没有任何途径看到**。本机跑不了 Chromium 内核，真机验证又是尚未解决的阻断项。

于是新增 `src/preview.ts` 与 `npm run preview`，把同一份 `src/table` 与 `src/render` 打包成单文件 `demo/preview.html`，在浏览器里渲染真实台面：可拖动旋转、滚轮缩放、切换模拟机型、键盘拍挡板。

为此 `src/render/texture.ts` 的画布来源从写死 `wx.createOffscreenCanvas / wx.createCanvas` 改为可注入的工厂（`setCanvasFactory`）。这是整个改动里**唯一**需要动渲染层的地方——其余小游戏 API（`GameGlobal`、`wx.onTouch*`、`wx.onHide/onShow`）本来就集中在 `main.ts` 顶层，预览有自己的入口，一行都不用碰。

## Consequences

- 预览**不替代**真机验证。WebGL 扩展支持、GPU 实际表现、着色器编译、触摸坐标都只能在真机上看。它的定位是「改美术时立刻看得见」，不是「证明真机没问题」。
- 预览显式取 WebGL 1，与真机一致（ADR-0004），并在读数里标出实际拿到的版本与是否 WebGL2。浏览器给了 WebGL 2 时会写明「真机不支持」——避免拿浏览器的效果去推断真机。
- 预览**放开** ADR-0006 的「相机角度恒定」约束（看画风需要从别的角度看），但初始值仍是 62°，所以打开就是游戏里的构图。这条放开只存在于预览，产品相机不动。
- 渲染层从此多一条硬约束：**不得出现 `wx.` 与 `GameGlobal`**。`tools/preview-harness.ts` 在没有 wx 的环境里注入浏览器式画布工厂并跑通 `buildTable()` 来机器验证它——一旦有人往渲染层里塞小游戏 API，`npm run preview-check` 立刻失败。
- 预览页面的元素 id 由构建脚本与 `src/preview.ts` 交叉校验，与 `build-demo.mjs` 同一机制。
- 无头验证**不覆盖** WebGL：本机没有可用的 GL 上下文，伪造一个能骗过 three 的替身既困难又会让验证失去意义。这一条诚实留白，写在 `tools/preview-harness.ts` 的文件头里。
