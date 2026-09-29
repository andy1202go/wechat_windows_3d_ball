/**
 * 小游戏入口。
 *
 * M1 的目标只有一个：**在小游戏真机上把 three.js r117 + WebGL 1 渲染跑通**
 * （docs/plan.md 的阻断项）。因此这里不写任何玩法逻辑，只做四件事：
 *   1. 显式取 WebGL 1 上下文并交给 three
 *   2. 用台面数据生成几何，验证「数据 → 几何」管线
 *   3. 用固定斜俯视相机把台面框进竖屏
 *   4. 挂一个自绘调试面板 + 挡板触摸预览，让真机验证能一次看到全部关键信息
 */

import * as THREE from 'three';
import { Loop } from './core/loop';
import { readScreen } from './core/screen';
import { DebugPanel } from './hud/debug';
import { createCameraRig } from './render/camera';
import { createScene } from './render/scene';
import { TABLE, fitPoints, wallSegments } from './table/data';
import { buildTable, setFlipperAngle } from './table/geometry';

function fatal(message: string, detail?: unknown): void {
  console.error('[space-cadet] ' + message, detail);
  try {
    wx.showModal({ title: '启动失败', content: message, showCancel: false });
  } catch (err) {
    // 开发者工具与真机都支持 showModal，但启动期的极端情况下可能不可用，
    // 此时只剩下 console 日志
  }
}

function boot(): void {
  const screen = readScreen();
  const canvas: any = (GameGlobal as any).canvas;
  if (!canvas) {
    fatal('未找到屏幕 canvas，polyfill 可能没先于 app 执行');
    return;
  }

  // 显式取 WebGL 1 上下文再交给 three，而不是让 three 自己去挑。
  // 这是 docs/adr/0004 的落地方式：不依赖 three 版本的默认行为，
  // 因为 r118 之后 WebGLRenderer 会优先申请 WebGL 2，而微信真机对 WebGL 2
  // 支持不完整，会出现「开发者工具正常、真机异常」。
  //
  // powerPreference 取 default、failIfMajorPerformanceCaveat 取 false：
  // 在部分移动 GPU 上 high-performance + 严格性能门槛会导致上下文创建直接失败。
  const gl: WebGLRenderingContext | null = canvas.getContext('webgl', {
    alpha: false,
    depth: true,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
    powerPreference: 'default',
    failIfMajorPerformanceCaveat: false,
  });

  if (!gl) {
    fatal('WebGL 1 上下文创建失败，无法继续');
    return;
  }

  const renderer = new THREE.WebGLRenderer({ canvas, context: gl, antialias: false });
  renderer.setPixelRatio(screen.pixelRatio);
  // 第三个参数 updateStyle 传 false：小游戏 canvas 的 style 只是个空壳，写它无意义
  renderer.setSize(screen.width, screen.height, false);
  renderer.setClearColor(0x070b14, 1);

  const sceneRig = createScene();

  // 注视点取台面逻辑中心；适配只沿固定俯角前后移动相机，不改角度（ADR-0006）
  const cameraRig = createCameraRig(screen.aspect);
  cameraRig.target.set(0, 0, TABLE.length / 2);
  const subject = fitPoints().map((p) => new THREE.Vector3(p.x, p.y, p.z));
  cameraRig.fit(subject, screen.aspect);
  sceneRig.scene.add(cameraRig.camera);

  const table = buildTable();
  sceneRig.scene.add(table.group);

  const panel = new DebugPanel(cameraRig.camera);
  panel.layout(cameraRig.camera, screen.aspect);

  // ---------------------------------------------------------------------------
  // 挡板触摸预览
  //
  // 完整的左右半屏热区是 M4 的内容，这里只做最小实现：按屏幕中线左右分区，
  // 目的是在真机上验证「触摸 → 视觉反馈」这条链路是通的。
  // ---------------------------------------------------------------------------
  const flipperAngle: Record<string, number> = {
    left: TABLE.flippers[0].restAngle,
    right: TABLE.flippers[1].restAngle,
  };

  const flipperSpec = { left: TABLE.flippers[0], right: TABLE.flippers[1] };

  const applyTouch = (touches: any[]): void => {
    const active = { left: false, right: false };
    for (const touch of touches || []) {
      const x = touch.clientX;
      if (typeof x !== 'number') continue;
      if (x < screen.width / 2) active.left = true;
      else active.right = true;
    }
    for (const side of ['left', 'right']) {
      const spec = flipperSpec[side as 'left' | 'right'];
      const target = active[side as 'left' | 'right'] ? spec.activeAngle : spec.restAngle;
      if (flipperAngle[side] !== target) {
        flipperAngle[side] = target;
        setFlipperAngle(table.flippers[side], target);
      }
    }
  };

  wx.onTouchStart((event: any) => applyTouch(event.touches));
  wx.onTouchMove((event: any) => applyTouch(event.touches));
  wx.onTouchEnd((event: any) => applyTouch(event.touches));
  wx.onTouchCancel(() => applyTouch([]));

  // ---------------------------------------------------------------------------
  // 调试信息
  // ---------------------------------------------------------------------------

  const device = (GameGlobal as any).__SC_DEVICE__ || {};
  const glVersion = String(gl.getParameter(gl.VERSION));
  const isWebGL2 = !!(renderer.capabilities as any).isWebGL2;
  const wallCount = wallSegments().length;

  const buildLines = (): string[] => {
    const m = loop.metrics;
    return [
      `three r${THREE.REVISION} · ${device.model || device.platform || 'unknown'}`,
      `GL: ${glVersion}`,
      `WebGL2: ${isWebGL2 ? 'YES !异常' : 'no'}`,
      `屏 ${screen.width}x${screen.height} @${screen.pixelRatio}x (${screen.aspect.toFixed(2)})`,
      `FPS ${m.fps.toFixed(1)} · 帧 ${m.frameMs.toFixed(1)}ms · 逻辑 ${m.stepsPerSecond.toFixed(0)}Hz`,
      `丢弃步 ${m.droppedSteps} · 帧数 ${m.frames}`,
      `台面 ${TABLE.outline.length} 点 · 墙 ${wallCount} 段 · 缓冲器 ${TABLE.bumpers.length}`,
      `相机 俯角 ${cameraRig.elevationDeg().toFixed(2)}° · 距 ${cameraRig.distance().toFixed(0)} · FOV ${cameraRig.camera.fov}°`,
      `触摸左右半屏可看到挡板动作`,
    ];
  };

  // ---------------------------------------------------------------------------
  // 主循环
  // ---------------------------------------------------------------------------

  const loop = new Loop(
    {
      fixedUpdate(): void {
        // M1 无物理。M2 在这里接入定步长物理步进。
      },
      render(): void {
        panel.setLines(buildLines());
        panel.tick();
        renderer.render(sceneRig.scene, cameraRig.camera);
      },
    },
    1 / 120,
  );

  // 切后台时停掉循环：不停会持续耗电，而且 rAF 在后台本身也被节流，
  // 恢复时累积的 delta 会造成一次大跳步
  wx.onHide(() => loop.stop());
  wx.onShow(() => loop.start());

  // 折叠屏、旋转、分屏都会改变视口比例，必须重算相机距离。
  // 注意这里只重算距离，不碰俯角。
  if (typeof wx.onWindowResize === 'function') {
    wx.onWindowResize((res: any) => {
      const next = res && res.size ? res.size.windowWidth / res.size.windowHeight : screen.aspect;
      cameraRig.camera.aspect = next;
      cameraRig.fit(subject, next);
      panel.layout(cameraRig.camera, next);
    });
  }

  panel.flush(buildLines());
  loop.start();

  // 方便在开发者工具控制台里直接查
  (GameGlobal as any).__SC__ = { renderer, scene: sceneRig.scene, camera: cameraRig.camera, table, loop, screen };
  console.log('[space-cadet] M1 启动完成');
}

boot();
