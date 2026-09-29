/**
 * 浏览器 3D 台面预览（docs/adr/0010）。
 *
 * 为什么需要它：物理能靠数字断言验证（能量漂移 0.0000%、挡板峰值 323.8），
 * **视觉不能** —— 看不见就没法调。这里复用同一份 src/table 与 src/render，
 * 只把「宿主」换成浏览器：小游戏 API 全部关在本文件里，渲染层一行不动。
 *
 * 它**不替代**真机验证：WebGL 扩展支持、GPU 实际表现、触摸坐标仍只能真机看。
 * 它解决的是另一件事 —— 改美术的每一步立刻看得见。
 */

import * as THREE from 'three';
import { Loop } from './core/loop';
import type { ScreenMetrics } from './core/screen';
import { CAMERA_ELEVATION_DEG, createCameraRig } from './render/camera';
import { createScene } from './render/scene';
import { setCanvasFactory } from './render/texture';
import { TABLE, fitPoints } from './table/data';
import { buildTable, setFlipperAngle } from './table/geometry';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// 宿主一：画布来源
//
// 必须在 buildTable() 之前注入 —— 台面贴图靠它建离屏画布（见 texture.ts）。
// ---------------------------------------------------------------------------

setCanvasFactory((width, height) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
});

// ---------------------------------------------------------------------------
// 宿主二：设备度量
//
// 真机上是 wx.getSystemInfoSync()。这里用几台典型竖屏机顶替，像素比同样夹到 2，
// 与 readScreen() 里的 MAX_PIXEL_RATIO 保持一致 —— 否则预览会比真机好看，
// 就失去参照价值了。
// ---------------------------------------------------------------------------

const MAX_PIXEL_RATIO = 2;

interface DevicePreset {
  label: string;
  width: number;
  height: number;
  pixelRatio: number;
  safeTop: number;
  safeBottom: number;
}

const DEVICES: DevicePreset[] = [
  { label: 'iPhone SE', width: 320, height: 568, pixelRatio: 2, safeTop: 20, safeBottom: 0 },
  { label: 'iPhone 14', width: 390, height: 844, pixelRatio: 3, safeTop: 47, safeBottom: 34 },
  { label: 'Pro Max', width: 430, height: 932, pixelRatio: 3, safeTop: 59, safeBottom: 34 },
  { label: 'Android', width: 412, height: 915, pixelRatio: 2.625, safeTop: 24, safeBottom: 0 },
];

function screenOf(device: DevicePreset): ScreenMetrics {
  return {
    width: device.width,
    height: device.height,
    pixelRatio: Math.min(device.pixelRatio, MAX_PIXEL_RATIO),
    aspect: device.width / device.height,
    safeTop: device.safeTop,
    safeBottom: device.safeBottom,
  };
}

// ---------------------------------------------------------------------------
// 页面元素
// ---------------------------------------------------------------------------

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少页面元素 #${id}`);
  return node as T;
}

const stage = el<HTMLCanvasElement>('stage');
const stageWrap = el<HTMLDivElement>('stage-wrap');
const readout = el<HTMLPreElement>('readout');
const deviceBar = el<HTMLDivElement>('devices');
const resetButton = el<HTMLButtonElement>('btn-reset');

// ---------------------------------------------------------------------------
// 渲染器
//
// 显式取 WebGL 1，与真机一致（ADR-0004）。拿不到就交给 three 自己挑，
// 但读数里会标出来 —— 那种情况下预览的表现不代表真机。
// ---------------------------------------------------------------------------

let device = DEVICES[1];
let screen = screenOf(device);

const gl = stage.getContext('webgl', {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: true,
  preserveDrawingBuffer: false,
  powerPreference: 'default',
  failIfMajorPerformanceCaveat: false,
}) as WebGLRenderingContext | null;

const renderer = gl
  ? new THREE.WebGLRenderer({ canvas: stage, context: gl, antialias: false })
  : new THREE.WebGLRenderer({ canvas: stage, antialias: false });
renderer.setClearColor(0x070b14, 1);

const sceneRig = createScene();

const cameraRig = createCameraRig(screen.aspect);
cameraRig.target.set(0, 0, TABLE.length / 2);
const subject = fitPoints().map((p) => new THREE.Vector3(p.x, p.y, p.z));

const table = buildTable();
sceneRig.scene.add(table.group);
sceneRig.scene.add(cameraRig.camera);

// ---------------------------------------------------------------------------
// 视角控制
//
// ADR-0006 规定游戏相机角度恒定。预览**故意放开**这条约束 —— 看画风本来
// 就需要从别的角度看。初始值仍是 62°，所以打开就是游戏里的构图。
// ---------------------------------------------------------------------------

const view = {
  azimuth: 0,
  elevation: CAMERA_ELEVATION_DEG,
  distance: 100,
  scale: 1,
};

/** 用 rig 的二分适配求出「标准视角下恰好框住台面」的距离，作为缩放基准 */
function fitCamera(): void {
  cameraRig.camera.aspect = screen.aspect;
  cameraRig.fit(subject, screen.aspect);
  view.distance = cameraRig.distance();
}

function applyView(): void {
  const elevation = view.elevation * DEG;
  const azimuth = view.azimuth * DEG;
  const dir = new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  );
  cameraRig.camera.position.copy(cameraRig.target).addScaledVector(dir, view.distance * view.scale);
  cameraRig.camera.lookAt(cameraRig.target);
}

function layout(): void {
  const availW = stageWrap.clientWidth;
  const availH = stageWrap.clientHeight;
  const fit = Math.min(availW / screen.width, availH / screen.height);

  // CSS 尺寸按设备比例算（保持等比，不拉伸）；内部分辨率由 setSize 按像素比设
  stage.style.width = `${Math.round(screen.width * fit)}px`;
  stage.style.height = `${Math.round(screen.height * fit)}px`;

  renderer.setPixelRatio(screen.pixelRatio);
  renderer.setSize(screen.width, screen.height, false);

  cameraRig.camera.aspect = screen.aspect;
  cameraRig.camera.updateProjectionMatrix();
  applyView();
}

function selectDevice(next: DevicePreset): void {
  device = next;
  screen = screenOf(device);
  for (const button of Array.from(deviceBar.querySelectorAll('button'))) {
    button.classList.toggle('on', button.textContent === device.label);
  }
  fitCamera();
  layout();
}

for (const preset of DEVICES) {
  const button = document.createElement('button');
  button.textContent = preset.label;
  button.addEventListener('click', () => selectDevice(preset));
  deviceBar.appendChild(button);
}

// ---------------------------------------------------------------------------
// 鼠标交互：拖动转视角、滚轮缩放
// ---------------------------------------------------------------------------

let dragging = false;
let lastX = 0;
let lastY = 0;

stage.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastX = event.clientX;
  lastY = event.clientY;
  stage.setPointerCapture(event.pointerId);
});

stage.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastX;
  const dy = event.clientY - lastY;
  lastX = event.clientX;
  lastY = event.clientY;

  view.azimuth = (((view.azimuth - dx * 0.4) % 360) + 360) % 360;
  // 下限 8° 防止贴到水平面（那是台面的侧切面，看不到任何布局）；
  // 上限 89° 防止与 lookAt 的 up 向量共线导致画面翻转
  view.elevation = Math.min(89, Math.max(8, view.elevation + dy * 0.3));
  applyView();
});

const endDrag = (): void => {
  dragging = false;
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);

stage.addEventListener(
  'wheel',
  (event) => {
    event.preventDefault();
    view.scale = Math.min(3, Math.max(0.3, view.scale * (event.deltaY > 0 ? 1.08 : 0.93)));
    applyView();
  },
  { passive: false },
);

resetButton.addEventListener('click', () => {
  view.azimuth = 0;
  view.elevation = CAMERA_ELEVATION_DEG;
  view.scale = 1;
  fitCamera();
  applyView();
});

// ---------------------------------------------------------------------------
// 挡板：键盘控制
//
// 预览里挡板只用来核对外形与行程，不做玩法。
// ---------------------------------------------------------------------------

const flipperAngle: Record<string, number> = {
  left: TABLE.flippers[0].restAngle,
  right: TABLE.flippers[1].restAngle,
};
const flipperSpec = { left: TABLE.flippers[0], right: TABLE.flippers[1] };

function setFlipper(side: 'left' | 'right', pressed: boolean): void {
  const spec = flipperSpec[side];
  const target = pressed ? spec.activeAngle : spec.restAngle;
  if (flipperAngle[side] === target) return;
  flipperAngle[side] = target;
  setFlipperAngle(table.flippers[side], target);
}

const LEFT_KEYS = ['ArrowLeft', 'a', 'A'];
const RIGHT_KEYS = ['ArrowRight', 'd', 'D'];

window.addEventListener('keydown', (event) => {
  if (LEFT_KEYS.indexOf(event.key) >= 0) setFlipper('left', true);
  if (RIGHT_KEYS.indexOf(event.key) >= 0) setFlipper('right', true);
});
window.addEventListener('keyup', (event) => {
  if (LEFT_KEYS.indexOf(event.key) >= 0) setFlipper('left', false);
  if (RIGHT_KEYS.indexOf(event.key) >= 0) setFlipper('right', false);
});

window.addEventListener('resize', layout);

// ---------------------------------------------------------------------------
// 主循环与读数
// ---------------------------------------------------------------------------

const glVersion = gl ? String(gl.getParameter(gl.VERSION)) : 'three 自选';
const isWebGL2 = !!(renderer.capabilities as any).isWebGL2;

/** 读数写 DOM 有成本，每 15 帧刷一次足够看 */
const READOUT_INTERVAL = 15;
let frameCursor = 0;

function updateReadout(): void {
  if (frameCursor++ % READOUT_INTERVAL !== 0) return;

  const m = loop.metrics;
  const info = renderer.info.render;
  readout.textContent = [
    `${device.label} · ${screen.width}×${screen.height} @${screen.pixelRatio}x`,
    `GL ${glVersion}${isWebGL2 ? ' · WebGL2（真机不支持）' : ''} · three r${THREE.REVISION}`,
    `FPS ${m.fps.toFixed(1)} · 帧 ${m.frameMs.toFixed(1)}ms · 逻辑 ${m.stepsPerSecond.toFixed(0)}Hz`,
    `draw call ${info.calls} · 三角面 ${info.triangles}`,
    `俯角 ${view.elevation.toFixed(1)}° · 方位 ${view.azimuth.toFixed(0)}° · 缩放 ${view.scale.toFixed(2)}×`,
    `台面轮廓 ${TABLE.outline.length} 点 · 缓冲器 ${TABLE.bumpers.length} · 灯 0`,
  ].join('\n');
}

const loop = new Loop(
  {
    fixedUpdate(): void {
      // 预览里没有物理 —— 它的目的是看美术，不是玩
    },
    render(): void {
      renderer.render(sceneRig.scene, cameraRig.camera);
      updateReadout();
    },
  },
  1 / 120,
);

fitCamera();
applyView();
layout();
loop.start();

(window as any).__SC_PREVIEW__ = {
  renderer,
  scene: sceneRig.scene,
  camera: cameraRig.camera,
  table,
  loop,
  view,
};
