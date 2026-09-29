/**
 * 物理可视化调试图。
 *
 * 这个「应用」存在的唯一理由是 ADR-0003 里那条约束：物理层不依赖 three.js、
 * 也不碰小游戏 API。正因为如此，它可以被单独打包成一张网页跑在浏览器里 ——
 * 调一次手感不用等小游戏构建，也不用真机预览。
 *
 * 它复用的是**完全相同的** src/physics 代码，不是一份简化复制品。
 * 所以在这里看到的行为就是真机上的行为（除了渲染部分）。
 *
 * 与游戏工程的分工：只读台面数据与物理世界，不 import three、不 import polyfill。
 */

import { Loop } from '../src/core/loop';
import { TABLE, wallSpecs } from '../src/table/data';
import { createTableWorld } from '../src/physics/table-world';
import { DEFAULT_TUNING, LOSSLESS_TUNING, type Tuning } from '../src/physics/tuning';
import { createVec2, type Vec2 } from '../src/physics/vector2';
import type { World } from '../src/physics/world';

// ---------------------------------------------------------------------------
// DOM
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`缺少页面元素 #${id}`);
  return found as T;
}

const canvas = el<HTMLCanvasElement>('stage');

/**
 * 用函数返回而不是「取完再 if 判空」，是因为 TypeScript 的收窄在嵌套函数里不可靠：
 * 直接 `const ctx = canvas.getContext('2d'); if (!ctx) throw ...` 之后，
 * 在下面各个 draw 函数里 ctx 仍会被判为可能为 null。返回值类型直接声明成非空最省事。
 */
function require2DContext(target: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = target.getContext('2d');
  if (!context) throw new Error('无法获取 2D 绘图上下文');
  return context;
}

const ctx = require2DContext(canvas);

const overlay = el<HTMLDivElement>('overlay');
const drainedBadge = el<HTMLDivElement>('drained');

const inputs = {
  gravity: el<HTMLInputElement>('in-gravity'),
  wall: el<HTMLInputElement>('in-wall'),
  flipper: el<HTMLInputElement>('in-flipper'),
  kick: el<HTMLInputElement>('in-kick'),
  lossless: el<HTMLInputElement>('in-lossless'),
};

const outputs = {
  gravity: el<HTMLOutputElement>('out-gravity'),
  wall: el<HTMLOutputElement>('out-wall'),
  flipper: el<HTMLOutputElement>('out-flipper'),
  kick: el<HTMLOutputElement>('out-kick'),
};

// ---------------------------------------------------------------------------
// 视野映射：逻辑平面 → 画布
//
// 逻辑平面的 y 朝向玩家，屏幕上也是向下，所以不需要翻转 y —— 少一次心智转换。
// ---------------------------------------------------------------------------

const VIEW = { minX: -56, maxX: 56, minY: -8, maxY: 182 };
const SPAN_X = VIEW.maxX - VIEW.minX;
const SPAN_Y = VIEW.maxY - VIEW.minY;

let scale = 1;
let offsetX = 0;
let offsetY = 0;

function resize(): void {
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  scale = Math.min(width / SPAN_X, height / SPAN_Y);
  offsetX = (width - SPAN_X * scale) / 2 - VIEW.minX * scale;
  offsetY = (height - SPAN_Y * scale) / 2 - VIEW.minY * scale;
}

function screenX(x: number): number {
  return offsetX + x * scale;
}

function screenY(y: number): number {
  return offsetY + y * scale;
}

// ---------------------------------------------------------------------------
// 世界
//
// 改参数要重建世界：恢复系数等是在**构造碰撞体时**烘焙进去的，
// 直接改 tuning 不会回头去改已有的碰撞体。重建一次的成本可以忽略。
// ---------------------------------------------------------------------------

let tuning: Tuning = { ...DEFAULT_TUNING };
let world: World = createTableWorld(tuning);

const flashes: { x: number; y: number; life: number; strong: boolean }[] = [];
const ballPoint: Vec2 = createVec2();
const MAX_FLASHES = 32;

function readControls(): void {
  const lossless = inputs.lossless.checked;
  const base = lossless ? LOSSLESS_TUNING : DEFAULT_TUNING;
  tuning = {
    ...base,
    gravityY: lossless ? 0 : Number(inputs.gravity.value),
    wallRestitution: Number(inputs.wall.value),
    flipperAngularSpeed: Number(inputs.flipper.value),
    bumperKick: Number(inputs.kick.value),
  };

  outputs.gravity.textContent = `${tuning.gravityY}`;
  outputs.wall.textContent = tuning.wallRestitution.toFixed(2);
  outputs.flipper.textContent = `${tuning.flipperAngularSpeed}°/s`;
  outputs.kick.textContent = `${tuning.bumperKick}`;

  // 无损模式下重力与本参数无关，界面上要如实反映，避免「拖了没反应」的困惑
  inputs.gravity.disabled = lossless;
}

function resetBall(): void {
  readControls();
  world = createTableWorld(tuning);
  flashes.length = 0;
  // 给一个向上的初速，让它穿过缓冲器群再落下来 —— 一眼能看到大多数组件的行为
  world.resetBall({ x: 0, y: 150 }, { x: 30, y: -300 });
  applyPressed();
  drainedBadge.style.display = 'none';
}

for (const input of [inputs.gravity, inputs.wall, inputs.flipper, inputs.kick]) {
  input.addEventListener('input', () => {
    readControls();
    // 参数只影响新碰撞体，所以重建；把球放回原位保持观感连续
    const previous = world.ball.position;
    const previousVelocity = world.ball.velocity;
    world = createTableWorld(tuning);
    world.resetBall(previous, previousVelocity);
    applyPressed();
  });
}
inputs.lossless.addEventListener('change', resetBall);
el<HTMLButtonElement>('btn-reset').addEventListener('click', resetBall);

// ---------------------------------------------------------------------------
// 输入：左右半屏 + 方向键
// ---------------------------------------------------------------------------

const pressed = { left: false, right: false };
const pointers = new Map<number, 'left' | 'right'>();
const keys = { left: false, right: false };

function applyPressed(): void {
  const left = keys.left || pressed.left;
  const right = keys.right || pressed.right;
  world.setFlipperPressed('left', left);
  world.setFlipperPressed('right', right);
}

/** 按逻辑平面坐标判断左右：不能直接用屏幕 x 与画布中线比，
 *  因为台面在画布里是居中且留白的，用画布中线会把左挡板划到右边去。 */
function sideAt(clientX: number): 'left' | 'right' {
  const rect = canvas.getBoundingClientRect();
  const logical = (clientX - rect.left - offsetX) / scale;
  return logical < 0 ? 'left' : 'right';
}

canvas.addEventListener('pointerdown', (event) => {
  canvas.setPointerCapture(event.pointerId);
  pointers.set(event.pointerId, sideAt(event.clientX));
  syncPointers();
});
canvas.addEventListener('pointerup', (event) => {
  pointers.delete(event.pointerId);
  syncPointers();
});
canvas.addEventListener('pointercancel', (event) => {
  pointers.delete(event.pointerId);
  syncPointers();
});

function syncPointers(): void {
  pressed.left = false;
  pressed.right = false;
  pointers.forEach((side) => {
    pressed[side] = true;
  });
  applyPressed();
}

window.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowLeft') keys.left = true;
  else if (event.key === 'ArrowRight') keys.right = true;
  else if (event.key === ' ') {
    resetBall();
    event.preventDefault();
    return;
  } else return;
  event.preventDefault();
  applyPressed();
});
window.addEventListener('keyup', (event) => {
  if (event.key === 'ArrowLeft') keys.left = false;
  else if (event.key === 'ArrowRight') keys.right = false;
  else return;
  applyPressed();
});

// ---------------------------------------------------------------------------
// 渲染
// ---------------------------------------------------------------------------

function drawBackground(): void {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  // 台面底板
  ctx.beginPath();
  TABLE.outline.forEach((point, index) => {
    const x = screenX(point.x);
    const y = screenY(point.y);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fillStyle = '#e6ecf7';
  ctx.fill();
  ctx.strokeStyle = '#c3cddf';
  ctx.lineWidth = 1;
  ctx.stroke();

  // 坠毁开口：底部中央那条不立墙的边，画成红色虚线，明确标出「球从这里掉出去」
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(screenX(-28), screenY(TABLE.length));
  ctx.lineTo(screenX(28), screenY(TABLE.length));
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = 'rgba(192, 57, 43, 0.75)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawWalls(): void {
  ctx.lineCap = 'round';
  ctx.lineWidth = TABLE.wallThickness * scale;
  for (const spec of wallSpecs()) {
    ctx.beginPath();
    ctx.moveTo(screenX(spec.from.x), screenY(spec.from.y));
    ctx.lineTo(screenX(spec.to.x), screenY(spec.to.y));
    // 发射航道隔墙用不同颜色，方便一眼看出球在航道里还是台面上
    ctx.strokeStyle = spec.role === 'lane' ? '#7c8fb5' : '#8d99ae';
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
}

function drawCircle(x: number, y: number, radius: number, fill: string, stroke: string): void {
  ctx.beginPath();
  ctx.arc(screenX(x), screenY(y), radius * scale, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

function drawComponents(): void {
  for (const bumper of TABLE.bumpers) {
    drawCircle(bumper.x, bumper.y, bumper.radius, '#2f5fd0', '#1c3f96');
  }
  for (const rebound of TABLE.rebounds) {
    drawCircle(rebound.x, rebound.y, rebound.radius, '#b8c2d4', '#8d99ae');
  }

  // 挡板：胶囊 = 圆头粗线，和物理里的形状完全一致
  for (const flipper of world.flippers) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = flipper.radius * 2 * scale;
    ctx.beginPath();
    ctx.moveTo(screenX(flipper.pivot.x), screenY(flipper.pivot.y));
    ctx.lineTo(screenX(flipper.tip.x), screenY(flipper.tip.y));
    ctx.strokeStyle = flipper.pressed ? '#e2643c' : '#d6dbe6';
    ctx.stroke();
    ctx.restore();
  }
}

function drawFlashes(): void {
  for (const flash of flashes) {
    const alpha = Math.max(0, flash.life);
    if (alpha <= 0) continue;
    ctx.beginPath();
    ctx.arc(screenX(flash.x), screenY(flash.y), (flash.strong ? 5 : 3) * scale * alpha, 0, Math.PI * 2);
    ctx.strokeStyle = flash.strong
      ? `rgba(226, 100, 60, ${alpha})`
      : `rgba(47, 95, 208, ${alpha * 0.8})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawBall(): void {
  const x = screenX(ballPoint.x);
  const y = screenY(ballPoint.y);
  const radius = world.ball.radius * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = '#fdfdfe';
  ctx.fill();
  ctx.strokeStyle = '#5d6b82';
  ctx.lineWidth = 2;
  ctx.stroke();
  // 高光，便于判断球在滚动还是在原地抖动
  ctx.beginPath();
  ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
}

function render(alpha: number): void {
  drawBackground();
  drawWalls();
  drawComponents();
  drawFlashes();
  world.interpolateBall(ballPoint, alpha);
  drawBall();
  updateOverlay();
}

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------

const loop = new Loop(
  {
    fixedUpdate(dt: number): void {
      world.step(dt);

      for (const event of world.events) {
        if (event.impactSpeed < 25) continue;
        // 超出上限就挤掉最旧的一条。flashes 是按时间顺序追加的，
        // 而衰减速度对所有元素一致，所以队首永远最旧。
        if (flashes.length >= MAX_FLASHES) flashes.shift();
        flashes.push({
          x: event.position.x,
          y: event.position.y,
          life: 1,
          strong: event.kicked || event.impactSpeed > 180,
        });
      }

      for (const flash of flashes) flash.life -= dt * 4;
      while (flashes.length > 0 && flashes[0].life <= 0) flashes.shift();
    },
    render,
  },
  1 / 120,
);

// 统计信息每 250ms 刷一次，避免每帧写 DOM
let lastOverlayUpdate = 0;
let overlayText = '';

function updateOverlay(): void {
  const now = performance.now();
  if (now - lastOverlayUpdate < 250) return;
  lastOverlayUpdate = now;

  const metrics = loop.metrics;
  const speed = Math.hypot(world.ball.velocity.x, world.ball.velocity.y);
  const next =
    `FPS        ${metrics.fps.toFixed(1)}  (${metrics.frameMs.toFixed(1)} ms)\n` +
    `逻辑        ${metrics.stepsPerSecond.toFixed(0)} Hz  丢弃 ${metrics.droppedSteps}\n` +
    `子步        ${world.substepsLastStep}\n` +
    `球速        ${speed.toFixed(1)}  上限 ${tuning.maxBallSpeed}\n` +
    `球位置      (${world.ball.position.x.toFixed(1)}, ${world.ball.position.y.toFixed(1)})\n` +
    `本步接触    ${world.events.length}\n` +
    `碰撞体      ${world.colliders.length}`;

  if (next !== overlayText) {
    overlayText = next;
    overlay.textContent = next;
  }

  if (world.outOfBounds) drainedBadge.style.display = 'block';
}

resize();
window.addEventListener('resize', resize);
if (typeof ResizeObserver !== 'undefined') {
  new ResizeObserver(resize).observe(canvas);
}

readControls();
resetBall();
loop.start();

/**
 * 调试句柄。
 *
 * 一是方便在浏览器控制台里直接查世界状态（`__DEMO__.getWorld().ball`），
 * 二是让无头验证（tools/demo-harness.ts）能检查内部状态 ——
 * 否则「点击右半屏后右挡板是否真的被按下」这件事无法在浏览器之外断言。
 */
(window as any).__DEMO__ = {
  getWorld: () => world,
  getTuning: () => tuning,
  reset: resetBall,
  loop,
};
