/**
 * 3D 预览的无头验证。
 *
 * 先讲清楚它**不**验证什么：本机跑不了任何 Chromium 内核（已实测），
 * 所以 WebGL 渲染结果、着色器编译、GPU 表现一律验不了。假装能验比不验更糟。
 *
 * 它验的是本次重构真正引入的那一处风险：
 *   texture.ts 原本直接调 wx.createOffscreenCanvas / wx.createCanvas，
 *   这是唯一一处深入渲染层的小游戏 API。要让同一份代码在浏览器里跑起来，
 *   它必须变成可注入的；而「注入成功」和「只是没报错」是两回事 ——
 *   后者可能意味着贴图压根没画。
 *
 * 于是这里在没有 wx 的环境里注入浏览器式画布工厂，跑通台面构建，
 * 并断言贴图确实被画了出来（而不是留给 CanvasTexture 一张空白画布）。
 */

import { createCanvas2D, setCanvasFactory } from '../src/render/texture';
import { buildTable } from '../src/table/geometry';

const failures: string[] = [];
const notes: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) return;
  failures.push(message);
}

// ---------------------------------------------------------------------------
// 替身：浏览器式画布
//
// 取舍与 demo-harness 一致 —— 这里要**宽容**（2D 调用一律空转），因为验证的是
// 调用方不崩，而不是绘图 API 用得对不对；后者的判据是浏览器里的实际画面。
// 唯一的例外是把调用名记下来，用来断言「确实画了东西」。
// ---------------------------------------------------------------------------

const drawLog: string[] = [];

function make2DContext(): any {
  return new Proxy(
    {},
    {
      get(target: any, key: string) {
        if (key in target) return target[key];
        if (key === 'createLinearGradient' || key === 'createRadialGradient') {
          return (): any => {
            drawLog.push(key);
            return { addColorStop: (): void => undefined };
          };
        }
        return (): void => {
          drawLog.push(key);
        };
      },
      set(target: any, key: string, value: unknown) {
        target[key] = value;
        return true;
      },
    },
  );
}

function makeBrowserCanvas(width: number, height: number): any {
  const ctx = make2DContext();
  return {
    width,
    height,
    getContext: (type: string): any => (type === '2d' ? ctx : null),
  };
}

// ---------------------------------------------------------------------------
// 验一：注入浏览器式画布后，台面构建能在没有 wx 的环境里跑通
// ---------------------------------------------------------------------------

check(typeof (globalThis as any).wx === 'undefined', '本验证要求环境里没有 wx，实际存在');

setCanvasFactory(makeBrowserCanvas);

let table: ReturnType<typeof buildTable> | null = null;
let buildError = '';
try {
  table = buildTable();
} catch (err) {
  buildError = (err as Error).message;
}

check(buildError === '', `注入画布工厂后 buildTable() 抛异常：${buildError}`);

if (table) {
  const built = table;

  check(built.group.children.length > 0, '台面 group 里没有任何子对象');
  notes.push(`台面构建：${built.group.children.length} 个顶层子对象`);

  // 贴图真的接到了材质上吗？接不上就等于没有美术，而且不会报错
  let mappedMaterials = 0;
  built.group.traverse((node: any) => {
    if (node.material && node.material.map) mappedMaterials++;
  });
  check(mappedMaterials >= 1, '台面没有任何带贴图的材质 —— 贴图管线没走到');

  const strokes = drawLog.filter((name) => name === 'stroke').length;
  check(drawLog.length > 0, '贴图绘制期间没有任何 2D 调用 —— 画布工厂可能根本没被用到');
  check(strokes >= 5, `贴图描边次数偏少（${strokes}）—— 装饰没画全`);

  notes.push(`贴图绘制：${drawLog.length} 次 2D 调用，其中描边 ${strokes} 次、带贴图材质 ${mappedMaterials} 个`);

  built.dispose();
}

// ---------------------------------------------------------------------------
// 验二：不注入时，缺少小游戏 API 应当**明确报错**，而不是静默产出空白贴图
//
// 这是「替身要比真机更严格」的镜像：宁可启动就炸得响亮，也不要画出一张空贴图，
// 让人看到「渲染成功但屏幕全黑」还去查渲染器。
// ---------------------------------------------------------------------------

setCanvasFactory(null);

let defaultError = '';
try {
  createCanvas2D(64, 64);
} catch (err) {
  defaultError = (err as Error).message;
}

check(
  defaultError.indexOf('小游戏') >= 0,
  `没有 wx 又没注入工厂时应当明确报错，实际：${defaultError || '(没有报错)'}`,
);
notes.push('默认画布工厂在缺少 wx 时明确报错，不静默兜底');

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

console.log('');
console.log('检查项');
for (const note of notes) console.log('  · ' + note);
console.log('');
if (failures.length === 0) {
  console.log('3D 预览无头验证：全部通过');
} else {
  console.log(`3D 预览无头验证：${failures.length} 项失败`);
  for (const failure of failures) console.log('  ✗ ' + failure);
  process.exit(1);
}
