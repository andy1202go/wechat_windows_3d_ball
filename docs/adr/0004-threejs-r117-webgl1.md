# 锁定 three.js r117 与 WebGL 1

Status: accepted

three.js 自 r118 起 `WebGLRenderer` 默认申请 WebGL 2 上下文，而微信真机对 WebGL 2 的支持不完整——开发者工具里渲染正常、真机上出现异常显示。我们锁定 r117 并自写轻量 adapter，从源头避开这个差异。

代码上落了两道保险，任意一道单独都够用：

1. **显式取 WebGL 1 上下文再交给 three**：`canvas.getContext('webgl', attrs)` 的结果通过 `WebGLRenderer({ context })` 传入，不让 three 自己挑。
2. **版本锁定**。已核实 r117 的 `build/three.module.js` 第 24364 行：

   ```js
   _gl = _context || _canvas.getContext( 'webgl', contextAttributes ) || _canvas.getContext( 'experimental-webgl', contextAttributes );
   ```

   r117 只尝试 `webgl` 与 `experimental-webgl`，**从不尝试 `webgl2`**，所以即便不传 context 也走不到 WebGL 2。

选 r117 而不是「最新版 + `@minisheep/three-platform-adapter`」：三方适配层开发体验更接近标准 three.js 且声明支持 0.151.0+，但它把「真机 WebGL 2 是否可用」这个判定重新交给了运行时。我们的场景只需要 Mesh / Geometry / Material / Light 这些 r117 早已稳定的能力，用新版本换不到收益，却引入一个外部依赖和一次真机不确定性。

## Consequences

- adapter 需自行 polyfill 小游戏环境缺失的 `window` / `document` / `canvas` 相关接口与纹理加载路径，控制在最小必需集合，不整体移植 `weapp-adapter`。
- **几何类必须使用 `*BufferGeometry` 后缀命名。** r117 尚未合并两组名字：短名（`BoxGeometry`、`ExtrudeGeometry`、`PlaneGeometry`、`CylinderGeometry`、`SphereGeometry`…）在这版里仍是遗留 `Geometry` 类，只有 `.vertices` / `.faces`，没有 `.attributes` / `.setAttribute`；真正的 BufferGeometry 变体叫 `BoxBufferGeometry`、`ExtrudeBufferGeometry` 等——两组名字定义在同一个源文件里（如 `BoxGeometry.js` 同时导出两个类）。我们的台面要手工写 UV，必须用 BufferGeometry 变体。r125 之后短名才指向 BufferGeometry，届时这段命名需要统一清理，否则代码里会留下一批看起来「多余」的后缀。
- 放弃 three.js r118 之后的新特性（新的色彩管理、后处理节点系统等）。若后续确需，须重新评估本决定。
- **M1 阶段必须先做真机验证**：锁 WebGL 1 后在小游戏真机上渲染正常，才进入玩法开发。这条不通过就要重启技术选型。
