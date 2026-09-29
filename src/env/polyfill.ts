/**
 * 微信小游戏环境 polyfill。
 *
 * three.js r117 在**模块加载期**就会访问 window / document，任何一处缺失都会让
 * app.js 在初始化阶段直接崩，而且报错位置指向 three 内部，极难定位。
 * 所以这个 bundle 必须由 game.js 保证先于 app.js 执行。
 *
 * 设计约束（见 docs/adr/0004-锁定threejs-r117与webgl1.md）：
 * 只补我们和 three 真正会用到的接口，每一条都标注使用者。不做 weapp-adapter
 * 的整体移植——它塞进来大量用不到的分支，反而会掩盖真机上真正的兼容性问题。
 */

// 显式声明这是一个模块。没有这行的话，TypeScript 会把这个文件当作**全局脚本**，
// 于是下面 `const g` 变成全局声明，和别的工具文件里的同名变量冲突。
// 运行期本来就没问题（打包器按模块处理），但类型检查会报重复声明。
export {};

const nativeGlobal: any = globalThis as any;
const gameGlobal: any = typeof GameGlobal !== 'undefined' ? (GameGlobal as any) : nativeGlobal;
const g: any = gameGlobal;

/**
 * 所有全局写入都必须走这里，把 key 同时写到 GameGlobal 与 globalThis。
 *
 * 为什么不能只写一个：真机上这两个对象的关系在不同 JS 引擎/基础库上并不一致 ——
 * 有的是同一个全局对象，有的 GameGlobal 是独立对象。只写一边的后果不是报错，
 * 而是「一边能读到、一边读不到」，表现为**渲染成功但屏幕全黑**，极难定位。
 *
 * 也不能只写 globalThis 就完事：three.js 打包后的代码里用的是裸标识符
 * `window` / `document`，它们走作用域链解析到真正的全局；而业务代码显式读
 * `GameGlobal.canvas`。两个方向都得满足，所以两个目标都写。
 */
const globalTargets: any[] = [];
for (const target of [gameGlobal, nativeGlobal]) {
  if (target && globalTargets.indexOf(target) < 0) globalTargets.push(target);
}

function publishGlobal(key: string, value: any): void {
  for (const target of globalTargets) {
    try {
      target[key] = value;
    } catch (err) {
      // 某些目标上该 key 可能是只读代理，退一步用 defineProperty 重定义
      try {
        Object.defineProperty(target, key, { value, writable: true, configurable: true });
      } catch (err2) {
        // 两个目标都写不进去时无计可施，但不该让整个启动流程挂掉
      }
    }
  }
}

/**
 * 从任一全局目标上读取，优先 GameGlobal。
 *
 * **判断某个全局能力是否存在，必须走这里，不能只看 GameGlobal。**
 * 这是一个真实 bug 的教训：原先写的是 `if (!g.performance) 装一个假 performance`，
 * 而 GameGlobal 若是独立对象、真正的 performance 只挂在 globalThis 上，这个条件就成立，
 * 于是 polyfill 用 `Date.now()` 的低精度假时钟**覆盖掉了真实现**。
 * 症状不是崩溃，而是主循环拿到毫秒级抖动的时间戳 —— 真机上表现为周期性卡顿，
 * 而且极难归因到 polyfill。
 *
 * 注意 GameGlobal 是真机上的全局对象，它天然能看到所有内置全局；
 * 这里两个目标都查一遍，是为了不把「某个目标上没有」误判成「全局不存在」。
 */
function readGlobal(key: string): any {
  for (const target of globalTargets) {
    const value = target[key];
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// 设备信息
// ---------------------------------------------------------------------------

/**
 * wx.getSystemInfoSync 自基础库 2.20.1 起被标记废弃，但存量基础库仍广泛支持它。
 * 优先用新接口（getWindowInfo / getDeviceInfo），旧接口兜底。
 */
function readSystemInfo(): any {
  if (typeof wx.getWindowInfo === 'function') {
    try {
      const win = wx.getWindowInfo();
      const dev = typeof wx.getDeviceInfo === 'function' ? wx.getDeviceInfo() : {};
      return {
        windowWidth: win.windowWidth,
        windowHeight: win.windowHeight,
        screenWidth: win.screenWidth,
        screenHeight: win.screenHeight,
        pixelRatio: win.pixelRatio,
        safeArea: win.safeArea,
        platform: dev.platform,
        system: dev.system,
        brand: dev.brand,
        model: dev.model,
      };
    } catch (err) {
      // 新接口在部分微信版本上参数或返回结构不一致，落到旧接口
    }
  }
  return wx.getSystemInfoSync();
}

const sys = readSystemInfo();

// ---------------------------------------------------------------------------
// canvas
// ---------------------------------------------------------------------------

/**
 * 小游戏 canvas 缺少浏览器 canvas 的几个成员，three 会直接用到：
 * - style：WebGLRenderer.setSize() 在 updateStyle 非 false 时写入
 * - addEventListener / removeEventListener：挂 webglcontextlost / restored
 */
function shimCanvas(canvas: any): any {
  if (!canvas.style) canvas.style = {};
  if (!canvas.addEventListener) canvas.addEventListener = () => {};
  if (!canvas.removeEventListener) canvas.removeEventListener = () => {};
  return canvas;
}

// 小游戏里第一次 wx.createCanvas() 返回的是屏幕上可见的那块 canvas，
// 后续调用返回离屏 canvas（见 src/render/texture.ts 的 createCanvas2D）。
const screenCanvas = shimCanvas(wx.createCanvas());

// 挂到全局，业务代码从这里取屏幕画布（src/main.ts 读 GameGlobal.canvas）。
// 小游戏运行时不会自动帮我们记住第一次创建的画布，不导出就只能各自再调一次
// wx.createCanvas()，而那拿到的会是离屏画布 —— 画面会「渲染成功但屏幕全黑」。
publishGlobal('canvas', screenCanvas);

// ---------------------------------------------------------------------------
// window
// ---------------------------------------------------------------------------

// 注意：下面这两个 raf/caf 包装必须在发布到全局之前先把原生实现捕获下来，
// 否则包装函数内部再读全局 requestAnimationFrame 会读到包装自身，无限递归。
// 读取走 readGlobal —— 原生实现可能只挂在其中一个全局目标上。
const existingRaf = readGlobal('requestAnimationFrame');
const existingCaf = readGlobal('cancelAnimationFrame');

const raf = (cb: (t: number) => void): number =>
  typeof existingRaf === 'function' ? existingRaf(cb) : screenCanvas.requestAnimationFrame(cb);
const caf = (id: number): void => {
  if (typeof existingCaf === 'function') existingCaf(id);
  else if (screenCanvas.cancelAnimationFrame) screenCanvas.cancelAnimationFrame(id);
};

const win: any = readGlobal('window') || {};
win.innerWidth = sys.windowWidth;
win.innerHeight = sys.windowHeight;
win.devicePixelRatio = sys.pixelRatio;
win.screen = { width: sys.screenWidth, height: sys.screenHeight };
win.canvas = screenCanvas;
win.addEventListener = win.addEventListener || (() => {});
win.removeEventListener = win.removeEventListener || (() => {});
win.requestAnimationFrame = raf;
win.cancelAnimationFrame = caf;
publishGlobal('window', win);

publishGlobal('requestAnimationFrame', raf);
publishGlobal('cancelAnimationFrame', caf);

// three 用 self 做环境探测
if (!readGlobal('self')) publishGlobal('self', g);

// ---------------------------------------------------------------------------
// document
// ---------------------------------------------------------------------------

function shimElement(tagName: string): any {
  return {
    tagName: String(tagName).toUpperCase(),
    style: {},
    children: [],
    setAttribute: () => {},
    removeAttribute: () => {},
    appendChild: (child: any) => child,
    removeChild: (child: any) => child,
    addEventListener: () => {},
    removeEventListener: () => {},
  };
}

const doc: any = readGlobal('document') || {};

doc.createElement = (tagName: string): any => {
  const tag = String(tagName).toLowerCase();
  if (tag === 'canvas') return shimCanvas(wx.createCanvas());
  if (tag === 'img' || tag === 'image') {
    return typeof wx.createImage === 'function' ? wx.createImage() : shimElement(tag);
  }
  return shimElement(tag);
};

// three 的纹理加载路径会调 createElementNS 造 img / canvas
doc.createElementNS = (_ns: string, tagName: string): any => doc.createElement(tagName);
doc.createTextNode = () => shimElement('text');
doc.addEventListener = () => {};
doc.removeEventListener = () => {};
doc.body = shimElement('body');
doc.documentElement = shimElement('html');
publishGlobal('document', doc);

// ---------------------------------------------------------------------------
// navigator / performance
// ---------------------------------------------------------------------------

// 只在**两个全局目标上都没有**时才装替身。
// 这里必须用 readGlobal：只看 GameGlobal 会把真机上真实存在的 performance 覆盖成
// Date.now() 低精度假时钟，主循环拿到毫秒级抖动的时间戳，真机上表现为周期性卡顿。
if (typeof readGlobal('performance')?.now !== 'function') {
  const start = Date.now();
  publishGlobal('performance', { now: () => Date.now() - start });
}

if (!readGlobal('navigator')) {
  publishGlobal('navigator', {
    userAgent: `minigame/${sys.platform || 'unknown'}`,
    platform: sys.platform || 'unknown',
  });
}

// ---------------------------------------------------------------------------
// 给业务代码用（避免重复调 getSystemInfoSync）
// ---------------------------------------------------------------------------

publishGlobal('__SC_DEVICE__', sys);
