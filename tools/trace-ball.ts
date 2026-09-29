/**
 * 球轨迹追踪：跑一遍完整台面，把球的位置、速率、子步数逐段打出来。
 *
 * 这是诊断工具，不是测试 —— 它不做断言，因为台面数值在 M3 还会大改，
 * 断言什么都会被推翻。它的用途是回答两个冒烟测试回答不了的问题：
 *   1. 球会不会被卡在某个角落出不来？
 *   2. 球能不能自然地从坠毁开口出局，而不是中途从别处漏出去？
 *
 * M3 对着原版截图逐点校准台面轮廓时，改完跑一次这个，比反复构建到真机上看快得多。
 */

import { createTableWorld } from '../src/physics/table-world';
import { DEFAULT_TUNING } from '../src/physics/tuning';

const world = createTableWorld(DEFAULT_TUNING);
world.resetBall({ x: 0, y: 150 }, { x: 30, y: -300 });

const STEP = 1 / 120;
const hits: Record<string, number> = {};
let fired = 0;

console.log('时间   位置            球速   子步  出界');
for (let i = 0; i < 120 * 10; i++) {
  world.step(STEP);
  for (const event of world.events) {
    if (event.impactSpeed < 25) continue;
    hits[event.colliderId] = (hits[event.colliderId] || 0) + 1;
    fired++;
  }
  if (i % 30 === 0) {
    const p = world.ball.position;
    const v = Math.hypot(world.ball.velocity.x, world.ball.velocity.y);
    console.log(
      `${(i / 120).toFixed(2).padStart(5)}  (${p.x.toFixed(1).padStart(6)}, ${p.y.toFixed(1).padStart(6)})  ` +
        `${v.toFixed(0).padStart(5)}  ${String(world.substepsLastStep).padStart(3)}  ${world.outOfBounds ? 'YES' : ''}`,
    );
  }
}

console.log('');
console.log(`有效碰撞事件 ${fired} 次`);
const rows = Object.keys(hits).sort((a, b) => hits[b] - hits[a]);
for (const id of rows) console.log(`  ${id.padEnd(18)} ${hits[id]}`);
