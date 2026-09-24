import { expect, test } from '@playwright/test';
import { entryPages } from '../src/domain/catalog';
import { EFFECTS_CANVAS, MAIN_CANVAS, collectErrors } from './support';

/**
 * **高分屏（dpr = 2）门禁**。
 *
 * ## 为什么需要单独一档
 *
 * 本仓其它 e2e 与两个截图脚本都跑在 `deviceScaleFactor: 1`（见 `playwright.config.ts`），
 * 而引擎的 dpr 分支**只在 dpr > 1 时执行**：它会读画布当时的 CSS 尺寸，把 backing store
 * 放大成 `css × dpr`，并把 CSS 尺寸写成内联样式。
 *
 * 于是"应用层在 init 之后自己写 `canvas.width/height`"这条路径在 dpr=1 下完全无害
 * （没有内联样式，属性尺寸就是盒子尺寸），在 dpr>1 下却会把 backing store 打回 1×、
 * 而**内联的 CSS 高度留在原地** —— 实测线上首页就是这样：内容是 1971px 高，
 * 画布盒子却停在 HTML 占位值 660px，整页被放大 2× 又压扁 3×（Retina 上必现，
 * 而在本仓所有门禁里都是绿的）。
 *
 * ## 判据
 *
 * `backing store == CSS 盒子 × dpr` —— 这一条同时管住两件事：
 *  · 不等 = 画布被拉伸/压扁（尺寸没对齐）；
 *  · 等于 1× = 背像素没放大，Retina 上必然发虚。
 * 再补一条"引擎内部尺寸 == DOM 属性尺寸"：引擎的命中检测按内部尺寸算，
 * 两者不一致时点击会整体偏移（引擎文档明确要求用 `fitCanvasToDisplaySize()` 改尺寸，
 * 而不是从外部改 `canvasWidth/Height`）。
 */
test.use({ deviceScaleFactor: 2 });

/**
 * 被这一档覆盖的页面：**首页 + 目录里的每个入口**。
 *
 * ⚠️ 首页不在 `PAGES` 里（它是入口不是游戏），所以只遍历 `entryPages()` 会**漏掉首页** ——
 * 实测第一版判据就是这么变成空门的（首页明明是唯一坏掉的那页，用例却是绿的）。
 */
const TARGETS = ['index.html', ...entryPages()];

interface CanvasSize {
  id: string;
  /** DOM 属性（= backing store，dpr>1 时是 CSS 尺寸的 dpr 倍）。 */
  attr: [number, number];
  /** `getBoundingClientRect`（CSS 像素）。 */
  box: [number, number];
  /** 引擎内部认为的画布尺寸；拿不到实例时为 null。 */
  engine: [number, number] | null;
}

/** 读页面上每块画布的三种尺寸（DOM 属性 / CSS 盒子 / 引擎内部）。 */
async function readCanvasSizes(page: import('@playwright/test').Page): Promise<CanvasSize[]> {
  return page.evaluate(() => {
    const home = (window as any).__gameHome;
    // ICE 实例必须与画布**成对取**（首页有三块画布、三个实例），与本仓 e2e 的既有口径一致
    const sources: Record<string, any> = {
      canvas:
        home?.ice ??
        (window as any).__game?.page?.ice ??
        (window as any).__arcade?.ice ??
        (window as any).__result?.ice ??
        null,
      navbar: home?.navbar?.handle?.page?.ice ?? null,
      bg: home?.effects?.handle?.page?.ice ?? null,
    };
    return Array.from(document.querySelectorAll('canvas')).map((canvas) => {
      const element = canvas as HTMLCanvasElement;
      const box = element.getBoundingClientRect();
      const ice = sources[element.id] || null;
      return {
        id: element.id,
        attr: [element.width, element.height] as [number, number],
        box: [box.width, box.height] as [number, number],
        engine: ice ? ([ice.canvasWidth, ice.canvasHeight] as [number, number]) : null,
      };
    });
  });
}

/** 断言一块画布"没被拉伸/压扁、也没退回 1×"。 */
function expectCanvasMatchesDpr(size: CanvasSize, dpr: number, where: string): void {
  const [attrW, attrH] = size.attr;
  const [boxW, boxH] = size.box;
  expect(
    Math.abs(attrW - boxW * dpr),
    `${where} #${size.id} 的宽度与 dpr 不符：backing store ${attrW}px vs CSS ${boxW}px × dpr ${dpr}` +
      `（画布会被横向拉伸/压缩；改尺寸要走 ice.fitCanvasToDisplaySize()，不要直接写 canvas.width）`,
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(attrH - boxH * dpr),
    `${where} #${size.id} 的高度与 dpr 不符：backing store ${attrH}px vs CSS ${boxH}px × dpr ${dpr}` +
      `（画布会被纵向压扁；改尺寸要走 ice.fitCanvasToDisplaySize()，不要直接写 canvas.height）`,
  ).toBeLessThanOrEqual(1);
}

test.describe('高分屏（dpr=2）', () => {
  test('首页与各入口页：每块画布的 backing store 与 CSS 尺寸都对得上 dpr', async ({ page }) => {
    for (const target of TARGETS) {
      const errors = collectErrors(page);
      await page.goto(`/${target}`, { waitUntil: 'load' });
      // 页面都有入场/开机动画，等最慢的那台机器（与 catalog.spec.ts 同口径）
      await page.waitForTimeout(1600);

      const sizes = await readCanvasSizes(page);
      expect(sizes.length, `${target} 上找不到画布`).toBeGreaterThan(0);
      for (const size of sizes) {
        expectCanvasMatchesDpr(size, 2, target);
        if (size.engine) {
          expect(
            size.engine,
            `${target} #${size.id} 的引擎内部尺寸 ${size.engine.join('×')} 与 DOM 属性 ${size.attr.join('×')} 不一致` +
              `（命中检测按内部尺寸算，不一致时点击会整体偏移）`,
          ).toEqual(size.attr);
        }
      }
      expect(errors, `${target} 有页面错误`).toEqual([]);
    }
  });

  test('首页：主体画布按内容高度 1:1 显示，不被压在 HTML 占位高度上', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(600);

    const info = await page.evaluate(() => {
      const canvas = document.getElementById('canvas') as HTMLCanvasElement;
      const box = canvas.getBoundingClientRect();
      return { boxHeight: box.height, boxWidth: box.width, reported: (window as any).__gameHome.size };
    });

    // 内容高度是页面自己算出来的（`layoutHome()`），画布必须按它 1:1 显示
    expect(info.reported.width).toBe(1180);
    expect(info.boxWidth, '主体画布宽度').toBe(info.reported.width);
    expect(
      info.boxHeight,
      `主体画布的 CSS 高度是 ${info.boxHeight}px，而内容是 ${info.reported.height}px —— ` +
        `两者不等时整页会被压扁（HTML 里的 height 只是 JS 执行前的占位值）`,
    ).toBe(info.reported.height);
  });

  test('首页：窗口高度变化后，背景效果层仍与 dpr 对齐', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(400);

    await page.setViewportSize({ width: 1440, height: 1200 });
    await page.waitForTimeout(600);

    const size = (await readCanvasSizes(page)).find((s) => s.id === EFFECTS_CANVAS);
    expect(size, `页面上没有 #${EFFECTS_CANVAS} 画布`).toBeTruthy();
    expectCanvasMatchesDpr(size as CanvasSize, 2, '窗口高度变化后');
    // 效果层铺满视口高度，所以它的逻辑高度应当跟着视口走
    expect(
      Math.round((size as CanvasSize).box[1]),
      `效果层画布的逻辑高度没跟上视口高度（视口 1200）`,
    ).toBe(1200);
  });

  test('打砖块：鼠标控制的挡板在 dpr=2 下仍然跟手', async ({ page }) => {
    await page.goto('/breakout.html', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__game));
    await page.waitForTimeout(400);

    const target = await page.evaluate(() => {
      const app = (window as any).__game;
      const box = (document.getElementById('canvas') as HTMLCanvasElement).getBoundingClientRect();
      return {
        stage: app.stage,
        canvasX: box.x,
        canvasY: box.y,
        canvasWidth: box.width,
        canvasHeight: box.height,
      };
    });

    /*
     * 指针移到**游戏区横向中线** → 挡板中心应当落到同一条线上。
     *
     * 坐标系别弄混：`movePaddleTo()` 与 `paddle.x` 都是**游戏区局部**坐标（stage 内），
     * 而鼠标事件给的是画布（世界）坐标 —— 世界 = stage.left + 局部。
     */
    const pointerWorldX = target.stage.left + target.stage.width / 2;
    const expectedPaddleCenter = target.stage.width / 2;
    await page.mouse.move(target.canvasX + pointerWorldX, target.canvasY + target.canvasHeight * 0.8);
    await page.waitForTimeout(200);

    const paddle = await page.evaluate(() => (window as any).__game.model.getPaddle());
    const paddleCenterX = paddle.x + paddle.width / 2;
    expect(
      Math.abs(paddleCenterX - expectedPaddleCenter),
      `指针在游戏区中线（世界坐标 ${pointerWorldX}）时挡板中心在 ${Math.round(paddleCenterX)}` +
        `（应落在游戏区局部坐标 ${expectedPaddleCenter}，差 ${Math.round(Math.abs(paddleCenterX - expectedPaddleCenter))}px）` +
        `—— 指针换算把 backing store 当成了 CSS 尺寸`,
    ).toBeLessThan(12);
  });

  test('主体画布的 id 与画布数量符合约定（防止将来插画布时静默错位）', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('canvas')).map((c) => c.id).sort());
    expect(ids).toEqual(['bg', 'canvas', 'navbar'].sort());
    expect(ids).toContain(MAIN_CANVAS);
  });
});
