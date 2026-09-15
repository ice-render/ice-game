import { expect, test } from '@playwright/test';
import { GAMES, allItems, findGame } from '../src/domain/game-catalog';
import { canvasPoint, clickCanvas, collectErrors, expectCanvasPainted } from './support';

/**
 * 游戏厅首页：目录（`src/domain`）→ 画布卡片（`src/home`）→ 真实跳转的闭环。
 *
 * 首页是整个工程的**集成冒烟**：它和两个游戏页共用同一个引擎实例（webpack 的 alias 钉死），
 * 所以"首页能画出来"本身就证明了打包没有出多份引擎。
 */
test.describe('游戏厅首页', () => {
  test('无错误、画布画出了两张卡片', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');

    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await expectCanvasPainted(page, 0.05);

    // 画布上的两台机器与目录逐条对齐（目录改了而首页没跟上会立刻红）
    const cards = await page.evaluate(() =>
      Object.keys((window as any).__gameHome.nodes).sort(),
    );
    expect(cards).toEqual(GAMES.map((game) => game.key).sort());
    expect(cards.length).toBe(2);

    // 规模数字是算出来的，不是写死的
    const size = await page.evaluate(() => (window as any).__gameHome.games.length);
    expect(size).toBe(GAMES.length);
    expect(allItems().length).toBeGreaterThanOrEqual(GAMES.length);

    expect(errors).toEqual([]);
  });

  test('点「进入」按钮进对应游戏页', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    // 按世界坐标点按钮中心：背像素的测试会在换版面时静默失效
    const rect = await page.evaluate(() => (window as any).__gameHome.worldRect((window as any).__gameHome.nodes.arcade.button));
    await clickCanvas(page, rect.left + rect.width / 2, rect.top + rect.height / 2);

    await page.waitForURL(/arcade\.html$/);
    expect(page.url()).toMatch(/arcade\.html$/);
    expect(errors).toEqual([]);
  });

  test('点卡片正文（不是按钮）也能进游戏页', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    // 卡片正文上的芯片是非交互的，点击会冒泡到卡片本身 —— 这是有意的
    const rect = await page.evaluate(() =>
      (window as any).__gameHome.worldRect((window as any).__gameHome.nodes['windows-xp'].card),
    );
    const point = await canvasPoint(page, rect.left + 400, rect.top + 130);
    await page.mouse.click(point.x, point.y);

    await page.waitForURL(/windows-xp\.html$/);
    expect(page.url()).toMatch(/windows-xp\.html$/);
    expect(errors).toEqual([]);
  });
});
