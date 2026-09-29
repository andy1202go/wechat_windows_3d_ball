/**
 * 台面的声明式数据 —— 整个项目的单一真值来源。
 *
 * 坐标系是**逻辑平面**（见 CONTEXT.md）：x 向右，y 朝向玩家（y 越大越靠近屏幕下方）。
 * 逻辑平面与世界空间的关系只有一处映射：世界 (x, 高度, y) ← 平面 (x, y)。
 * 物理、几何、贴图三方都只读这份数据，因此不可能出现
 * 「看着撞到了却没反应」这类不一致（docs/adr/0002）。
 *
 * 坐标数值是**第一版**，M3 阶段会对着原版截图逐个校准。结构已成定局，数值会调。
 */

/** 逻辑平面上的一个点 */
export interface PlanePoint {
  x: number;
  y: number;
}

/** 逻辑平面上的线段 —— M2 的碰撞体就是这些 */
export interface Segment {
  from: PlanePoint;
  to: PlanePoint;
}

export type FlipperSide = 'left' | 'right';

export interface FlipperSpec {
  side: FlipperSide;
  /** 旋转轴心 */
  pivot: PlanePoint;
  /** 挡板长度（轴心到板尖） */
  length: number;
  /** 挡板半厚 */
  radius: number;
  /**
   * 角度单位为度，在逻辑平面内自 +x 轴起算、朝 +y 方向为正。
   * 因为 +y 朝向玩家（屏幕上为「下」），所以正角等于视觉上的顺时针。
   */
  restAngle: number;
  activeAngle: number;
}

export interface RoundComponentSpec {
  x: number;
  y: number;
  radius: number;
}

export interface RectComponentSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  /** 同 FlipperSpec 的角度约定 */
  angle: number;
}

export const TABLE = {
  /** 逻辑平面总宽 */
  width: 100,
  /** 逻辑平面总长。原版台面宽高比约 1:1.7，竖屏正好适配 */
  length: 172,

  /** 底板厚度（世界单位） */
  bodyDepth: 3,
  /** 围边高度，必须大于球直径，否则球会从上方越出 */
  wallHeight: 5,
  /** 围边厚度 */
  wallThickness: 1.6,

  /** 球半径 */
  ballRadius: 2.3,
  /** 球在逻辑平面上的初始位置（摆在台面上静态展示，M2 才接管物理） */
  ballStart: { x: -6, y: 120 } as PlanePoint,

  /**
   * 外轮廓，逆时针（首点在远端左上，沿远端向右，再沿右侧下行）。
   * 远端（拱顶）较窄、玩家端最宽，配合斜俯视相机形成原版的上窄下宽梯形。
   */
  outline: [
    { x: -38, y: 0 },
    { x: 38, y: 0 },
    { x: 50, y: 150 },
    { x: 50, y: 163 },
    { x: 28, y: 172 },
    { x: -28, y: 172 },
    { x: -50, y: 163 },
    { x: -50, y: 150 },
  ] as PlanePoint[],

  /** 缓冲器：球撞上即被弹开并得分 */
  bumpers: [
    { x: -22, y: 46, radius: 7 },
    { x: 0, y: 38, radius: 7 },
    { x: 22, y: 46, radius: 7 },
  ] as RoundComponentSpec[],

  /** 击倒目标：击中后倒下、稍后复位 */
  dropTargets: [
    { x: -34, y: 58, width: 13, height: 3.6, angle: 0 },
    { x: -34, y: 65, width: 13, height: 3.6, angle: 0 },
    { x: -34, y: 72, width: 13, height: 3.6, angle: 0 },
  ] as RectComponentSpec[],

  /** 使命目标：MVP 只负责亮灯，不驱动流程 */
  missionTargets: [
    { x: -8, y: 96, width: 11, height: 6, angle: 0 },
    { x: 5, y: 96, width: 11, height: 6, angle: 0 },
    { x: 18, y: 96, width: 11, height: 6, angle: 0 },
  ] as RectComponentSpec[],

  /** 反弹器：位于挡板上方，把球弹回台面中部，避免球直接落进外侧航道 */
  rebounds: [
    { x: -36, y: 138, radius: 2.6 },
    { x: 36, y: 138, radius: 2.6 },
  ] as RoundComponentSpec[],

  flippers: [
    { side: 'left', pivot: { x: -28, y: 156 }, length: 24, radius: 3.2, restAngle: 26, activeAngle: -30 },
    { side: 'right', pivot: { x: 28, y: 156 }, length: 24, radius: 3.2, restAngle: 154, activeAngle: 210 },
  ] as FlipperSpec[],

  /**
   * 发射航道：右侧一条竖直窄道，球由发射器送出后沿它上行，从顶端进入台面。
   * innerWall 是它与主台面之间的隔墙中心线。
   */
  launchLane: {
    innerWallX: 39,
    yFrom: 150,
    yTo: 8,
  },

  /** 发射器胶垫，位于发射航道底部 */
  plunger: { x: 44.5, y: 150, width: 9, height: 6, angle: 0 } as RectComponentSpec,
} as const;

/** 取出外轮廓的所有边，作为台面围边的碰撞线段 */
export function outlineSegments(): Segment[] {
  const pts = TABLE.outline;
  const segments: Segment[] = [];
  for (let i = 0; i < pts.length; i++) {
    segments.push({ from: pts[i], to: pts[(i + 1) % pts.length] });
  }
  return segments;
}

/**
 * 外轮廓中**不**立围边的边（下标同 outlineSegments 的顺序）。
 * 下标 4 是底部中央那条边（28,172)→(-28,172)：原版这里是敞开的坠毁口，
 * 两侧由挡板与弹球器围住，中央直接漏球。M2 的坠毁判定就落在这个开口上。
 */
export const OUTLINE_OPEN_EDGES = [4];

/**
 * 一条围边。带 id 与 role 是为了让两个消费者都能用它：
 * 几何构建按 from→to 生成可见的围边，物理构建按同一份数据生成碰撞体，
 * 碰撞事件与调试图用 id 指认是哪一条被撞了。
 */
export interface WallSpec extends Segment {
  /** 稳定标识，碰撞事件与调试图都用它 */
  id: string;
  /** 作用域：外轮廓围边 / 发射航道隔墙 */
  role: 'outline' | 'lane';
}

/**
 * 围边全集（唯一真值来源）：外轮廓围边（已去掉坠毁开口） + 发射航道隔墙。
 *
 * 「哪条边不立墙」只在这里判断一次。几何与物理都消费这个函数的返回值，
 * 所以不可能出现「看着撞到了却没反应」（docs/adr/0002）。
 */
export function wallSpecs(): WallSpec[] {
  const specs: WallSpec[] = [];

  outlineSegments().forEach((segment, index) => {
    if (OUTLINE_OPEN_EDGES.indexOf(index) >= 0) return;
    specs.push({
      id: `wall:outline:${index}`,
      role: 'outline',
      from: segment.from,
      to: segment.to,
    });
  });

  specs.push({
    id: 'wall:lane-inner',
    role: 'lane',
    from: { x: TABLE.launchLane.innerWallX, y: TABLE.launchLane.yFrom },
    to: { x: TABLE.launchLane.innerWallX, y: TABLE.launchLane.yTo },
  });

  return specs;
}

/** 围边线段集合，供只需要几何位置的调用方使用 */
export function wallSegments(): Segment[] {
  return wallSpecs().map((spec) => ({ from: spec.from, to: spec.to }));
}

/** 逻辑平面 → 世界空间。唯一一处坐标映射，物理与渲染都走它。 */
export function planeToWorld(x: number, y: number, height = 0): { x: number; y: number; z: number } {
  return { x, y: height, z: y };
}

/** 逻辑平面的包围盒，供相机适配使用 */
export function planeBounds(): { minX: number; maxX: number; minY: number; maxY: number } {
  return { minX: -TABLE.width / 2, maxX: TABLE.width / 2, minY: 0, maxY: TABLE.length };
}

/**
 * 相机适配用的世界坐标点集：外轮廓在台面高度与围边顶部的全部角点。
 *
 * 取两圈高度而不是只取台面那一圈，是为了让围边也完整落进视口——
 * 围边比台面高，斜俯视下它在近端会投影到台面轮廓之外。
 *
 * 刻意返回纯数据而不是 THREE.Vector3，让这个模块不依赖 three。
 */
export function fitPoints(): { x: number; y: number; z: number }[] {
  const points: { x: number; y: number; z: number }[] = [];
  for (const corner of TABLE.outline) {
    points.push(planeToWorld(corner.x, corner.y, 0));
    points.push(planeToWorld(corner.x, corner.y, TABLE.wallHeight));
  }
  return points;
}
