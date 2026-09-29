/**
 * 主循环：固定步长驱动逻辑，渲染与逻辑解耦。
 *
 * 这两件事必须分开（见 docs/adr/0002、docs/adr/0003）：
 * 物理跑固定步长才有可复现的手感，且球速再高也不会因为某一帧变长而穿透薄壁；
 * 渲染跟着屏幕刷新率走，逻辑不跟着渲染帧率漂移。
 */

export interface LoopHooks {
  /** 固定步长逻辑更新，dt 恒为 step 秒 */
  fixedUpdate(dt: number): void;
  /** 渲染，alpha 为当前时刻在两次逻辑步之间的插值系数 */
  render(alpha: number): void;
}

export interface LoopMetrics {
  /** 最近一秒实际渲染帧率 */
  fps: number;
  /** 最近一帧耗时（毫秒） */
  frameMs: number;
  /** 最近一秒执行的逻辑步数 */
  stepsPerSecond: number;
  /** 因单帧过长被丢弃的逻辑步数累计，用来暴露卡顿 */
  droppedSteps: number;
  /** 渲染总帧数 */
  frames: number;
}

/** 单帧最多补算的逻辑步数。超过就丢弃余量，避免卡顿后出现「死亡螺旋」。 */
const MAX_STEPS_PER_FRAME = 8;

/** 帧率与步频的统计窗口（帧） */
const METRIC_WINDOW = 30;

export class Loop {
  private rafId = 0;
  private running = false;
  private lastTime = 0;
  private accumulator = 0;

  private frameTimeSum = 0;
  private stepCountInWindow = 0;
  private windowFrames = 0;

  readonly metrics: LoopMetrics = {
    fps: 0,
    frameMs: 0,
    stepsPerSecond: 0,
    droppedSteps: 0,
    frames: 0,
  };

  constructor(private readonly hooks: LoopHooks, private readonly step: number = 1 / 120) {}

  get timestep(): number {
    return this.step;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.tick(this.lastTime);
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);

    const elapsedMs = now - this.lastTime;
    this.lastTime = now;

    // 单帧时间上限 250ms：切后台回来、系统弹窗之后会有巨大的 delta，
    // 不夹住会一次性补算上千步，直接卡死。
    const frameSeconds = Math.min(elapsedMs / 1000, 0.25);

    this.accumulator += frameSeconds;

    let steps = 0;
    while (this.accumulator >= this.step) {
      if (steps >= MAX_STEPS_PER_FRAME) {
        this.metrics.droppedSteps += Math.floor(this.accumulator / this.step);
        this.accumulator = 0;
        break;
      }
      this.hooks.fixedUpdate(this.step);
      this.accumulator -= this.step;
      steps++;
    }

    this.hooks.render(this.accumulator / this.step);

    this.metrics.frames++;
    this.frameTimeSum += elapsedMs;
    this.stepCountInWindow += steps;
    this.windowFrames++;
    if (this.windowFrames >= METRIC_WINDOW) {
      this.metrics.frameMs = this.frameTimeSum / this.windowFrames;
      this.metrics.fps = this.metrics.frameMs > 0 ? 1000 / this.metrics.frameMs : 0;
      this.metrics.stepsPerSecond = (this.stepCountInWindow * 1000) / this.frameTimeSum;
      this.frameTimeSum = 0;
      this.stepCountInWindow = 0;
      this.windowFrames = 0;
    }
  };
}
