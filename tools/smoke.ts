/**
 * Node 冒烟测试。
 *
 * 构建通过只说明「能打包」，不说明「能跑」。这个测试在 Node 里用替身环境把
 * 真实模块跑一遍，目的是把几条**架构断言变成可执行的检查**：
 *   - polyfill 在真实调用路径上不抛异常
 *   - 台面数据 → 几何 → 贴图 这条管线能跑通
 *   - 相机俯角在各种机型比例下恒定（ADR-0006 的核心主张）
 *   - 台面在各种机型比例下不被裁切（ADR-0006 的后果条款）
 *   - 主循环的定步长精度，以及大 delta 不产生死亡螺旋（ADR-0003）
 *
 * 它**不能**替代真机验证：WebGL 上下文的创建、真实 GPU 的渲染结果、
 * 触摸事件的坐标，都必须在真机上看。
 */

import './mock-env';
import { clock, drawCalls, gameGlobal, modals, nativeGlobal, pumpRaf } from './mock-env';
// 跑真实的 polyfill —— 顺便验证它在模块加载期不抛异常
import '../src/env/polyfill';
import * as THREE from 'three';
import { Loop } from '../src/core/loop';
import { CAMERA_ELEVATION_DEG, createCameraRig } from '../src/render/camera';
import { createScene } from '../src/render/scene';
import { TABLE, fitPoints, wallSegments } from '../src/table/data';
import { buildTable } from '../src/table/geometry';
import { makeFlipper, makeSegment } from '../src/physics/colliders';
import { createTableWorld } from '../src/physics/table-world';
import { DEFAULT_TUNING, LOSSLESS_TUNING } from '../src/physics/tuning';
import { World } from '../src/physics/world';

const failures: string[] = [];
const notes: string[] = [];

function check(condition: boolean, message: string): void {
  if (condition) return;
  failures.push(message);
}

function approx(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

// ---------------------------------------------------------------------------
// A. polyfill
//
// 替身刻意让 GameGlobal 与 globalThis 是两个不同对象（真机如此）。
// 因此下面三组检查合起来等价于一句断言：
//   「polyfill 的全局写入必须同时到达两个目标，且写的是屏幕画布」
// 任何「只写一边」的回归都会在这里直接失败。
// ---------------------------------------------------------------------------

check(gameGlobal !== nativeGlobal, '替身环境不忠实：GameGlobal 与 globalThis 必须是两个不同对象');
check(!!gameGlobal.canvas, 'polyfill 未在 GameGlobal 上设置 canvas');
check(!!nativeGlobal.canvas, 'polyfill 未在 globalThis 上设置 canvas（只写了一边）');
check(gameGlobal.canvas === nativeGlobal.canvas, 'GameGlobal.canvas 与 globalThis.canvas 不是同一个画布');

// 第一次 wx.createCanvas() 必须是屏幕上可见的那块，而不是离屏画布。
// 拿错画布的症状是「渲染成功但屏幕全黑」，所以这里断言 kind。
check(gameGlobal.canvas && gameGlobal.canvas.kind === 'screen', '全局 canvas 不是屏幕画布（取到了离屏画布）');

check(!!gameGlobal.window && !!gameGlobal.document && !!gameGlobal.navigator, 'polyfill 未设置 window/document/navigator');
check(!!nativeGlobal.window && !!nativeGlobal.document, 'window/document 只挂到了 GameGlobal，未挂到 globalThis');
check(typeof gameGlobal.window.requestAnimationFrame === 'function', 'polyfill 未提供 window.requestAnimationFrame');

// three.js 打包后的代码用的是裸标识符，必须能在模块作用域里解析到
check(typeof window !== 'undefined' && !!(window as any).canvas, '裸标识符 window 未解析到 polyfill 挂载的全局');
check(typeof document !== 'undefined' && !!document.createElement('canvas'), '裸标识符 document 未就绪');
check(typeof requestAnimationFrame === 'function', '全局 requestAnimationFrame 不可用');

// 回归护栏：polyfill 绝不能用假时钟覆盖已有的 performance。
// 覆盖的后果不是崩溃，而是主循环拿到毫秒级抖动的时间戳，真机上表现为周期性卡顿。
const sentinelTime = clock.now;
check(
  typeof performance.now === 'function' && performance.now() === sentinelTime,
  'polyfill 覆盖了真实 performance（退化成 Date.now() 低精度假时钟）',
);

notes.push(
  `polyfill: 屏幕画布 ${!!gameGlobal.canvas} · GameGlobal≠globalThis ${gameGlobal !== nativeGlobal} · ` +
    `window/document 双写 ${!!nativeGlobal.window && !!nativeGlobal.document}`,
);

// ---------------------------------------------------------------------------
// B. 台面数据 → 几何 → 贴图
// ---------------------------------------------------------------------------

let table: ReturnType<typeof buildTable> | null = null;
try {
  table = buildTable();
} catch (err) {
  failures.push(`buildTable 抛异常：${(err as Error).message}`);
}

if (table) {
  let meshCount = 0;
  let triangleCount = 0;
  table.group.traverse((object: any) => {
    if (!object.isMesh) return;
    meshCount++;
    const geometry = object.geometry as any;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position.count;
    triangleCount += count / 3;
  });

  check(meshCount > 0, '台面没有生成任何网格');
  check(!!table.ball, '台面缺少球网格');
  check(!!table.flippers.left && !!table.flippers.right, '挡板未按左右两侧生成');
  check((drawCalls.fillRect || 0) > 0, '台面贴图没有被绘制');

  notes.push(
    `台面: ${meshCount} 个网格 · ${triangleCount} 三角形 · ` +
      `墙段 ${wallSegments().length} · 贴图 fillRect 调用 ${drawCalls.fillRect || 0} 次`,
  );
}

// ---------------------------------------------------------------------------
// C. 相机：俯角恒定 + 台面不被裁切
//
// 这两条是 ADR-0006 明确写下的承诺，必须可验证：
// 「只改距离，不改角度」「16:9 至 21:9 下台面不被裁切」。
// ---------------------------------------------------------------------------

const subject = fitPoints().map((point) => new THREE.Vector3(point.x, point.y, point.z));

const aspectCases = [
  { name: '16:9', value: 16 / 9 },
  { name: '19.5:9', value: 19.5 / 9 },
  { name: '21:9', value: 21 / 9 },
  { name: '4:3', value: 4 / 3 },
  { name: '3:4 竖屏', value: 3 / 4 },
  { name: '9:19.5 竖屏', value: 9 / 19.5 },
];

const cameraRows: string[] = [];
const probe = new THREE.Vector3();

for (const item of aspectCases) {
  const rig = createCameraRig(item.value);
  rig.target.set(0, 0, TABLE.length / 2);
  rig.fit(subject, item.value);

  const elevation = rig.elevationDeg();
  check(
    approx(elevation, CAMERA_ELEVATION_DEG, 0.01),
    `${item.name} 下相机俯角为 ${elevation.toFixed(3)}°，偏离设计值 ${CAMERA_ELEVATION_DEG}°`,
  );

  // 判据与 fit() 一致：投影同一份点集，含围边顶部
  let maxAbsX = 0;
  let maxAbsY = 0;
  for (const point of subject) {
    probe.copy(point).project(rig.camera);
    maxAbsX = Math.max(maxAbsX, Math.abs(probe.x));
    maxAbsY = Math.max(maxAbsY, Math.abs(probe.y));
  }

  check(maxAbsX <= 1, `${item.name} 下台面横向被裁切（NDC x 达 ${maxAbsX.toFixed(3)}）`);
  check(maxAbsY <= 1, `${item.name} 下台面纵向被裁切（NDC y 达 ${maxAbsY.toFixed(3)}）`);

  cameraRows.push(
    `  ${item.name.padEnd(12)}距离 ${rig.distance().toFixed(1).padStart(7)}  俯角 ${elevation.toFixed(2)}°  ` +
      `NDC x/y ${maxAbsX.toFixed(3)} / ${maxAbsY.toFixed(3)}`,
  );
}

// ---------------------------------------------------------------------------
// D. 主循环：定步长精度 + 大 delta 不产生死亡螺旋
// ---------------------------------------------------------------------------

const STEP = 1 / 120;
const MAX_STEPS_PER_FRAME = 8;
let stepCount = 0;
let frameCount = 0;

const loop = new Loop(
  {
    fixedUpdate(): void {
      stepCount++;
    },
    render(): void {
      frameCount++;
    },
  },
  STEP,
);

clock.now = 0;
loop.start();

// start() 内部已经跑过一帧，之后补 299 帧 60Hz，合计约 4983ms
const frameMs = 1000 / 60;
for (let i = 0; i < 299; i++) {
  clock.advance(frameMs);
  pumpRaf();
}

const expectedSteps = Math.round((299 * frameMs) / 1000 / STEP);
check(
  approx(stepCount, expectedSteps, 2),
  `定步长不准：4983ms 内期望约 ${expectedSteps.toFixed(0)} 步，实际 ${stepCount} 步`,
);
check(frameCount === 300, `渲染帧数应为 300，实际 ${frameCount}`);
notes.push(
  `主循环: ${frameCount} 帧内执行 ${stepCount} 次逻辑步（预期约 ${expectedSteps.toFixed(0)}），步长 ${(STEP * 1000).toFixed(2)}ms`,
);

// 模拟一次严重的卡顿：5 秒的巨大 delta
const stepsBeforeSpike = stepCount;
const droppedBeforeSpike = loop.metrics.droppedSteps;
clock.advance(5000);
pumpRaf();
const stepsInSpike = stepCount - stepsBeforeSpike;

check(
  stepsInSpike <= MAX_STEPS_PER_FRAME,
  `大 delta 未被单帧步数上限截断：单帧执行了 ${stepsInSpike} 步`,
);
check(
  loop.metrics.droppedSteps > droppedBeforeSpike,
  '大 delta 后没有记录被丢弃的逻辑步，死亡螺旋防护失效',
);
notes.push(
  `卡顿防护: 单帧 5000ms 只补算 ${stepsInSpike} 步，丢弃累计 ${loop.metrics.droppedSteps}（此前 ${droppedBeforeSpike}）`,
);
loop.stop();

// ---------------------------------------------------------------------------
// E. 场景装配
// ---------------------------------------------------------------------------

const sceneRig = createScene();
if (table) sceneRig.scene.add(table.group);
const sceneChildren = sceneRig.scene.children.length;
check(sceneChildren >= 4, `场景元素过少：${sceneChildren} 个（灯光 4 + 台面 1 才够）`);
notes.push(`场景: ${sceneChildren} 个顶层对象`);

// ---------------------------------------------------------------------------
// F. 物理求解器
//
// ADR-0003 在决定「自研物理」时点名承认了三个弱区：高速穿透、能量守恒、挡板手感。
// 自研的正当性建立在「这三个弱区我们都能验证」之上，所以下面把每条都变成断言。
// 另外加一条 ADR-0002 的一致性检查：围边的几何与碰撞必须来自同一份数据。
// ---------------------------------------------------------------------------

const STEP_PHYS = 1 / 120;
const physicsRows: string[] = [];

// --- F1. 几何与碰撞同源（ADR-0002）-------------------------------------------
// 几何那边给每条围边网格挂了 name = WallSpec.id，物理这边每条围边碰撞体也用同一个 id。
// 两个集合必须完全一致 —— 这是「看着撞到了却没反应」不可能出现的机器证明。

const world = createTableWorld();

const wallMeshIds: string[] = [];
const wallsGroup = table ? table.group.getObjectByName('walls') : undefined;
if (wallsGroup) {
  wallsGroup.traverse((object: any) => {
    if (object.isMesh) wallMeshIds.push(String(object.name));
  });
}
const wallColliderIds = world.colliders
  .filter((collider) => collider.kind === 'segment')
  .map((collider) => collider.id);

wallMeshIds.sort();
wallColliderIds.sort();

check(wallMeshIds.length > 0, '几何侧没有生成任何围边网格');
check(
  wallMeshIds.length === wallColliderIds.length,
  `围边数量不一致：几何 ${wallMeshIds.length} 条，物理 ${wallColliderIds.length} 条`,
);
check(
  wallMeshIds.join('|') === wallColliderIds.join('|'),
  `围边 id 不一致：几何 [${wallMeshIds.join(', ')}] vs 物理 [${wallColliderIds.join(', ')}]`,
);
physicsRows.push(
  `同源检查: ${wallMeshIds.length} 条围边，几何与物理 id 完全一致 ` +
    `(挡板 ${world.flippers.length} · 缓冲器 ${TABLE.bumpers.length} · 反弹器 ${TABLE.rebounds.length})`,
);

// --- F2. 能量守恒（LOSSLESS）-------------------------------------------------
// 在一个矩形盒子里让球斜向弹跳：无重力、无阻尼、恢复系数 1、摩擦 0。
// 求解器若在任何一处凭空吃掉或注入能量，速率就会漂移。

const boxBounds = { minX: -60, maxX: 60, minY: -80, maxY: 80 };
const boxOrigin = { x: 0, y: 0 };
const lossless = new World({
  tuning: LOSSLESS_TUNING,
  bounds: boxBounds,
  ballRadius: 2.3,
  ballPosition: { x: 0, y: 0 },
});
lossless.add(makeSegment('box:top', { x: -60, y: -80 }, { x: 60, y: -80 }, boxOrigin, 1, 0));
lossless.add(makeSegment('box:right', { x: 60, y: -80 }, { x: 60, y: 80 }, boxOrigin, 1, 0));
lossless.add(makeSegment('box:bottom', { x: 60, y: 80 }, { x: -60, y: 80 }, boxOrigin, 1, 0));
lossless.add(makeSegment('box:left', { x: -60, y: 80 }, { x: -60, y: -80 }, boxOrigin, 1, 0));

const initialSpeed = Math.hypot(150, 100);
lossless.resetBall({ x: 0, y: 0 }, { x: 150, y: 100 });

let minSpeed = initialSpeed;
let maxSpeed = initialSpeed;
let bounces = 0;
let previousVx = lossless.ball.velocity.x;
let previousVy = lossless.ball.velocity.y;

for (let i = 0; i < 600; i++) {
  lossless.step(STEP_PHYS);
  const speed = Math.hypot(lossless.ball.velocity.x, lossless.ball.velocity.y);
  minSpeed = Math.min(minSpeed, speed);
  maxSpeed = Math.max(maxSpeed, speed);
  if (
    Math.sign(lossless.ball.velocity.x) !== Math.sign(previousVx) ||
    Math.sign(lossless.ball.velocity.y) !== Math.sign(previousVy)
  ) {
    bounces++;
  }
  previousVx = lossless.ball.velocity.x;
  previousVy = lossless.ball.velocity.y;
}

const speedDrift = Math.max(
  Math.abs(minSpeed - initialSpeed) / initialSpeed,
  Math.abs(maxSpeed - initialSpeed) / initialSpeed,
);
check(bounces >= 4, `无损盒子里 5 秒只发生了 ${bounces} 次反弹，测试本身可能失效`);
check(
  speedDrift < 0.005,
  `求解器吞/注能量：初速 ${initialSpeed.toFixed(2)}，速率区间 ${minSpeed.toFixed(2)}~${maxSpeed.toFixed(2)}，漂移 ${(speedDrift * 100).toFixed(3)}%`,
);
physicsRows.push(
  `能量守恒: 初速 ${initialSpeed.toFixed(2)} → 速率 ${minSpeed.toFixed(2)}~${maxSpeed.toFixed(2)}，` +
    `${bounces} 次反弹后漂移 ${(speedDrift * 100).toFixed(4)}%`,
);

// --- F3. 满速不穿透 ----------------------------------------------------------
// 1/120 秒步长下满速 700 的单步位移约 5.83，而球半径只有 2.3 —— 不切子步必然穿墙。

const fast = createTableWorld(LOSSLESS_TUNING);
fast.resetBall({ x: 0, y: 86 }, { x: LOSSLESS_TUNING.maxBallSpeed, y: 0 });
const travelPerStep = LOSSLESS_TUNING.maxBallSpeed * STEP_PHYS;

let escaped = -1;
let maxSubstepsUsed = 0;
let fastBounces = 0;
let fastPreviousVx = fast.ball.velocity.x;

for (let i = 0; i < 360; i++) {
  fast.step(STEP_PHYS);
  maxSubstepsUsed = Math.max(maxSubstepsUsed, fast.substepsLastStep);
  if (Math.sign(fast.ball.velocity.x) !== Math.sign(fastPreviousVx)) fastBounces++;
  fastPreviousVx = fast.ball.velocity.x;

  const r = fast.ball.radius;
  const { position } = fast.ball;
  const outside =
    position.x < fast.bounds.minX - r - 1 ||
    position.x > fast.bounds.maxX + r + 1 ||
    position.y < fast.bounds.minY - r - 1 ||
    position.y > fast.bounds.maxY + r + 1;
  if (outside && escaped < 0) escaped = i;
}

check(maxSubstepsUsed > 1, `满速球没有触发子步进（最多 ${maxSubstepsUsed} 步），穿透风险未消除`);
check(maxSubstepsUsed <= LOSSLESS_TUNING.maxSubsteps, `子步数超过上限 ${LOSSLESS_TUNING.maxSubsteps}`);
check(fastBounces >= 2, `满速球 3 秒只反弹 ${fastBounces} 次，测试本身可能失效`);
check(
  escaped < 0,
  `满速球在第 ${escaped} 步穿出台面（单步位移 ${travelPerStep.toFixed(2)}，球半径 ${fast.ball.radius}）`,
);
physicsRows.push(
  `高速穿透: 单步位移 ${travelPerStep.toFixed(2)} / 球半径 ${fast.ball.radius}，` +
    `子步最多 ${maxSubstepsUsed}，${fastBounces} 次反弹全程未穿出`,
);

// --- F4. 低速接触不抖动（restitutionThreshold）--------------------------------
// 球以远低于阈值的速度蹭上发射航道隔墙：
// 默认参数下应该「贴住不吃反弹」，无损参数下应该原速弹回。
// 这一对断言同时验证了阈值生效、以及阈值可以通过设 0 关掉。

const nearWallX = TABLE.launchLane.innerWallX - 2.0;
const crawlSpeed = 3;

const stickyWorld = createTableWorld(DEFAULT_TUNING);
stickyWorld.resetBall({ x: nearWallX, y: 80 }, { x: crawlSpeed, y: 0 });
stickyWorld.step(STEP_PHYS);

const bouncyWorld = createTableWorld(LOSSLESS_TUNING);
bouncyWorld.resetBall({ x: nearWallX, y: 80 }, { x: crawlSpeed, y: 0 });
bouncyWorld.step(STEP_PHYS);

const stickyVx = stickyWorld.ball.velocity.x;
const bouncyVx = bouncyWorld.ball.velocity.x;

check(
  Math.abs(stickyVx) < 0.1,
  `低速接触没有被阈值抑制：以 ${crawlSpeed} 撞墙后横向速度仍为 ${stickyVx.toFixed(3)}（应为 0）`,
);
check(
  approx(bouncyVx, -crawlSpeed, 0.1),
  `阈值关掉后未正常反弹：以 ${crawlSpeed} 撞墙后横向速度为 ${bouncyVx.toFixed(3)}（应为 ${-crawlSpeed}）`,
);
physicsRows.push(
  `静止抖动抑制: 阈值 ${DEFAULT_TUNING.restitutionThreshold} 下撞墙后 vx ${stickyVx.toFixed(3)}（贴住），` +
    `阈值 0 下 vx ${bouncyVx.toFixed(3)}（原速弹回）`,
);

// --- F5. 挡板把手感做出来 ----------------------------------------------------
// 球贴着挡板上表面静止放置，然后拍下挡板。
// 冲击来自「相对运动表面的相对速度」，不是绝对速度 —— 所以对照组（不拍）必须几乎不动。

const flipperSpec = TABLE.flippers[0];
const flipperDir = {
  x: Math.cos((flipperSpec.restAngle * Math.PI) / 180),
  y: Math.sin((flipperSpec.restAngle * Math.PI) / 180),
};
// 指向 -y（台面内侧上方）的垂线，也就是球接触的那一侧
const flipperUp = { x: flipperDir.y, y: -flipperDir.x };
const flipperRestingBall = {
  x:
    flipperSpec.pivot.x +
    flipperDir.x * 12 +
    flipperUp.x * (flipperSpec.radius + TABLE.ballRadius - 0.05),
  y:
    flipperSpec.pivot.y +
    flipperDir.y * 12 +
    flipperUp.y * (flipperSpec.radius + TABLE.ballRadius - 0.05),
};

function flipperKickTest(pressed: boolean): number {
  const rig = new World({
    tuning: DEFAULT_TUNING,
    bounds: { minX: -400, maxX: 400, minY: -400, maxY: 400 },
    ballRadius: TABLE.ballRadius,
    ballPosition: flipperRestingBall,
  });
  rig.add(
    makeFlipper(
      `flipper:${flipperSpec.side}`,
      flipperSpec.side,
      flipperSpec.pivot,
      flipperSpec.length,
      flipperSpec.radius,
      flipperSpec.restAngle,
      flipperSpec.activeAngle,
      DEFAULT_TUNING.flipperRestitution,
      DEFAULT_TUNING.flipperFriction,
    ),
  );
  rig.setFlipperPressed(flipperSpec.side, pressed);

  let peakUpSpeed = 0;
  for (let i = 0; i < 24; i++) {
    rig.step(STEP_PHYS);
    peakUpSpeed = Math.max(peakUpSpeed, -rig.ball.velocity.y);
  }
  return peakUpSpeed;
}

const kickedUpSpeed = flipperKickTest(true);
const restingUpSpeed = flipperKickTest(false);

check(
  kickedUpSpeed > 150,
  `拍下挡板后球几乎没有被击出：向上峰值速度仅 ${kickedUpSpeed.toFixed(1)}`,
);
check(
  restingUpSpeed < 5,
  `挡板静止时球却被弹起 ${restingUpSpeed.toFixed(1)} —— 冲量算成了绝对速度而不是相对速度`,
);
physicsRows.push(
  `挡板手感: 拍击后向上峰值 ${kickedUpSpeed.toFixed(1)}，` +
    `对照（不拍）${restingUpSpeed.toFixed(2)}，角速度 ${DEFAULT_TUNING.flipperAngularSpeed}°/s`,
);

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

console.log('');
console.log('相机适配（ADR-0006：角度恒定，只改距离）');
for (const row of cameraRows) console.log(row);
console.log('');
console.log('物理求解器（ADR-0003：三个弱区逐条验证）');
for (const row of physicsRows) console.log('  · ' + row);
console.log('');
console.log('检查项');
for (const note of notes) console.log('  · ' + note);
if (modals.length > 0) console.log('  · showModal 记录：' + modals.join(' | '));

console.log('');
if (failures.length === 0) {
  console.log('冒烟测试：全部通过');
} else {
  console.log(`冒烟测试：${failures.length} 项失败`);
  for (const failure of failures) console.log('  ✗ ' + failure);
  process.exit(1);
}
