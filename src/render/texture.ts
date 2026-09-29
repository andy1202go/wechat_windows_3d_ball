/**
 * 程序化画布与贴图（docs/adr/0005：台面美术全部由代码生成，项目里不放素材文件）。
 *
 * 两个必须注意的点：
 * 1. 小游戏里第一次 wx.createCanvas() 已经由 polyfill 用作屏幕 canvas 了，
 *    这里后续的调用拿到的是离屏 canvas。
 * 2. 贴图统一 flipY = false，让 canvas 的 y=0 对应逻辑平面的 y=0（拱顶在一侧）。
 *    three 默认 flipY = true 会让整张台面上下颠倒。
 */

export function createCanvas2D(width: number, height: number): any {
  // 基础库 2.16.1 起小游戏提供 wx.createOffscreenCanvas。不同微信版本的参数与
  // 返回结构有过调整，所以这里必须 try/catch 兜底到 wx.createCanvas()。
  // 若在真机上发现返回对象没有 getContext('2d')，就是这个接口的版本差异。
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
