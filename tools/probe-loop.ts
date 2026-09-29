/**
 * 临时探针：定位主循环步数漂移。
 *
 * 已知：不跑前置步骤 → 精确 598 步；跑完 buildTable/相机等前置步骤 → 586~590。
 * 本探针打印每帧步数分布与前若干帧明细，找出差异出在哪一帧。
 */

import './mock-env';
import { clock, pumpRaf } from './mock-env';
import '../src/env/polyfill';
import * as THREE from 'three';
import { Loop } from '../src/core/loop';
import { createCameraRig } from '../src/render/camera';
import { createScene } from '../src/render/scene';
import { TABLE, fitPoints } from '../src/table/data';
import { buildTable } from '../src/table/geometry';

const withPreamble = process.argv.indexOf('--preamble') >= 0;

if (withPreamble) {
  const built = buildTable();
  const sceneRig = createScene();
  sceneRig.scene.add(built.group);
  const subject = fitPoints().map((point) => new THREE.Vector3(point.x, point.y, point.z));
  const rig = createCameraRig(393 / 852);
  rig.target.set(0, 0, TABLE.length / 2);
  rig.fit(subject, 393 / 852);
}

const STEP = 1 / 120;
const frameMs = 1000 / 60;

let steps = 0;
let perFrame = 0;
const hist: Record<number, number> = {};
const detail: string[] = [];

const loop = new Loop(
  {
    fixedUpdate(): void {
      steps++;
      perFrame++;
    },
    render(): void {},
  },
  STEP,
);

clock.now = 0;
loop.start();
hist[perFrame] = (hist[perFrame] || 0) + 1;

for (let i = 1; i <= 299; i++) {
  perFrame = 0;
  clock.advance(frameMs);
  pumpRaf();
  hist[perFrame] = (hist[perFrame] || 0) + 1;
  if (i <= 12) detail.push(`  帧 ${String(i).padStart(3)} 步 ${perFrame}`);
}

console.log(`前置步骤: ${withPreamble ? '有' : '无'}`);
console.log(detail.join('\n'));
console.log('  每帧步数分布: ' + Object.keys(hist).sort().map((k) => `${k}步×${hist[Number(k)]}`).join('  '));
console.log(`  合计 ${steps} 步（期望 598） · 帧数 ${loop.metrics.frames} · 丢弃 ${loop.metrics.droppedSteps}`);
loop.stop();
