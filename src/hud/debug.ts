/**
 * 自绘调试面板。
 *
 * 小游戏没有 WXML，所有 UI 都只能自己画（docs/adr/0001 的直接后果）。
 * 这里用「贴在相机前方的平面 + CanvasTexture」实现屏幕固定浮层——
 * 这套做法就是后续计分板与结算页要复用的方案，M1 先把管线跑通。
 */

import * as THREE from 'three';
import { createCanvas2D, get2DContext } from '../render/texture';

const PANEL_WIDTH = 512;
const PANEL_HEIGHT = 256;

/** 面板距相机的固定距离（世界单位），缩放由它和 fov 共同决定 */
const PLANE_DISTANCE = 100;

/** 重绘节流：贴图上传不便宜，调试信息没必要每秒重画 60 次 */
const REDRAW_INTERVAL_MS = 250;

export class DebugPanel {
  readonly object: THREE.Mesh;

  private readonly canvas: any;
  private readonly ctx: any;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.PlaneBufferGeometry;
  private readonly material: THREE.MeshBasicMaterial;
  private lastDrawAt = 0;
  private pendingLines: string[] | null = null;

  constructor(camera: THREE.PerspectiveCamera) {
    this.canvas = createCanvas2D(PANEL_WIDTH, PANEL_HEIGHT);
    this.ctx = get2DContext(this.canvas);

    this.texture = new THREE.CanvasTexture(this.canvas);
    // 保持默认 flipY = true：这样 canvas 的第一行会出现在平面的顶部。
    // （台面贴图用的是 flipY = false，因为那边要跟逻辑平面的 y 轴对齐，方向相反。）
    this.texture.needsUpdate = true;

    this.geometry = new THREE.PlaneBufferGeometry(1, 1);
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      // 调试面板必须永远盖在最上层，所以关掉深度测试并提高渲染顺序
      depthTest: false,
      depthWrite: false,
    });

    this.object = new THREE.Mesh(this.geometry, this.material);
    this.object.renderOrder = 999;
    this.object.frustumCulled = false;
    // 挂在相机下方，随相机移动，因此恒定占据屏幕同一位置
    camera.add(this.object);
  }

  /** 按当前视口重新摆放。只依赖 fov 与 aspect，与相机角度无关。 */
  layout(camera: THREE.PerspectiveCamera, aspect: number): void {
    const visibleHeight = 2 * PLANE_DISTANCE * Math.tan(((camera.fov / 2) * Math.PI) / 180);
    const visibleWidth = visibleHeight * aspect;

    const height = visibleHeight * 0.3;
    const width = height * (PANEL_WIDTH / PANEL_HEIGHT);

    this.object.scale.set(width, height, 1);

    const marginX = visibleWidth * 0.04;
    const marginY = visibleHeight * 0.03;

    this.object.position.set(
      -visibleWidth / 2 + marginX + width / 2,
      visibleHeight / 2 - marginY - height / 2,
      -PLANE_DISTANCE,
    );
  }

  /** 请求刷新内容。内部按 REDRAW_INTERVAL_MS 节流，可以每帧调用。 */
  setLines(lines: string[]): void {
    const now = performance.now();
    if (now - this.lastDrawAt < REDRAW_INTERVAL_MS) {
      // 记下最新内容，等下次允许重绘时再画，避免丢掉最后一次状态
      this.pendingLines = lines;
      return;
    }
    this.pendingLines = null;
    this.lastDrawAt = now;
    this.draw(lines);
  }

  /** 强制刷新，用于启动阶段把第一屏信息立刻画出来 */
  flush(lines: string[]): void {
    this.lastDrawAt = performance.now();
    this.pendingLines = null;
    this.draw(lines);
  }

  private draw(lines: string[]): void {
    const ctx = this.ctx;

    ctx.clearRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);

    ctx.fillStyle = 'rgba(6,10,20,0.78)';
    ctx.fillRect(0, 0, PANEL_WIDTH, PANEL_HEIGHT);
    ctx.strokeStyle = 'rgba(140,190,255,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, PANEL_WIDTH - 3, PANEL_HEIGHT - 3);

    ctx.font = '22px monospace';
    ctx.textBaseline = 'top';

    const lineHeight = 26;
    let y = 14;
    for (const line of lines) {
      // 以 "!" 开头表示告警行，用暖色显示
      ctx.fillStyle = line.charAt(0) === '!' ? '#ffb04a' : '#cfe0ff';
      ctx.fillText(line, 14, y);
      y += lineHeight;
    }

    this.texture.needsUpdate = true;
  }

  /** 供 update 阶段调用：如果内容在节流期间被丢弃，这里补画 */
  tick(): void {
    if (this.pendingLines) {
      const lines = this.pendingLines;
      this.pendingLines = null;
      this.lastDrawAt = performance.now();
      this.draw(lines);
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
