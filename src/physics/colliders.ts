/**
 * 静态碰撞体：线段、圆、旋转线段（挡板）。
 *
 * 只做形状与几何查询，不含积分与求解 —— 求解在 world.ts。
 * 三类形状对应原版台面上的全部东西：
 *   线段  → 围边、导轨、航道隔墙
 *   圆    → 缓冲器、反弹器
 *   旋转线段（胶囊）→ 挡板
 *
 * 同样零依赖，不 import three、不碰小游戏 API（docs/adr/0003）。
 */

import {
  DEG_TO_RAD,
  addScaledVec2,
  createVec2,
  fromAngleVec2,
  type Vec2,
} from './vector2';

/** 轴对齐包围盒。宽相位剔除用，避免每个子步都做全量精确测试。 */
export interface AABB {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 碰撞体的角色。供计分逻辑与调试图着色区分，物理本身不解释它。 */
export type ColliderRole = 'wall' | 'bumper' | 'rebound' | 'flipper';

interface ColliderBase {
  /** 稳定标识，碰撞事件与调试图都用它 */
  id: string;
  role: ColliderRole;
  /**
   * 法线方向。线段是**双面**的，这个值只是兜底参考方向；
   * 真正的碰撞法线按球在哪一侧现算。见 SegmentCollider 的注释。
   */
  normal: Vec2;
  /** 弹性系数，0 = 完全不弹，1 = 无能量损失 */
  restitution: number;
  friction: number;
  /** 预计算的包围盒，不含球半径 —— 测试时再按半径外扩 */
  aabb: AABB;
}

/**
 * 线段碰撞体（围边、航道隔墙）。
 *
 * **双面**是刻意的，不是偷懒。发射航道隔墙是一条零厚度线，球在它左右两侧
 * 都可能存在（航道内与主台面内）。如果做成单面，法线方向按「台面内侧」定死，
 * 球在航道那一侧碰撞时就会被推向错误方向，直接穿墙。
 *
 * 所以：碰撞法线按「球心在线段的哪一侧」现算，两侧都当实体。
 * 代价是理论上球如果能跑到台面外，会被往外推 —— 但球跑不出去。
 */
export interface SegmentCollider extends ColliderBase {
  kind: 'segment';
  from: Vec2;
  to: Vec2;
  /** 线段长度平方，最近点查询里复用，避免每子步重算 */
  lengthSq: number;
}

/** 圆形碰撞体（缓冲器、反弹器） */
export interface CircleCollider extends ColliderBase {
  kind: 'circle';
  center: Vec2;
  radius: number;
  /**
   * 命中时沿法线额外施加的速度增量。缓冲器的「打击感」全在这里：
   * 只靠弹性系数的话球会越弹越软，原版是把球主动踹出去的。
   */
  kick: number;
  /** 剩余冷却秒数，>0 时不重复发力，避免同一帧连击刷分 */
  cooldown: number;
  /** 冷却时长（秒），命中后重置 */
  cooldownDuration: number;
}

/**
 * 挡板碰撞体 = 一条绕轴心旋转的**胶囊**（芯线 from pivot 到 tip，半径 radius）。
 *
 * 虽然形状是线段，但它和 SegmentCollider 的求解方式完全不同：
 * 线段是静止的，挡板在动，接触点处有 ω × r 的表面速度。
 * 球的最终速度取决于「相对挡板的相对速度」而不是绝对速度 ——
 * 这正是「挡板能把手感做出来」的物理来源。所以它必须是独立类型。
 */
export interface FlipperCollider extends ColliderBase {
  kind: 'flipper';
  side: 'left' | 'right';
  pivot: Vec2;
  length: number;
  /** 胶囊半径（板半厚） */
  radius: number;
  /** 静止角（度），角度约定同 table/data.ts */
  restAngle: number;
  /** 触发角（度） */
  activeAngle: number;
  /** 当前角（度） */
  angle: number;
  /** 当前角速度（度/秒，带符号）。求解接触点表面速度时用。 */
  angularVelocity: number;
  pressed: boolean;
  /** 芯线方向与端点，随角度更新；每次更新后缓存，避免求解时重复三角函数 */
  dir: Vec2;
  tip: Vec2;
}

export type StaticCollider = SegmentCollider | CircleCollider | FlipperCollider;

function makeAabb(): AABB {
  return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

/**
 * 一条线段的法线方向。
 *
 * `inwardFrom` 传入台面中心：函数保证返回的法线指向台面内侧。
 * 这样围边就不必在数据里手写绕向 —— 外轮廓是逆时针还是顺时针排的，
 * 数据那边可以随便改，法线永远朝里。
 */
function segmentNormal(from: Vec2, to: Vec2, inwardFrom: Vec2): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  // 左法线
  let nx = -dy;
  let ny = dx;
  const len = Math.hypot(nx, ny);
  if (len > 1e-12) {
    nx /= len;
    ny /= len;
  }
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  // 若法线背向台面中心则翻转
  if (nx * (inwardFrom.x - midX) + ny * (inwardFrom.y - midY) < 0) {
    nx = -nx;
    ny = -ny;
  }
  return createVec2(nx, ny);
}

export function makeSegment(
  id: string,
  from: Vec2,
  to: Vec2,
  inwardFrom: Vec2,
  restitution: number,
  friction: number,
): SegmentCollider {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return {
    kind: 'segment',
    id,
    role: 'wall',
    from: createVec2(from.x, from.y),
    to: createVec2(to.x, to.y),
    lengthSq: dx * dx + dy * dy,
    normal: segmentNormal(from, to, inwardFrom),
    restitution,
    friction,
    aabb: {
      minX: Math.min(from.x, to.x),
      minY: Math.min(from.y, to.y),
      maxX: Math.max(from.x, to.x),
      maxY: Math.max(from.y, to.y),
    },
  };
}

export function makeCircle(
  id: string,
  role: ColliderRole,
  center: Vec2,
  radius: number,
  restitution: number,
  friction: number,
  kick = 0,
  cooldownDuration = 0,
): CircleCollider {
  return {
    kind: 'circle',
    id,
    role,
    center: createVec2(center.x, center.y),
    radius,
    normal: createVec2(0, -1),
    restitution,
    friction,
    kick,
    cooldown: 0,
    cooldownDuration,
    aabb: {
      minX: center.x - radius,
      minY: center.y - radius,
      maxX: center.x + radius,
      maxY: center.y + radius,
    },
  };
}

export function makeFlipper(
  id: string,
  side: 'left' | 'right',
  pivot: Vec2,
  length: number,
  radius: number,
  restAngle: number,
  activeAngle: number,
  restitution: number,
  friction: number,
): FlipperCollider {
  const flipper: FlipperCollider = {
    kind: 'flipper',
    id,
    role: 'flipper',
    side,
    pivot: createVec2(pivot.x, pivot.y),
    length,
    radius,
    restAngle,
    activeAngle,
    angle: restAngle,
    angularVelocity: 0,
    pressed: false,
    dir: createVec2(0, 0),
    tip: createVec2(0, 0),
    normal: createVec2(0, -1),
    restitution,
    friction,
    aabb: makeAabb(),
  };
  refreshFlipperGeometry(flipper);
  return flipper;
}

/** 按当前角度重算芯线方向、端点与包围盒 */
export function refreshFlipperGeometry(flipper: FlipperCollider): void {
  fromAngleVec2(flipper.dir, flipper.angle * DEG_TO_RAD);
  addScaledVec2(flipper.tip, flipper.pivot, flipper.dir, flipper.length);

  // 胶囊的包围盒 = 芯线包围盒外扩半径，再考虑球心会从任一侧接近
  flipper.aabb.minX = Math.min(flipper.pivot.x, flipper.tip.x) - flipper.radius;
  flipper.aabb.minY = Math.min(flipper.pivot.y, flipper.tip.y) - flipper.radius;
  flipper.aabb.maxX = Math.max(flipper.pivot.x, flipper.tip.x) + flipper.radius;
  flipper.aabb.maxY = Math.max(flipper.pivot.y, flipper.tip.y) + flipper.radius;
}

/**
 * 推进挡板角度。
 *
 * 返回本步实际转过的角度（度，带符号）。世界用它除以 dt 得到角速度 ——
 * 注意角速度取的是**实际转过的量**而不是设定值：挡板撞到行程终点时会停下，
 * 如果还按设定速度算表面速度，球会在挡板停止后被凭空推一把。
 */
export function advanceFlipper(
  flipper: FlipperCollider,
  dt: number,
  angularSpeedDeg: number,
): number {
  const target = flipper.pressed ? flipper.activeAngle : flipper.restAngle;
  const delta = target - flipper.angle;
  const maxStep = angularSpeedDeg * dt;

  let applied: number;
  if (Math.abs(delta) <= maxStep) {
    applied = delta;
    flipper.angle = target;
  } else {
    applied = delta > 0 ? maxStep : -maxStep;
    flipper.angle += applied;
  }

  refreshFlipperGeometry(flipper);
  return applied;
}

/**
 * 线段上离 point 最近的点。
 * lengthSq 由调用方传入 —— 围边是静态的，没必要每个子步都重算一遍。
 */
export function closestPointOnSegment(
  out: Vec2,
  from: Vec2,
  to: Vec2,
  lengthSq: number,
  point: Vec2,
): Vec2 {
  if (lengthSq < 1e-12) {
    out.x = from.x;
    out.y = from.y;
    return out;
  }
  const t =
    ((point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y)) / lengthSq;
  const clamped = t < 0 ? 0 : t > 1 ? 1 : t;
  out.x = from.x + (to.x - from.x) * clamped;
  out.y = from.y + (to.y - from.y) * clamped;
  return out;
}

/** 点到碰撞体表面的距离（在体内时为 0）。子步长估算是唯一的消费者。 */
export function distanceToCollider(
  collider: StaticCollider,
  point: Vec2,
  scratch: Vec2,
): number {
  if (collider.kind === 'circle') {
    const dx = point.x - collider.center.x;
    const dy = point.y - collider.center.y;
    return Math.max(0, Math.hypot(dx, dy) - collider.radius);
  }

  if (collider.kind === 'segment') {
    closestPointOnSegment(scratch, collider.from, collider.to, collider.lengthSq, point);
    return Math.hypot(point.x - scratch.x, point.y - scratch.y);
  }

  // 挡板：到芯线的距离再减胶囊半径
  const dx = collider.tip.x - collider.pivot.x;
  const dy = collider.tip.y - collider.pivot.y;
  closestPointOnSegment(scratch, collider.pivot, collider.tip, dx * dx + dy * dy, point);
  return Math.max(0, Math.hypot(point.x - scratch.x, point.y - scratch.y) - collider.radius);
}
