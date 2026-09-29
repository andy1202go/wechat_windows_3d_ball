/**
 * 小游戏运行时的最小替身，供 Node 冒烟测试使用。
 *
 * 这个文件必须**先于**其它任何模块被求值（smoke.ts 的第一行 import），
 * 因为 polyfill 与 three.js 都会在模块加载期读取这些全局对象。
 */

export const clock = {
  now: 0,
  advance(ms: number): void {
    this.now += ms;
  },
};

/** 循环每帧只挂一个 rAF 回调，所以单个槽位就够 */
export let rafCallback: ((time: number) => void) | null = null;

export function pumpRaf(): void {
  const callback = rafCallback;
  rafCallback = null;
  if (callback) callback(clock.now);
}

/** 记录 showModal 的内容，用来断言致命错误路径 */
export const modals: string[] = [];

/** 统计 2D 绘图调用，用来确认贴图确实被画过 */
export const drawCalls: Record<string, number> = {};

function make2DContext(): any {
  const methods = [
    'createLinearGradient',
    'createRadialGradient',
    'fillRect',
    'clearRect',
    'strokeRect',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'arc',
    'fill',
    'stroke',
    'fillText',
    'strokeText',
    'save',
    'restore',
    'translate',
    'rotate',
    'scale',
    'drawImage',
  ];
  const target: any = {};
  for (const name of methods) {
    target[name] = (..._args: any[]): any => {
      drawCalls[name] = (drawCalls[name] || 0) + 1;
      // createLinearGradient / createRadialGradient 必须返回带 addColorStop 的对象
      if (name.indexOf('create') === 0) {
        return { addColorStop: (): void => {} };
      }
      return undefined;
    };
  }
  // 可写属性：任何未列出的成员都视为真的写错了 API，直接报错。
  // 这一点很重要——用 Proxy 静默兜底会把 ctx.createLineargradient 这类拼写错误放过去。
  return new Proxy(target, {
    get(obj, key) {
      if (key in obj) return obj[key];
      if (typeof key === 'string' && /^(fillStyle|strokeStyle|lineWidth|font|textBaseline|textAlign|globalAlpha|globalCompositeOperation|lineCap|lineJoin|shadowBlur|shadowColor|filter)$/.test(key)) {
        return undefined;
      }
      throw new Error(`2D 上下文被访问了未实现的成员：${String(key)}`);
    },
    set(obj, key, value) {
      obj[key] = value;
      return true;
    },
  });
}

function makeCanvas(width: number, height: number, kind: string): any {
  return {
    width,
    height,
    kind,
    getContext(type: string): any {
      if (type === '2d') return make2DContext();
      // 冒烟测试不提供 WebGL，主流程会走「上下文创建失败」的致命分支
      return null;
    },
    requestAnimationFrame: (callback: (time: number) => void): number => {
      rafCallback = callback;
      return 1;
    },
    cancelAnimationFrame: (): void => {
      rafCallback = null;
    },
  };
}

let canvasCount = 0;

const wxMock: any = {
  getWindowInfo: () => ({
    windowWidth: 393,
    windowHeight: 852,
    screenWidth: 393,
    screenHeight: 852,
    pixelRatio: 3,
    safeArea: { top: 59, bottom: 818, left: 0, right: 393 },
  }),
  getDeviceInfo: () => ({
    platform: 'android',
    system: 'Android 14',
    brand: 'mock',
    model: 'SmokeTest',
  }),
  getSystemInfoSync: () => wxMock.getWindowInfo(),
  createCanvas: (): any => makeCanvas(393, 852, canvasCount++ === 0 ? 'screen' : 'offscreen'),
  createOffscreenCanvas: (options: any): any =>
    makeCanvas(options && options.width ? options.width : 300, options && options.height ? options.height : 150, 'offscreen-2d'),
  createImage: (): any => ({ width: 0, height: 0 }),
  showModal: (options: any): void => {
    modals.push(String(options && options.content));
  },
  onTouchStart: (): void => {},
  onTouchMove: (): void => {},
  onTouchEnd: (): void => {},
  onTouchCancel: (): void => {},
  onHide: (): void => {},
  onShow: (): void => {},
};

const nativeGlobal: any = globalThis;

/**
 * 真机上 GameGlobal 与 globalThis 是**两个不同的对象**（开发者工具里常常是同一个）。
 *
 * 这里刻意让它们不同，因为把它们写成同一个会掩盖一类真实故障：
 * 只往一边写全局属性时，另一边的读取者拿到 undefined。历史故障症状是
 * 「渲染成功但屏幕全黑」—— polyfill 把画布挂到了 GameGlobal，或反之。
 *
 * 还刻意让 GameGlobal 是个**空壳对象**（比真机更严格）：真机上 GameGlobal 是全局对象，
 * 天然能看到 performance / Date 这些内置全局，而空壳看不到。正是这份严格暴露了
 * 一个真实 bug —— polyfill 原先只看 `GameGlobal.performance` 是否存在来决定要不要装
 * 假时钟，于是在这个模型下把真实的 performance 覆盖成了 `Date.now()` 低精度实现。
 * 结论：polyfill 判断全局能力必须用 readGlobal（两个目标都查），不能只看 GameGlobal。
 */
const gameGlobal: any = {
  requestAnimationFrame: (callback: (time: number) => void): number => {
    rafCallback = callback;
    return 1;
  },
  cancelAnimationFrame: (): void => {
    rafCallback = null;
  },
};

nativeGlobal.GameGlobal = gameGlobal;
nativeGlobal.wx = wxMock;

// Node 自带真实的 performance，polyfill 因此不会替换它。
// 主循环要靠受控时钟推进，必须强行覆盖。
Object.defineProperty(nativeGlobal, 'performance', {
  value: { now: () => clock.now },
  configurable: true,
  writable: true,
});

// Node 21+ 自带 navigator，而小游戏环境里没有这个全局。
// 不清掉的话 polyfill 会（正确地）跳过替身安装，替身就不再忠实于真机。
Object.defineProperty(nativeGlobal, 'navigator', {
  value: undefined,
  configurable: true,
  writable: true,
});

nativeGlobal.requestAnimationFrame = gameGlobal.requestAnimationFrame;
nativeGlobal.cancelAnimationFrame = gameGlobal.cancelAnimationFrame;

/** 供冒烟测试断言「两个全局都拿到了同一个值」 */
export { gameGlobal, nativeGlobal };
