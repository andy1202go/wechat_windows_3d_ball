/**
 * 竖屏固定斜俯视相机（docs/adr/0006）。
 *
 * 核心约束：**相机角度恒定，只有距离随视口变化**。
 * 台面的浮雕高度、组件之间的遮挡关系都是针对这个角度设计的，一旦允许改变角度，
 * 这些设计就会在多角度下失效。
 */

import * as THREE from 'three';

/** 俯角：视线与水平面的夹角。这是个设计常量，改动等于重做台面。 */
export const CAMERA_ELEVATION_DEG = 62;

/** 竖直视场角 */
export const CAMERA_FOV_DEG = 45;

/** 适配后留的边距比例，避免台面紧贴屏幕边缘 */
const DEFAULT_MARGIN = 0.04;

/** 二分迭代次数。24 次足以把距离收敛到亚像素级别。 */
const FIT_ITERATIONS = 24;

const DEG = Math.PI / 180;

export interface CameraRig {
  camera: THREE.PerspectiveCamera;
  /** 注视点。改动它等于改构图，通常只在启动时设一次。 */
  readonly target: THREE.Vector3;
  /**
   * 在固定俯角下前后移动相机，使给定的世界坐标点集全部落进视口。
   *
   * 为什么用二分求解而不是解析公式：台面是一块有纵深的斜置平面，近端比远端
   * 离相机近得多，用「长度 × sin(俯角)」估算竖直投影量会系统性低估
   * （实测 NDC 会冲到 1.19，也就是近端被裁掉约 19%）。直接对真实投影做二分
   * 既准确，又不依赖任何近似，台面轮廓变化时自动仍然正确。
   */
  fit(subject: THREE.Vector3[], aspect: number, margin?: number): void;
  /** 当前实际俯角（度），用于自检 */
  elevationDeg(): number;
  /** 注视点到相机的距离 */
  distance(): number;
}

export function createCameraRig(aspect: number): CameraRig {
  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, aspect, 1, 4000);
  const target = new THREE.Vector3(0, 0, 0);

  // 从注视点指向相机的单位方向：抬高 elevation，并落在玩家一侧（+z）
  const direction = new THREE.Vector3(0, Math.sin(CAMERA_ELEVATION_DEG * DEG), Math.cos(CAMERA_ELEVATION_DEG * DEG)).normalize();

  const probe = new THREE.Vector3();

  /** 把相机放到指定距离后，返回所有测试点在 NDC 下的最大绝对值（1 即刚好贴边） */
  function worstNdc(distance: number, subject: THREE.Vector3[]): number {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld(true);

    let worst = 0;
    for (const point of subject) {
      probe.copy(point).project(camera);
      worst = Math.max(worst, Math.abs(probe.x), Math.abs(probe.y));
    }
    return worst;
  }

  return {
    camera,
    target,

    fit(subject, aspect, margin = DEFAULT_MARGIN): void {
      camera.aspect = aspect;
      camera.updateProjectionMatrix();

      const limit = 1 - margin;

      // 先把上界推到一个确定够远的距离
      let high = 10;
      for (let i = 0; i < 48 && worstNdc(high, subject) > limit; i++) {
        high *= 1.5;
      }
      let low = high / 1.5;

      for (let i = 0; i < FIT_ITERATIONS; i++) {
        const mid = (low + high) / 2;
        if (worstNdc(mid, subject) > limit) low = mid;
        else high = mid;
      }

      camera.position.copy(target).addScaledVector(direction, high);
      camera.lookAt(target);
      camera.updateMatrixWorld(true);
    },

    elevationDeg(): number {
      const dy = camera.position.y - target.y;
      const dz = camera.position.z - target.z;
      return (Math.atan2(dy, Math.abs(dz)) / DEG);
    },

    distance(): number {
      return camera.position.distanceTo(target);
    },
  };
}
