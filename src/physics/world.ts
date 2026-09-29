/**
 * 物理世界：定步长积分 + 子步进 + 碰撞求解。
 *
 * 三条设计约束（docs/adr/0002、docs/adr/0003）：
 *
 * 1. **零依赖**。不 import three、不碰小游戏 API。这样它才能在 Node 里跑断言，
 *    也才可能有一个不依赖渲染的可视化调试图（tools/physics-demo.ts）。
 *
 * 2. **所有碰撞体都是无限质量**。台面上只有一个主动物体（球），围边/缓冲器/挡板
 *    都不会被撞动。因此不需要通用刚体求解器那一整套质量矩阵与迭代求解，
 *    冲量法一步到位即可 —— 这是「自研」而非「引入引擎」的正当性所在。
 *
 * 3. **子步进而不是连续碰撞检测**。球速上限 700、步长 1/120 秒时单步最大位移
 *    约 5.8 个单位，而球半径只有 2.3 —— 一步足以跨过零厚度的围边。
 *    子步进把这一步切成若干小步，保证每个子步的位移远小于球半径。
 */

import {
  type AABB,
  type CircleCollider,
  type ColliderRole,
  type FlipperCollider,
  type SegmentCollider,
  type StaticCollider,
  advanceFlipper,
  closestPointOnSegment,
  distanceToCollider,
} from './colliders';
import {
  createVec2,
  DEG_TO_RAD,
  type Vec2,
  addScaledVec2,
  clampLengthVec2,
  copyVec2,
  lengthVec2,
  setVec2,
} from './vector2';
import type { Tuning } from './tuning';

/** 球。台面上唯一的主动物体。 */
export interface BallBody {
  position: Vec2;
  /** 上一步开始时的位置。渲染按 alpha 在 prev→position 之间插值 */
  prev: Vec2;
  velocity: Vec2;
  radius: number;
  /** 1 / 质量。球的质量不影响它与静态碰撞体的碰撞结果，留给未来与动态物体交互 */
  inverseMass: number;
  /** 本步是否发生过接触 */
  touching: boolean;
}

/** 一次接触。M5 的计分逻辑消费它，物理本身不解释含义。 */
export interface CollisionEvent {
  colliderId: string;
  role: ColliderRole;
  /** 接触点（逻辑平面坐标） */
  position: Vec2;
  /** 沿法线的接近速度，正值。数值越大撞得越狠 */
  impactSpeed: number;
  /** 法向冲量大小 */
  impulse: number;
  /** 是否触发了碰撞体的主动外推（缓冲器） */
  kicked: boolean;
}

export interface WorldOptions {
  tuning: Tuning;
  /** 台面边界。球越界即视为出局，具体怎么算由上层决定 */
  bounds: AABB;
  ballRadius: number;
  ballPosition: Vec2;
  ballMass?: number;
}

export class World {
  readonly ball: BallBody;
  readonly bounds: AABB;
  readonly colliders: StaticCollider[] = [];
  /** 挡板子集，按加入顺序。触摸输入直接改它们的 pressed */
  readonly flippers: FlipperCollider[] = [];

  tuning: Tuning;

  /** 上一次 step 里球是否越出台面边界 */
  outOfBounds = false;
  /** 最近一次 step 使用了几次子步进，调试图用 */
  substepsLastStep = 1;
  /** step 累计次数 */
  stepCount = 0;

  /**
   * 事件池：每次 step 开头把 active 清空，但仍复用底层的对象。
   * 一个静止的球每个子步都会与围边接触，用「每次 new 一个事件」的写法，
   * 120Hz 下会稳定地产生垃圾。
   */
  private readonly eventPool: CollisionEvent[] = [];
  private readonly activeEvents: CollisionEvent[] = [];

  private readonly tmpNormal = createVec2();
  private readonly tmpAxis = createVec2();
  private readonly tmpScratch = createVec2();

  constructor(options: WorldOptions) {
    this.tuning = options.tuning;
    this.bounds = options.bounds;
    this.ball = {
      position: createVec2(options.ballPosition.x, options.ballPosition.y),
      prev: createVec2(options.ballPosition.x, options.ballPosition.y),
      velocity: createVec2(0, 0),
      radius: options.ballRadius,
      inverseMass: 1 / (options.ballMass && options.ballMass > 0 ? options.ballMass : 1),
      touching: false,
    };
  }

  /** 本步发生的接触。数组本身每次 step 复用，消费者要留副本请自行拷贝。 */
  get events(): readonly CollisionEvent[] {
    return this.activeEvents;
  }

  add(collider: StaticCollider): void {
    this.colliders.push(collider);
    if (collider.kind === 'flipper') this.flippers.push(collider);
  }

  setFlipperPressed(side: 'left' | 'right', pressed: boolean): void {
    for (const flipper of this.flippers) {
      if (flipper.side === side) flipper.pressed = pressed;
    }
  }

  /** 把球放到指定位置并清零速度，同时把插值起点对齐（否则会从旧位置拖一条线过来） */
  resetBall(position: Vec2, velocity?: Vec2): void {
    setVec2(this.ball.position, position.x, position.y);
    copyVec2(this.ball.prev, this.ball.position);
    setVec2(this.ball.velocity, velocity ? velocity.x : 0, velocity ? velocity.y : 0);
    this.outOfBounds = false;
  }

  /** 按 alpha 取球当前应绘制的位置，写入 out */
  interpolateBall(out: Vec2, alpha: number): Vec2 {
    const ball = this.ball;
    out.x = ball.prev.x + (ball.position.x - ball.prev.x) * alpha;
    out.y = ball.prev.y + (ball.position.y - ball.prev.y) * alpha;
    return out;
  }

  step(dt: number): void {
    const tuning = this.tuning;
    const ball = this.ball;

    this.activeEvents.length = 0;
    this.stepCount++;

    // 插值起点：整步开始前的位置
    copyVec2(ball.prev, ball.position);

    // 挡板先动、球后撞。反过来球会用上一帧的挡板位姿求解，手感上会「慢半拍」。
    for (const flipper of this.flippers) {
      const applied = advanceFlipper(flipper, dt, tuning.flipperAngularSpeed);
      flipper.angularVelocity = dt > 0 ? applied / dt : 0;
    }

    for (const collider of this.colliders) {
      if (collider.kind === 'circle' && collider.cooldown > 0) {
        collider.cooldown = Math.max(0, collider.cooldown - dt);
      }
    }

    // 半隐式欧拉：先更新速度，再拿新速度积分位置。比显式欧拉稳定得多，
    // 而且这一步的代价是免费的能量耗散，正好抵消数值积分的能量注入。
    ball.velocity.y += tuning.gravityY * dt;
    if (tuning.linearDamping > 0) {
      const keep = Math.max(0, 1 - tuning.linearDamping * dt);
      ball.velocity.x *= keep;
      ball.velocity.y *= keep;
    }
    clampLengthVec2(ball.velocity, ball.velocity, tuning.maxBallSpeed);

    const travel = lengthVec2(ball.velocity) * dt;
    const substeps = this.substepCount(travel);
    this.substepsLastStep = substeps;
    const subDt = dt / substeps;

    ball.touching = false;
    for (let i = 0; i < substeps; i++) {
      addScaledVec2(ball.position, ball.position, ball.velocity, subDt);
      this.resolveCollisions();
    }

    // 缓冲器的主动外推可能把速度推过上限，这里再夹一次
    clampLengthVec2(ball.velocity, ball.velocity, tuning.maxBallSpeed);

    const radius = ball.radius;
    this.outOfBounds =
      ball.position.y > this.bounds.maxY + radius ||
      ball.position.y < this.bounds.minY - radius ||
      ball.position.x < this.bounds.minX - radius ||
      ball.position.x > this.bounds.maxX + radius;
  }

  // -------------------------------------------------------------------------
  // 子步进
  // -------------------------------------------------------------------------

  /**
   * 本步要切几次。
   *
   * 主判据是「单步位移不超过球半径的 substepTravelRatio 倍」：
   * 球与零厚度围边的接触区是以围边为中心、厚度 2×球半径 的带，
   * 只要相邻两次测试点的间距小于这个厚度，就一定会有一次落在带内被抓到。
   *
   * 靠近碰撞体时再按「到它的距离的 0.4 倍」额外切细 —— 高速球在最后一段
   * 最危险，把细分预算花在这里最划算。
   */
  private substepCount(travel: number): number {
    const tuning = this.tuning;
    const radiusLimit = this.ball.radius * tuning.substepTravelRatio;
    if (travel <= radiusLimit) return 1;

    const nearest = this.nearestColliderDistance();
    const limit = nearest > 0 ? Math.min(radiusLimit, nearest * 0.4) : radiusLimit;
    if (limit <= 1e-9) return tuning.maxSubsteps;

    const count = Math.ceil(travel / limit);
    if (count < 1) return 1;
    return count > tuning.maxSubsteps ? tuning.maxSubsteps : count;
  }

  private nearestColliderDistance(): number {
    let nearest = Number.POSITIVE_INFINITY;
    for (const collider of this.colliders) {
      const distance = distanceToCollider(collider, this.ball.position, this.tmpScratch);
      if (distance < nearest) nearest = distance;
    }
    return Number.isFinite(nearest) ? nearest : 1e6;
  }

  // -------------------------------------------------------------------------
  // 碰撞
  // -------------------------------------------------------------------------

  private resolveCollisions(): void {
    const ball = this.ball;
    const radius = ball.radius;

    for (const collider of this.colliders) {
      const aabb = collider.aabb;
      // 宽相位：球心 ± 半径 与包围盒不相交就直接跳过
      if (ball.position.x + radius < aabb.minX || ball.position.x - radius > aabb.maxX) continue;
      if (ball.position.y + radius < aabb.minY || ball.position.y - radius > aabb.maxY) continue;

      if (collider.kind === 'segment') this.resolveSegment(collider);
      else if (collider.kind === 'circle') this.resolveCircle(collider);
      else this.resolveFlipper(collider);
    }
  }

  private resolveSegment(collider: SegmentCollider): void {
    closestPointOnSegment(
      this.tmpAxis,
      collider.from,
      collider.to,
      collider.lengthSq,
      this.ball.position,
    );
    this.solveContact(collider, this.tmpAxis, 0, 0, 0, collider.restitution, collider.friction, 0);
  }

  private resolveCircle(collider: CircleCollider): void {
    setVec2(this.tmpAxis, collider.center.x, collider.center.y);
    this.solveContact(
      collider,
      this.tmpAxis,
      collider.radius,
      0,
      0,
      collider.restitution,
      collider.friction,
      collider.kick,
    );
  }

  private resolveFlipper(collider: FlipperCollider): void {
    const dx = collider.tip.x - collider.pivot.x;
    const dy = collider.tip.y - collider.pivot.y;
    closestPointOnSegment(
      this.tmpAxis,
      collider.pivot,
      collider.tip,
      dx * dx + dy * dy,
      this.ball.position,
    );

    // 接触点处的挡板表面速度 = ω × r。
    // 角速度取**实际转过的角度**除以 dt（见 colliders.advanceFlipper）：
    // 挡板到达行程终点就停下，若还按设定速度算，球会在挡板停止后被凭空推一把。
    const omega = collider.angularVelocity * DEG_TO_RAD;
    const rx = this.tmpAxis.x - collider.pivot.x;
    const ry = this.tmpAxis.y - collider.pivot.y;
    const surfaceVx = -ry * omega;
    const surfaceVy = rx * omega;

    this.solveContact(
      collider,
      this.tmpAxis,
      collider.radius,
      surfaceVx,
      surfaceVy,
      collider.restitution,
      collider.friction,
      0,
    );
  }

  /**
   * 一个形状与球的接触求解。
   *
   * axisPoint + shapeRadius 统一描述三类碰撞体：
   *   线段 → 最近点 + 0        圆 → 圆心 + 半径        挡板 → 芯线最近点 + 胶囊半厚
   * 于是「判定」「位置修正」「冲量」三件事只需要写一遍。
   *
   * surfaceVx/surfaceVy 是该形状在接触点处的速度。静态碰撞体传 0；
   * 挡板传 ω × r。球受到的冲量取决于**相对**运动表面的相对速度 ——
   * 这就是挡板能把手感做出来的物理来源。
   */
  private solveContact(
    collider: StaticCollider,
    axisPoint: Vec2,
    shapeRadius: number,
    surfaceVx: number,
    surfaceVy: number,
    restitution: number,
    friction: number,
    kick: number,
  ): void {
    const ball = this.ball;
    const normal = this.tmpNormal;

    let dx = ball.position.x - axisPoint.x;
    let dy = ball.position.y - axisPoint.y;
    let distance = Math.hypot(dx, dy);
    const contactDistance = ball.radius + shapeRadius;
    if (distance > contactDistance) return;

    if (distance < 1e-9) {
      // 球心与形状轴线重合，分离方向无从计算：借碰撞体的参考法线兜底。
      // 正常游戏里到不了这里，但数值异常时它比 NaN 好得多。
      dx = collider.normal.x;
      dy = collider.normal.y;
      distance = 0;
    } else {
      dx /= distance;
      dy /= distance;
    }
    normal.x = dx;
    normal.y = dy;

    // 位置修正：直接把球推出重叠区。
    // 不做迭代求解是因为对手方全是无限质量，修正一次就到位。
    const penetration = contactDistance - distance;
    ball.position.x += normal.x * penetration;
    ball.position.y += normal.y * penetration;

    // 相对运动表面的相对速度
    const relVx = ball.velocity.x - surfaceVx;
    const relVy = ball.velocity.y - surfaceVy;
    const normalSpeed = relVx * normal.x + relVy * normal.y;
    ball.touching = true;

    // 正在分离就不施加冲量（否则球会被吸住）
    if (normalSpeed >= 0) return;

    let e = restitution;
    // 低速接触按完全非弹性处理：球停在挡板上时每个子步都会被重力压入接触，
    // 照常回弹会持续微跳。threshold 为 0 表示不启用这条（无损测试靠它）。
    if (this.tuning.restitutionThreshold > 0 && -normalSpeed < this.tuning.restitutionThreshold) {
      e = 0;
    }

    const impulse = -(1 + e) * normalSpeed;
    ball.velocity.x += normal.x * impulse;
    ball.velocity.y += normal.y * impulse;

    // 库仑摩擦：切向冲量不超过 μ × 法向冲量
    const tangentX = relVx - normal.x * normalSpeed;
    const tangentY = relVy - normal.y * normalSpeed;
    const tangentLength = Math.hypot(tangentX, tangentY);
    if (tangentLength > 1e-6 && friction > 0) {
      const frictionImpulse = Math.min(tangentLength, friction * impulse);
      ball.velocity.x -= (tangentX / tangentLength) * frictionImpulse;
      ball.velocity.y -= (tangentY / tangentLength) * frictionImpulse;
    }

    let kicked = false;
    if (kick > 0 && collider.kind === 'circle' && collider.cooldown <= 0) {
      ball.velocity.x += normal.x * kick;
      ball.velocity.y += normal.y * kick;
      collider.cooldown = collider.cooldownDuration;
      kicked = true;
    }

    this.emitEvent(
      collider,
      axisPoint.x + normal.x * shapeRadius,
      axisPoint.y + normal.y * shapeRadius,
      -normalSpeed,
      impulse,
      kicked,
    );
  }

  private emitEvent(
    collider: StaticCollider,
    contactX: number,
    contactY: number,
    impactSpeed: number,
    impulse: number,
    kicked: boolean,
  ): void {
    const index = this.activeEvents.length;
    let event = this.eventPool[index];
    if (!event) {
      event = {
        colliderId: '',
        role: 'wall',
        position: createVec2(),
        impactSpeed: 0,
        impulse: 0,
        kicked: false,
      };
      this.eventPool[index] = event;
    }
    event.colliderId = collider.id;
    event.role = collider.role;
    setVec2(event.position, contactX, contactY);
    event.impactSpeed = impactSpeed;
    event.impulse = impulse;
    event.kicked = kicked;
    this.activeEvents.push(event);
  }
}
