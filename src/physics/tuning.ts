/**
 * 物理手感参数，集中在一处（docs/adr/0003 明确要求）。
 *
 * 这些数值就是「手感」本身。任何调校都只改这个文件，不要在求解器里写魔法数字。
 * 每个值都标注了它朝哪个方向影响手感，便于盲调时判断该往哪边拧。
 */

export interface Tuning {
  /** 等效重力（沿 +y，即朝向玩家端）。逻辑平面是俯视的，这个值用来模拟台面倾斜 */
  gravityY: number;
  /** 线速度阻尼系数（1/秒）。模拟滚动摩擦，同时决定自由滚动的终速 = gravityY / linearDamping */
  linearDamping: number;
  /** 球速上限，纯粹是数值安全阀，防止异常输入导致速度爆炸 */
  maxBallSpeed: number;

  /** 围边恢复系数。调高 → 球撞击后更「脆」，滚得更久 */
  wallRestitution: number;
  /** 围边切向摩擦。调高 → 球贴着墙滑行时减速更明显 */
  wallFriction: number;

  /** 缓冲器恢复系数 */
  bumperRestitution: number;
  /** 缓冲器被撞后额外施加的外推速度（原版是电磁铁，会主动把球弹出） */
  bumperKick: number;
  /** 缓冲器重复计分的冷却时间（秒），避免同一串接触被算成多次命中 */
  bumperCooldown: number;

  /** 反弹器恢复系数 */
  reboundRestitution: number;

  /** 挡板恢复系数。挡板偏软，否则球在板上会弹个不停 */
  flipperRestitution: number;
  /** 挡板切向摩擦 */
  flipperFriction: number;
  /** 挡板最大角速度（度/秒）。这是「拍击力度」的主要来源 */
  flipperAngularSpeed: number;

  /**
   * 恢复系数阈值（速度绝对值）。低于它的接触按完全非弹性处理。
   *
   * 这条是消除静止抖动的关键：球停在挡板上时每个子步都会被重力压入接触，
   * 若照常按恢复系数反弹，球会持续微跳。低于阈值就只做位置修正、不回弹。
   */
  restitutionThreshold: number;

  /** 单个物理步允许的最大子步数 */
  maxSubsteps: number;
  /** 每个子步允许的最大位移，单位是球半径的倍数。越小越不会穿透，代价是更耗算力 */
  substepTravelRatio: number;
}

export const DEFAULT_TUNING: Tuning = {
  gravityY: 120,
  linearDamping: 0.4,
  maxBallSpeed: 700,

  wallRestitution: 0.94,
  wallFriction: 0.02,

  bumperRestitution: 0.88,
  bumperKick: 55,
  bumperCooldown: 0.12,

  reboundRestitution: 0.95,

  flipperRestitution: 0.72,
  flipperFriction: 0.05,
  flipperAngularSpeed: 900,

  restitutionThreshold: 12,

  maxSubsteps: 24,
  substepTravelRatio: 0.35,
};

/** 供测试使用的「无耗散」参数：去掉重力与阻尼，恢复系数取 1，用来验证求解器本身不吞能量。 */
export const LOSSLESS_TUNING: Tuning = {
  ...DEFAULT_TUNING,
  gravityY: 0,
  linearDamping: 0,
  wallRestitution: 1,
  wallFriction: 0,
  bumperRestitution: 1,
  bumperKick: 0,
  reboundRestitution: 1,
  flipperRestitution: 1,
  flipperFriction: 0,
  restitutionThreshold: 0,
};
