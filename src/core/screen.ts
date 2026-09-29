/**
 * 屏幕与画布度量。
 *
 * cssWidth/cssHeight 用逻辑像素（px），触摸事件的坐标也是这套单位，
 * 两者必须一致，否则竖屏热区会整体偏移。
 */

/** 像素比上限。真机 3x/4x 屏上让 WebGL 按物理像素渲染会直接把帧率打崩。 */
const MAX_PIXEL_RATIO = 2;

export interface ScreenMetrics {
  /** 逻辑像素宽，等同 windowWidth */
  width: number;
  /** 逻辑像素高，等同 windowHeight */
  height: number;
  /** 已夹取上限的像素比 */
  pixelRatio: number;
  /** width / height */
  aspect: number;
  /** 刘海/灵动岛区域高度（逻辑像素），HUD 需避开 */
  safeTop: number;
  /** 底部手势条区域高度（逻辑像素） */
  safeBottom: number;
}

export function readScreen(): ScreenMetrics {
  const sys = (typeof GameGlobal !== 'undefined' ? (GameGlobal as any).__SC_DEVICE__ : null) ?? wx.getSystemInfoSync();

  const width = sys.windowWidth;
  const height = sys.windowHeight;
  const pixelRatio = Math.min(sys.pixelRatio || 1, MAX_PIXEL_RATIO);

  // safeArea 是相对屏幕的，而窗口可能不是全屏；这里只取上下留白的高度差，
  // 避免把状态栏偏移量错当成窗口内偏移。
  const safeArea = sys.safeArea;
  const screenH = sys.screenHeight || height;
  const safeTop = safeArea ? Math.max(0, safeArea.top) : 0;
  const safeBottom = safeArea ? Math.max(0, screenH - safeArea.bottom) : 0;

  return {
    width,
    height,
    pixelRatio,
    aspect: width / height,
    safeTop,
    safeBottom,
  };
}
