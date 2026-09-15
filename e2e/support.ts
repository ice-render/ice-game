import { expect, type Page } from '@playwright/test';

/**
 * e2e 公共件：错误收集、像素统计、画布坐标换算。
 *
 * 三个页面都是**整屏画布应用**，DOM 里只有一个 `<canvas>`，所以断言只能落在
 * 「画布上真的有东西」与「真按键 / 真鼠标之后状态真的变了」这两件事上。
 * 这也是本仓 e2e 的判据口径：只有像素、或只有状态、或只有 URL，都可能"看起来通过其实没验证"。
 */

/** 收集 pageerror 与 console error；用例收尾断言它是空的。 */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`.slice(0, 300)));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`.slice(0, 300));
  });
  return errors;
}

export interface CanvasStats {
  width: number;
  height: number;
  /** 画上去的像素占比（`alpha >= 8`）。画布默认透明，不算这一条的话"背景色也算内容"。 */
  opaqueRatio: number;
  /** 画上去**且与主色明显不同**的像素占比 —— 只刷一层底色的空画布在这里会露馅。 */
  inkRatio: number;
  /** 不同颜色数：纹理/文字越多越大，用来区分"画了块底色"和"画了界面"。 */
  colors: number;
}

/** 采样统计画布内容。采样步长按面积自适应（约 1/16384 像素量级），够快也够稳。 */
export async function canvasStats(page: Page, index = 0): Promise<CanvasStats> {
  return page.evaluate((idx) => {
    const canvas = document.querySelectorAll('canvas')[idx] as HTMLCanvasElement;
    if (!canvas) throw new Error(`页面上没有第 ${idx + 1} 张画布`);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('拿不到 2d context');
    const { width, height } = canvas;
    const data = ctx.getImageData(0, 0, width, height).data;
    const total = width * height;
    const step = Math.max(1, Math.round(Math.sqrt(total / 16384)));
    const stride = step * 4;

    const counts = new Map<string, number>();
    const samples: string[] = [];
    let sampled = 0;
    for (let p = 0; p < total; p += step) {
      sampled += 1;
      const i = p * 4;
      if (data[i + 3] < 8) continue;
      const key = `${data[i]},${data[i + 1]},${data[i + 2]}`;
      samples.push(key);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    let modal = '0,0,0';
    let modalCount = 0;
    for (const [key, count] of counts) {
      if (count > modalCount) {
        modal = key;
        modalCount = count;
      }
    }
    const [mr, mg, mb] = modal.split(',').map(Number);
    let ink = 0;
    for (const key of samples) {
      const [r, g, b] = key.split(',').map(Number);
      if (Math.abs(r - mr) > 24 || Math.abs(g - mg) > 24 || Math.abs(b - mb) > 24) ink += 1;
    }

    return {
      width,
      height,
      opaqueRatio: sampled ? samples.length / sampled : 0,
      inkRatio: samples.length ? ink / samples.length : 0,
      colors: counts.size,
    };
  }, index);
}

/**
 * 画布内部坐标 → 页面坐标。
 * 引擎按 `dpr` 把 backing store 放大过，所以不能直接拿内部坐标当 CSS 坐标点。
 */
export async function canvasPoint(page: Page, x: number, y: number, index = 0) {
  const box = await page.locator('canvas').nth(index).boundingBox();
  if (!box) throw new Error('画布还没有布局盒子');
  const size = await page.evaluate((idx) => {
    const canvas = document.querySelectorAll('canvas')[idx] as HTMLCanvasElement;
    return { width: canvas.width, height: canvas.height };
  }, index);
  return { x: box.x + (x * box.width) / size.width, y: box.y + (y * box.height) / size.height };
}

/** 点画布上的一个**内部坐标**点（自动换算成页面坐标）。 */
export async function clickCanvas(page: Page, x: number, y: number, index = 0) {
  const point = await canvasPoint(page, x, y, index);
  await page.mouse.click(point.x, point.y);
}

/** 双击画布上的一个内部坐标点（桌面图标靠双击打开）。 */
export async function dblclickCanvas(page: Page, x: number, y: number, index = 0) {
  const point = await canvasPoint(page, x, y, index);
  await page.mouse.dblclick(point.x, point.y);
}

/**
 * 注入 `window.__rect(node)`：沿 `parentNode` 累加 `left/top` 得到**世界坐标**（相对画布）。
 *
 * 必须在 `goto` 之前 `addInitScript`。上游两个游戏页是从上游**逐字**抽取的，不能为了测试
 * 往里塞调试函数 —— 于是把这段走坐标的逻辑放在测试侧注入。
 *
 * 终止条件是 `cursor.state` 而不是 `cursor`：`ICE` 实例本身没有 `state`，
 * 写成 `while (cursor) { … }` 会在根上读 `state.left` 直接崩。
 */
export const RECT_HELPER = `
window.__rect = function (node) {
  let left = 0;
  let top = 0;
  let cursor = node;
  while (cursor && cursor.state) {
    left += cursor.state.left || 0;
    top += cursor.state.top || 0;
    cursor = cursor.parentNode;
  }
  return { left: left, top: top, width: (node.state && node.state.width) || 0, height: (node.state && node.state.height) || 0 };
};
`;

/**
 * 断言"画布上确实画出了界面"，而不是一片空白。
 *
 * @param minInk   与主色明显不同的像素占比下限（实测正常页面 0.5%~70%）
 * @param minOpaque 画上去的像素占比下限。**默认 0.5 只适用于"铺满画布"的页面**
 *   （整机、游戏页都有全屏底色或全屏遮罩）。像游戏厅首页那样"画布透明、只画卡片"的版面，
 *   卡片本身只占画布面积的两三成，必须把这个值调低 —— 否则断言会因为"版面留白"而误报。
 */
export async function expectCanvasPainted(
  page: Page,
  minInk = 0.02,
  options: { minOpaque?: number; index?: number } = {},
) {
  const minOpaque = options.minOpaque ?? 0.5;
  const stats = await canvasStats(page, options.index ?? 0);
  expect(stats.opaqueRatio, '画上去的像素占比（画布默认透明）').toBeGreaterThan(minOpaque);
  expect(stats.inkRatio, `与主色不同的像素占比，实测 ${stats.inkRatio.toFixed(4)}`).toBeGreaterThan(minInk);
  expect(stats.colors, '不同颜色数').toBeGreaterThan(8);
  return stats;
}
