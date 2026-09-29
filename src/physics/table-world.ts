/**
 * 台面数据 → 物理世界。
 *
 * 这个文件是「声明式台面」与「物理求解器」之间唯一的粘合层：
 * data.ts 只说台面上有什么，world.ts 只会算碰撞，谁都不认识对方的数据结构。
 *
 * 与 geometry.ts 是**并列**的两个消费者 —— 它们读同一份 wallSpecs()，
 * 所以「看得见的围边」与「撞得到的围边」从原理上就是同一批东西（docs/adr/0002）。
 *
 * 同样零依赖：不 import three、不碰小游戏 API。
 */

import { TABLE, planeBounds, wallSpecs } from '../table/data';
import { makeCircle, makeFlipper, makeSegment } from './colliders';
import { DEFAULT_TUNING, type Tuning } from './tuning';
import { World } from './world';

/**
 * 按台面数据装配一个物理世界。
 *
 * 围边的法线统一朝台面中心取（makeSegment 的 inwardFrom 参数），
 * 所以 data.ts 里的外轮廓无论按顺时针还是逆时针排列都不影响碰撞正确性 ——
 * 数值校准（M3）时可以随便调整点的顺序，不必担心把墙的朝向弄反。
 */
export function createTableWorld(tuning: Tuning = DEFAULT_TUNING): World {
  const bounds = planeBounds();

  const world = new World({
    tuning,
    bounds,
    ballRadius: TABLE.ballRadius,
    ballPosition: { x: TABLE.ballStart.x, y: TABLE.ballStart.y },
  });

  const inward = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };

  // 围边：外轮廓（已去掉坠毁开口） + 发射航道隔墙
  for (const spec of wallSpecs()) {
    world.add(
      makeSegment(
        spec.id,
        spec.from,
        spec.to,
        inward,
        tuning.wallRestitution,
        tuning.wallFriction,
      ),
    );
  }

  // 缓冲器：有主动外推能力，是台面上唯一「会自己发力」的静态碰撞体
  TABLE.bumpers.forEach((bumper, index) => {
    world.add(
      makeCircle(
        `bumper:${index}`,
        'bumper',
        { x: bumper.x, y: bumper.y },
        bumper.radius,
        tuning.bumperRestitution,
        0,
        tuning.bumperKick,
        tuning.bumperCooldown,
      ),
    );
  });

  // 反弹器：只弹，不发力
  TABLE.rebounds.forEach((rebound, index) => {
    world.add(
      makeCircle(
        `rebound:${index}`,
        'rebound',
        { x: rebound.x, y: rebound.y },
        rebound.radius,
        tuning.reboundRestitution,
        0,
      ),
    );
  });

  // 挡板
  for (const spec of TABLE.flippers) {
    world.add(
      makeFlipper(
        `flipper:${spec.side}`,
        spec.side,
        spec.pivot,
        spec.length,
        spec.radius,
        spec.restAngle,
        spec.activeAngle,
        tuning.flipperRestitution,
        tuning.flipperFriction,
      ),
    );
  }

  // 击倒目标 / 点亮目标 / 使命目标在 M5 接入（它们是矩形碰撞体，不是 M2 范围）
  // 发射器不是碰撞体：它只在发射航道底部给球一个初始速度，由 M4 处理

  return world;
}
