/**
 * 程序化画布与贴图（docs/adr/0005：台面美术全部由代码生成，项目里不放素材文件）。
 *
 * 三个必须注意的点：
 * 1. **画布来源是可注入的**，这里不直接调 wx.*。同一份渲染代码还要在浏览器里跑
 *    （docs/adr/0010 的 3D 预览），写死小游戏 API 就没法复用。小游戏侧走默认实现，
 *    浏览器侧注入 document 实现。
 * 2. 小游戏里第一次 wx.createCanvas() 已经由 polyfill 用作屏幕 canvas 了，
 *    这里后续的调用拿到的是离屏 canvas。
 * 3. 贴图统一 flipY = false，让 canvas 的 y=0 对应逻辑平面的 y=0（拱顶在一侧）。
 *    three 默认 flipY = true 会让整张台面上下颠倒。
 */

/**
 * 画布工厂：能拿到 2d 上下文即可。
 *
 * 返回 any 而非具体类型 —— 同一个对象还要交给 three 的 CanvasTexture，
 * 而它对小游戏画布与 HTMLCanvasElement 的类型定义无法统一。
 */
export type CanvasFactory = (width: number, height: number) => any;

let injectedFactory: CanvasFactory | null = null;

/**
 * 浏览器预览（或测试替身）用：把画布来源换成当前环境自己的。
 * 传 null 则恢复成小游戏默认实现。
 */
export function setCanvasFactory(factory: CanvasFactory | null): void {
  injectedFactory = factory;
}

/**
 * 小游戏默认实现。
 *
 * 基础库 2.16.1 起提供 wx.createOffscreenCanvas，但不同微信版本的参数与返回结构
 * 有过调整，所以必须 try/catch 兜底回 wx.createCanvas()。若真机上发现返回对象没有
 * getContext('2d')，就是这个接口的版本差异。
 *
 * 注意先判 `typeof wx`：这段代码也会被浏览器构建打包进去，直接写 wx.xxx 会在浏览器里
 * 抛 ReferenceError（typeof 对未声明的标识符是安全的，属性访问不是）。
 */
function wxCanvasFactory(width: number, height: number): any {
  if (typeof wx === 'undefined') {
    throw new Error('当前环境没有小游戏 API，也没有注入画布工厂（应调用 setCanvasFactory）');
  }
  if (typeof wx.createOffscreenCanvas === 'function') {
    try {
      const canvas = wx.createOffscreenCanvas({ type: '2d', width, height });
      if (canvas && typeof canvas.getContext === 'function' && canvas.getContext('2d')) {
        return canvas;
      }
    } catch (err) {
      // 落到兜底
    }
  }
  const canvas = wx.createCanvas();
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function createCanvas2D(width: number, height: number): any {
  return (injectedFactory ?? wxCanvasFactory)(width, height);
}

export function get2DContext(canvas: any): any {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('无法获取 2d 上下文，见 createCanvas2D 的版本说明');
  return ctx;
}

export interface TextureBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 台面顶面贴图。
 *
 * 贴图长宽比与台面一致，UV 用平面映射（见 geometry.ts 的 applyPlanarUV），
 * 所以 canvas 上的一个像素与逻辑平面上的一块面积是线性对应的，
 * 画装饰线时可以按逻辑坐标直接换算。
 */
export function drawPlayfieldTexture(
  ctx: any,
  texW: number,
  texH: number,
  bounds: TextureBounds,
  data: { outline: { x: number; y: number }[]; launchLaneX: number },
): void {
  const toTexX = (x: number) => ((x - bounds.minX) / (bounds.maxX - bounds.minX)) * texW;
  const toTexY = (y: number) => ((y - bounds.minY) / (bounds.maxY - bounds.minY)) * texH;

  // 底色：原版台面是深色金属质感
  const base = ctx.createLinearGradient(0, 0, texW, texH);
  base.addColorStop(0, '#101a2e');
  base.addColorStop(0.5, '#16233c');
  base.addColorStop(1, '#0b1220');
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, texW, texH);

  // 台面中轴线上的环状灯带，呼应原版中央的进度灯环
  const cx = toTexX(0);
  const cy = toTexY(120);
  ctx.strokeStyle = 'rgba(90,140,220,0.16)';
  ctx.lineWidth = Math.max(1, texW * 0.006);
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(cx, cy, texW * (0.13 + i * 0.085), 0, Math.PI * 2);
    ctx.stroke();
  }

  // 发射航道隔墙的槽位
  ctx.strokeStyle = 'rgba(120,170,255,0.25)';
  ctx.lineWidth = Math.max(1, texW * 0.012);
  ctx.beginPath();
  ctx.moveTo(toTexX(data.launchLaneX), toTexY(8));
  ctx.lineTo(toTexX(data.launchLaneX), toTexY(150));
  ctx.stroke();

  // 台面外轮廓内描边
  ctx.beginPath();
  data.outline.forEach((p, i) => {
    const x = toTexX(p.x);
    const y = toTexY(p.y);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.strokeStyle = 'rgba(140,190,255,0.45)';
  ctx.lineWidth = Math.max(1.5, texW * 0.01);
  ctx.stroke();

  // 顶部的拱形提示线（原版远端的弧度）
  ctx.beginPath();
  ctx.moveTo(toTexX(-38), toTexY(0));
  ctx.lineTo(toTexX(38), toTexY(0));
  ctx.strokeStyle = 'rgba(255,180,90,0.35)';
  ctx.lineWidth = Math.max(1.5, texW * 0.014);
  ctx.stroke();
}
