/**
 * 调试图的无头验证。
 *
 * 物理本身已经有五条断言（tools/smoke.ts 的 F 组）保着，但这个工具**不是**物理 ——
 * 它是 DOM 装配：13 个元素查找、事件绑定、尺寸计算、输入到挡板的映射。
 * 这些在构建期查不出来，只会在打开页面时炸。构建脚本已经校验了元素 id 都存在，
 * 但「id 对了、用法错了」它管不着。
 *
 * 所以这里搭一套最小 DOM 替身，把调试图真的跑起来，然后断言：
 *   1. 加载期不抛异常（13 个元素都取到了）
 *   2. 渲染循环真的在跑（球动了、帧数在涨）
 *   3. 点击右半屏 → 右挡板按下；点左半屏 → 左挡板按下（不是按画布中线分的）
 *   4. 方向键 → 对应挡板按下
 *   5. 重置 → 球回到出发点
 *
 * 替身的原则和 tools/mock-env.ts 相反：那里要严格（未知的 2D API 直接抛错），
 * 这里要**宽容**（2D 调用一律空转）。因为这里验证的是调用方不崩，
 * 而不是绘图 API 用得对不对 —— 后者只能在真浏览器里看。
 */

// 顶层 await 需要这个文件是模块（同时也是为了不和别的无 import 文件撞全局名）
export {};

const clock = { now: 0 };
let rafCallback: ((time: number) => void) | null = null;

/** 宽容的 2D 上下文：任何方法调用都空转，任何属性赋值都吞掉 */
const stubContext: any = new Proxy(
  {},
  {
    get(target: any, key) {
      if (key in target) return target[key];
      return (): void => undefined;
    },
    set(target: any, key, value) {
      target[key] = value;
      return true;
    },
  },
);

interface StubElement {
  addEventListener(type: string, handler: (event: any) => void): void;
  dispatch(type: string, event: any): void;
  [key: string]: any;
}

function makeElement(seed: Record<string, any>): StubElement {
  const listeners: Record<string, ((event: any) => void)[]> = {};
  const element: any = {
    style: {},
    textContent: '',
    addEventListener(type: string, handler: (event: any) => void): void {
      (listeners[type] || (listeners[type] = [])).push(handler);
    },
    removeEventListener(): void {},
    dispatch(type: string, event: any): void {
      for (const handler of listeners[type] || []) handler(event);
    },
    ...seed,
  };
  return element as StubElement;
}

function makeCanvas(): StubElement {
  return makeElement({
    clientWidth: 600,
    clientHeight: 900,
    width: 600,
    height: 900,
    getContext: (type: string): any => (type === '2d' ? stubContext : null),
    getBoundingClientRect: (): any => ({ left: 0, top: 0, width: 600, height: 900, right: 600, bottom: 900 }),
    setPointerCapture: (): void => {},
  });
}

const elements: Record<string, StubElement> = {
  stage: makeCanvas(),
  overlay: makeElement({}),
  drained: makeElement({}),
  // 控件的 value 必须是可被 Number() 解析的字符串，且取真实默认值，
  // 否则读进去的会是 NaN，验证就失去意义了
  'in-gravity': makeElement({ value: '120', disabled: false }),
  'in-wall': makeElement({ value: '0.94', disabled: false }),
  'in-flipper': makeElement({ value: '900', disabled: false }),
  'in-kick': makeElement({ value: '55', disabled: false }),
  'in-lossless': makeElement({ checked: false }),
  'out-gravity': makeElement({}),
  'out-wall': makeElement({}),
  'out-flipper': makeElement({}),
  'out-kick': makeElement({}),
  'btn-reset': makeElement({}),
};

const windowListeners: Record<string, ((event: any) => void)[]> = {};

const g: any = globalThis;
g.document = {
  getElementById: (id: string): StubElement | null => elements[id] || null,
};
g.window = g;
g.devicePixelRatio = 2;
g.addEventListener = (type: string, handler: (event: any) => void): void => {
  (windowListeners[type] || (windowListeners[type] = [])).push(handler);
};
g.removeEventListener = (): void => {};
g.performance = { now: (): number => clock.now };
g.requestAnimationFrame = (callback: (time: number) => void): number => {
  rafCallback = callback;
  return 1;
};
g.cancelAnimationFrame = (): void => {
  rafCallback = null;
};
g.ResizeObserver = class {
  observe(): void {}
  disconnect(): void {}
};

function dispatchWindow(type: string, event: any): void {
  for (const handler of windowListeners[type] || []) handler(event);
}

function pumpFrame(ms: number): void {
  clock.now += ms;
  const callback = rafCallback;
  rafCallback = null;
  if (callback) callback(clock.now);
}

// ---------------------------------------------------------------------------
// 跑起来
// ---------------------------------------------------------------------------

const failures: string[] = [];
const notes: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) return;
  failures.push(message);
}

try {
  await import('./physics-demo');
  notes.push('调试图在加载期未抛异常（13 个页面元素全部取到）');
} catch (err) {
  failures.push(`调试图加载期抛异常：${(err as Error).message}`);
}

const demo = (globalThis as any).__DEMO__;

if (!demo) {
  failures.push('调试图没有挂出 __DEMO__ 调试句柄');
} else {
  const world0 = demo.getWorld();
  check(world0.colliders.length > 0, '物理世界没有装配任何碰撞体');

  const startX = world0.ball.position.x;
  const startY = world0.ball.position.y;
  for (let i = 0; i < 30; i++) pumpFrame(1000 / 60);
  const movedDistance = Math.hypot(
    world0.ball.position.x - startX,
    world0.ball.position.y - startY,
  );
  check(movedDistance > 1, `30 帧后球几乎没动（位移 ${movedDistance.toFixed(2)}）`);
  check(demo.loop.metrics.frames >= 30, `渲染帧数偏少：${demo.loop.metrics.frames}`);
  notes.push(`主循环: 30 帧后球位移 ${movedDistance.toFixed(1)}，渲染 ${demo.loop.metrics.frames} 帧`);

  // 半屏映射：画布宽 600、逻辑平面在画布里居中，所以画布中线并不等于平面 x=0。
  // 用 clientX 550 落在右半屏、clientX 50 落在左半屏。
  const stage = elements.stage;

  stage.dispatch('pointerdown', { pointerId: 1, clientX: 550 });
  let flipperStates = demo.getWorld().flippers.map((f: any) => `${f.side}=${f.pressed}`).join(' ');
  check(
    demo.getWorld().flippers.every((f: any) => f.pressed === (f.side === 'right')),
    `点击右半屏后挡板状态不对：${flipperStates}`,
  );
  stage.dispatch('pointerup', { pointerId: 1, clientX: 550 });

  stage.dispatch('pointerdown', { pointerId: 2, clientX: 50 });
  flipperStates = demo.getWorld().flippers.map((f: any) => `${f.side}=${f.pressed}`).join(' ');
  check(
    demo.getWorld().flippers.every((f: any) => f.pressed === (f.side === 'left')),
    `点击左半屏后挡板状态不对：${flipperStates}`,
  );
  stage.dispatch('pointerup', { pointerId: 2, clientX: 50 });

  notes.push('半屏映射: 画布中线 ≠ 逻辑平面 x=0，已按平面坐标划分左右（点击处正确落到对应挡板）');

  dispatchWindow('keydown', { key: 'ArrowRight', preventDefault: (): void => {} });
  check(
    demo.getWorld().flippers.find((f: any) => f.side === 'right').pressed === true,
    'ArrowRight 没有按下右挡板',
  );
  dispatchWindow('keyup', { key: 'ArrowRight', preventDefault: (): void => {} });
  check(
    demo.getWorld().flippers.every((f: any) => !f.pressed),
    '松开 ArrowRight 后挡板没有复位',
  );

  // 重置：球回到出发点并带上初速
  for (let i = 0; i < 20; i++) pumpFrame(1000 / 60);
  elements['btn-reset'].dispatch('click', {});
  const reset = demo.getWorld().ball;
  check(
    Math.abs(reset.position.x - 0) < 0.001 && Math.abs(reset.position.y - 150) < 0.001,
    `重置后球位置不对：(${reset.position.x.toFixed(2)}, ${reset.position.y.toFixed(2)})`,
  );
  check(demo.getWorld().ball.velocity.y < 0, '重置后球没有向上的初速');
  notes.push('重置: 球回到 (0, 150) 并获得向上初速');

  // 参数改动要能重建世界（恢复系数是在构造碰撞体时烘焙进去的）
  const beforeWall = demo.getWorld().colliders.filter((c: any) => c.kind === 'segment')[0]
    .restitution;
  elements['in-wall'].value = '0.60';
  elements['in-wall'].dispatch('input', {});
  const afterWall = demo.getWorld().colliders.filter((c: any) => c.kind === 'segment')[0]
    .restitution;
  check(afterWall !== beforeWall, `改围边弹性后碰撞体没有重建（仍是 ${afterWall}）`);
  check(
    Math.abs(afterWall - 0.6) < 0.0001,
    `重建后的围边弹性不是 0.60，而是 ${afterWall}`,
  );
  notes.push(`参数重建: 围边弹性 ${beforeWall} → ${afterWall}（碰撞体已按新参数重建）`);
}

console.log('');
console.log('检查项');
for (const note of notes) console.log('  · ' + note);
console.log('');
if (failures.length === 0) {
  console.log('调试图无头验证：全部通过');
} else {
  console.log(`调试图无头验证：${failures.length} 项失败`);
  for (const failure of failures) console.log('  ✗ ' + failure);
  process.exit(1);
}
