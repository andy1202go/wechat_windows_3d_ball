/**
 * 台面数据 → three.js 几何。
 *
 * 这份代码只做「读数据、造网格」，不含任何台面坐标的字面量——
 * 所有空间信息都在 data.ts 里，改台面只改那里。
 */

import * as THREE from 'three';
import {
  TABLE,
  planeBounds,
  wallSpecs,
  type FlipperSpec,
  type RectComponentSpec,
} from './data';
import { createCanvas2D, drawPlayfieldTexture, get2DContext, type TextureBounds } from '../render/texture';

/** 贴图分辨率。台面细长，宽度取 512 已足够，高度按比例。 */
const TEXTURE_WIDTH = 512;

export interface BuiltTable {
  group: THREE.Group;
  /** 球网格，M2 接管物理后每帧写它的位置 */
  ball: THREE.Mesh;
  /** 挡板网格，按 side 索引 */
  flippers: Record<string, THREE.Group>;
  dispose(): void;
}

interface Disposable {
  dispose(): void;
}

function track(list: Disposable[], resource: Disposable | null | undefined): void {
  if (resource) list.push(resource);
}

/**
 * 把几何体的 UV 重写成「逻辑平面的正交投影」。
 *
 * 必须在 rotateX 之前调用 —— 那时几何体还处在 shape 空间（x = 平面 x，y = 平面 y）。
 * ExtrudeGeometry 默认的 UV 是按世界坐标生成的，直接用会让贴图平铺错乱。
 */
function applyPlanarUV(geometry: THREE.BufferGeometry, bounds: TextureBounds): void {
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const uv = new Float32Array(position.count * 2);
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;

  for (let i = 0; i < position.count; i++) {
    uv[i * 2] = (position.getX(i) - bounds.minX) / spanX;
    uv[i * 2 + 1] = (position.getY(i) - bounds.minY) / spanY;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function buildPlayfieldBody(bounds: TextureBounds, disposables: Disposable[]): THREE.Mesh {
  const shape = new THREE.Shape(TABLE.outline.map((p) => new THREE.Vector2(p.x, p.y)));

  // ⚠️ three@0.117.0 的双命名坑（不是我们的用法问题，别「修」它）：
  // 这个版本里 BoxGeometry / ExtrudeGeometry 等短名字仍是**遗留 Geometry** 类
  // （只有 .vertices，没有 .attributes / .setAttribute），真正的 BufferGeometry 变体
  // 带 BufferGeometry 后缀。r125 之后才把两组名字合并。
  // 因为我们要手工写 UV，必须用 BufferGeometry 变体，所以全程使用 *BufferGeometry。
  const geometry = new THREE.ExtrudeBufferGeometry(shape, {
    depth: TABLE.bodyDepth,
    bevelEnabled: false,
  });

  applyPlanarUV(geometry, bounds);

  // 绕 X 轴 +90°：shape 空间 (px, py, ez) → 世界 (px, -ez, py)。
  // 于是挤出体占据 y ∈ [-bodyDepth, 0]，顶面正好落在 y = 0 —— 也就是球滚动的那一层。
  geometry.rotateX(Math.PI / 2);

  const texW = TEXTURE_WIDTH;
  const texH = Math.round((TEXTURE_WIDTH * (bounds.maxY - bounds.minY)) / (bounds.maxX - bounds.minX));
  const canvas = createCanvas2D(texW, texH);
  const ctx = get2DContext(canvas);
  drawPlayfieldTexture(ctx, texW, texH, bounds, {
    outline: TABLE.outline,
    launchLaneX: TABLE.launchLane.innerWallX,
  });

  const texture = new THREE.CanvasTexture(canvas);
  // 不翻转：让 canvas 的 y=0 对应逻辑平面的 y=0（拱顶一侧），
  // 否则整张台面的装饰会上下颠倒。
  texture.flipY = false;
  texture.needsUpdate = true;

  const material = new THREE.MeshPhongMaterial({
    map: texture,
    shininess: 24,
    specular: 0x334466,
    // 挤出体的顶/底盖法线方向取决于 shape 的绕向，这里不去赌绕向，
    // 直接双面渲染。台面只有这一块，代价可以忽略。
    side: THREE.DoubleSide,
  });

  track(disposables, geometry);
  track(disposables, material);
  track(disposables, texture);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'playfield-body';
  return mesh;
}

function buildWalls(disposables: Disposable[]): THREE.Group {
  const group = new THREE.Group();
  group.name = 'walls';

  const geometry = new THREE.BoxBufferGeometry(1, TABLE.wallHeight, TABLE.wallThickness);
  const material = new THREE.MeshPhongMaterial({
    color: 0x8d99ae,
    shininess: 60,
    specular: 0x99aacc,
  });
  track(disposables, geometry);
  track(disposables, material);

  // 「哪条边立墙」的判断只在 data.wallSpecs() 里做一次，物理那边消费同一份返回值。
  // 这里连发射航道隔墙都不再特殊处理 —— 它也是一条 from→to 的线段，
  // 按同样的方式算长度与倾角即可，少一处「知识」就少一处走形。
  for (const spec of wallSpecs()) {
    const dx = spec.to.x - spec.from.x;
    const dy = spec.to.y - spec.from.y;
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);

    const mesh = new THREE.Mesh(geometry, material);
    // 两端各补半个壁厚，让相邻围边在拐角处自然搭接
    mesh.scale.x = length + TABLE.wallThickness;
    mesh.position.set((spec.from.x + spec.to.x) / 2, TABLE.wallHeight / 2, (spec.from.y + spec.to.y) / 2);
    mesh.rotation.y = -angle;
    mesh.name = spec.id;
    group.add(mesh);
  }

  return group;
}

interface ComponentMaterials {
  bumper: THREE.Material;
  bumperCap: THREE.Material;
  dropTarget: THREE.Material;
  missionTarget: THREE.Material;
  rebound: THREE.Material;
  flipper: THREE.Material;
  plunger: THREE.Material;
}

function buildComponentMaterials(disposables: Disposable[]): ComponentMaterials {
  const make = (color: number, shininess: number, specular: number) => {
    const material = new THREE.MeshPhongMaterial({ color, shininess, specular });
    track(disposables, material);
    return material;
  };
  return {
    bumper: make(0x2f5fd0, 40, 0x88aaff),
    bumperCap: make(0xff9d3c, 90, 0xffddaa),
    dropTarget: make(0xf2b544, 70, 0xffe6b0),
    missionTarget: make(0xe2643c, 70, 0xffc4a8),
    rebound: make(0xb8c2d4, 60, 0xdde6f5),
    flipper: make(0xd6dbe6, 80, 0xffffff),
    plunger: make(0x4f6d9c, 40, 0x99bbee),
  };
}

function placeRect(
  group: THREE.Group,
  spec: RectComponentSpec,
  material: THREE.Material,
  height: number,
  depth: number,
  disposables: Disposable[],
): void {
  const geometry = new THREE.BoxBufferGeometry(spec.width, height, depth);
  track(disposables, geometry);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(spec.x, height / 2, spec.y);
  mesh.rotation.y = -(spec.angle * Math.PI) / 180;
  group.add(mesh);
}

function buildComponents(
  materials: ComponentMaterials,
  disposables: Disposable[],
): { group: THREE.Group; flippers: Record<string, THREE.Group> } {
  const group = new THREE.Group();
  group.name = 'components';

  // 缓冲器：柱体 + 顶盖，顶盖用亮色，视觉上像被点亮
  for (const bumper of TABLE.bumpers) {
    const bodyGeometry = new THREE.CylinderBufferGeometry(bumper.radius, bumper.radius, TABLE.wallHeight * 0.7, 20);
    track(disposables, bodyGeometry);
    const body = new THREE.Mesh(bodyGeometry, materials.bumper);
    body.position.set(bumper.x, (TABLE.wallHeight * 0.7) / 2, bumper.y);
    group.add(body);

    const capGeometry = new THREE.CylinderBufferGeometry(bumper.radius * 0.62, bumper.radius * 0.62, 0.8, 20);
    track(disposables, capGeometry);
    const cap = new THREE.Mesh(capGeometry, materials.bumperCap);
    cap.position.set(bumper.x, TABLE.wallHeight * 0.7 + 0.4, bumper.y);
    group.add(cap);
  }

  for (const target of TABLE.dropTargets) {
    placeRect(group, target, materials.dropTarget, 3.4, 2.4, disposables);
  }
  for (const target of TABLE.missionTargets) {
    placeRect(group, target, materials.missionTarget, 2.4, 2.0, disposables);
  }

  for (const rebound of TABLE.rebounds) {
    const geometry = new THREE.CylinderBufferGeometry(rebound.radius, rebound.radius, TABLE.wallHeight, 14);
    track(disposables, geometry);
    const mesh = new THREE.Mesh(geometry, materials.rebound);
    mesh.position.set(rebound.x, TABLE.wallHeight / 2, rebound.y);
    group.add(mesh);
  }

  placeRect(group, TABLE.plunger, materials.plunger, 3.0, TABLE.plunger.height, disposables);

  // 挡板：外层 group 放在轴心并承担旋转，内层网格沿 +x 偏移半个板长
  const flippers: Record<string, THREE.Group> = {};
  for (const spec of TABLE.flippers) {
    flippers[spec.side] = buildFlipper(spec, materials.flipper, disposables);
    group.add(flippers[spec.side]);
  }

  return { group, flippers };
}

function buildFlipper(spec: FlipperSpec, material: THREE.Material, disposables: Disposable[]): THREE.Group {
  const pivot = new THREE.Group();
  pivot.name = `flipper-${spec.side}`;
  pivot.position.set(spec.pivot.x, 0, spec.pivot.y);

  const geometry = new THREE.BoxBufferGeometry(spec.length, TABLE.wallHeight * 0.8, spec.radius * 2);
  track(disposables, geometry);

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(spec.length / 2, (TABLE.wallHeight * 0.8) / 2, 0);
  pivot.add(mesh);

  setFlipperAngle(pivot, spec.restAngle);
  return pivot;
}

/**
 * 设置挡板角度。角度约定见 data.ts：平面内自 +x 朝 +y 为正，
 * 而世界空间里绕 Y 轴旋转 φ 会把 +x 映射到 (cosφ, 0, -sinφ)，
 * 所以要取负号才能让平面的正角在视觉上表现为顺时针。
 */
export function setFlipperAngle(pivot: THREE.Group, angleDeg: number): void {
  pivot.rotation.y = -(angleDeg * Math.PI) / 180;
}

export function buildTable(): BuiltTable {
  const disposables: Disposable[] = [];
  const bounds = planeBounds();
  const textureBounds: TextureBounds = bounds;

  const group = new THREE.Group();
  group.name = 'table';

  group.add(buildPlayfieldBody(textureBounds, disposables));
  group.add(buildWalls(disposables));

  const materials = buildComponentMaterials(disposables);
  const components = buildComponents(materials, disposables);
  group.add(components.group);

  // 球：M1 只是静态摆在台面上，用来核对斜俯视下的透视比例
  const ballGeometry = new THREE.SphereBufferGeometry(TABLE.ballRadius, 24, 16);
  const ballMaterial = new THREE.MeshPhongMaterial({
    color: 0xe8edf5,
    shininess: 240,
    specular: 0xffffff,
  });
  track(disposables, ballGeometry);
  track(disposables, ballMaterial);
  const ball = new THREE.Mesh(ballGeometry, ballMaterial);
  ball.name = 'ball';
  ball.position.set(TABLE.ballStart.x, TABLE.ballRadius, TABLE.ballStart.y);
  group.add(ball);

  return {
    group,
    ball,
    flippers: components.flippers,
    dispose() {
      for (const resource of disposables) resource.dispose();
      disposables.length = 0;
    },
  };
}
