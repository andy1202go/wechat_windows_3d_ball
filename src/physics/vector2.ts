/**
 * 二维向量。纯数学，零依赖。
 *
 * 为什么物理层必须零依赖（docs/adr/0003）：
 * 一旦 import 了 three 或任何小游戏 API，它就无法脱离渲染独立运行，
 * 也就不可能有一个「不依赖渲染的可视化调试图」，更没法在 Node 里跑断言。
 * 这个文件里连 `console` 都不该出现。
 *
 * 接口风格：所有运算都**原地写入 out 参数**，不返回新对象。
 * 物理每步要跑几百次向量运算，按 120Hz 乘以子步进之后分配量会非常可观，
 * 而移动端的 GC 停顿会直接表现为掉帧。
 */

export interface Vec2 {
  x: number;
  y: number;
}

export function createVec2(x = 0, y = 0): Vec2 {
  return { x, y };
}

export function setVec2(out: Vec2, x: number, y: number): Vec2 {
  out.x = x;
  out.y = y;
  return out;
}

export function copyVec2(out: Vec2, a: Vec2): Vec2 {
  out.x = a.x;
  out.y = a.y;
  return out;
}

export function addVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x + b.x;
  out.y = a.y + b.y;
  return out;
}

export function subVec2(out: Vec2, a: Vec2, b: Vec2): Vec2 {
  out.x = a.x - b.x;
  out.y = a.y - b.y;
  return out;
}

export function scaleVec2(out: Vec2, a: Vec2, scalar: number): Vec2 {
  out.x = a.x * scalar;
  out.y = a.y * scalar;
  return out;
}

/** out = a + b * scalar，累加型运算里最常用的一条 */
export function addScaledVec2(out: Vec2, a: Vec2, b: Vec2, scalar: number): Vec2 {
  out.x = a.x + b.x * scalar;
  out.y = a.y + b.y * scalar;
  return out;
}

export function dotVec2(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** 二维叉积的 z 分量。用来判断点在线的哪一侧、以及算旋转方向。 */
export function crossVec2(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function lengthSqVec2(a: Vec2): number {
  return a.x * a.x + a.y * a.y;
}

export function lengthVec2(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function distanceSqVec2(a: Vec2, b: Vec2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

export function distanceVec2(a: Vec2, b: Vec2): number {
  return Math.sqrt(distanceSqVec2(a, b));
}

/**
 * 归一化，返回**归一化之前**的长度。
 * 长度为 0 时把 out 置零并返回 0 —— 调用方几乎总要判断这一点，
 * 返回长度比返回 NaN 更有用。
 */
export function normalizeVec2(out: Vec2, a: Vec2): number {
  const len = lengthVec2(a);
  if (len < 1e-12) {
    out.x = 0;
    out.y = 0;
    return 0;
  }
  out.x = a.x / len;
  out.y = a.y / len;
  return len;
}

/** 把向量长度夹到 max 以内，方向不变 */
export function clampLengthVec2(out: Vec2, a: Vec2, max: number): Vec2 {
  const len = lengthVec2(a);
  if (len <= max || len < 1e-12) return copyVec2(out, a);
  const k = max / len;
  out.x = a.x * k;
  out.y = a.y * k;
  return out;
}

/** 左法线：把向量逆时针转 90°。2D 里算「ω × r」就靠它。 */
export function perpVec2(out: Vec2, a: Vec2): Vec2 {
  out.x = -a.y;
  out.y = a.x;
  return out;
}

export function rotateVec2(out: Vec2, a: Vec2, radians: number): Vec2 {
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  out.x = a.x * cos - a.y * sin;
  out.y = a.x * sin + a.y * cos;
  return out;
}

/** 由角度与长度构造向量。角度自 +x 轴起算、朝 +y 方向为正。 */
export function fromAngleVec2(out: Vec2, radians: number, len = 1): Vec2 {
  out.x = Math.cos(radians) * len;
  out.y = Math.sin(radians) * len;
  return out;
}

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;
