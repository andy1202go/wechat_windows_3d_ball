/**
 * 场景与灯光。
 *
 * 用的是 MeshPhongMaterial 而不是 Standard —— WebGL 1 走的是软件/受限管线，
 * 移动端 PBR 的代价不划算，而弹球台要的是金属高光，Phong 更便宜也更好看。
 */

import * as THREE from 'three';

export interface SceneRig {
  scene: THREE.Scene;
  dispose(): void;
}

export function createScene(): SceneRig {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x070b14);

  // 环境光兜底，避免背光面全黑
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambient);

  // 主光：从远端上方打下来，让台面的上窄下宽梯形产生明暗层次
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(-70, 150, 130);
  scene.add(key);

  // 补光：冷色，从玩家端后方压边，把围边轮廓勾出来
  const fill = new THREE.DirectionalLight(0x7ea6ff, 0.4);
  fill.position.set(90, 80, -120);
  scene.add(fill);

  // 暖色点缀，呼应原版的橙色灯组
  const accent = new THREE.PointLight(0xff9d3c, 0.45, 420);
  accent.position.set(0, 55, 20);
  scene.add(accent);

  return {
    scene,
    dispose(): void {
      for (const child of scene.children.slice()) scene.remove(child);
    },
  };
}
