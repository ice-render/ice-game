import { expect, test } from '@playwright/test';
import { findPage } from '../src/domain/catalog';
import { RECT_HELPER, clickCanvas, collectErrors, expectCanvasPainted } from './support';

/**
 * 掌机页（`src/games/arcade`，从上游 `ice-web-components/examples/arcade.html` 逐字抽取）。
 *
 * 断言分三层，缺一层就会出现"看起来通过其实没验证"：
 *  1) 像素：自检画面真的画出来了；
 *  2) 目录：卡带数量与 `src/domain/catalog.ts` 写的一致（目录是首页那张卡片的来源）；
 *  3) 交互：真鼠标切卡带、真键盘操作方块 —— 光有像素只能证明"画了一屏东西"。
 */
test.describe('ICE Arcade 掌机', () => {
  test('自检画面有内容，卡带数量与目录一致', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript({ content: RECT_HELPER });
    await page.goto('/arcade.html');

    await page.waitForFunction(() => Boolean((window as any).__arcade));
    await expectCanvasPainted(page, 0.02);

    // 目录里写的"四张卡带"必须是这台机器真的有的（改一处忘另一处会立刻红）
    const expected = findPage('arcade')!.features.length;
    const actual = await page.evaluate(() => Object.keys((window as any).__arcade.cartridges).length);
    expect(actual).toBe(expected);

    const phase = await page.evaluate(() => (window as any).__arcade.bios.getPhase());
    expect(['post', 'menu', 'settings', 'boot']).toContain(phase);

    expect(errors).toEqual([]);
  });

  test('切卡带 + 方向键真的能操作方块', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript({ content: RECT_HELPER });
    await page.goto('/arcade.html');

    // 等自检跑完、卡带挂载（POST 是定时序列，慢一点很正常）
    await page.waitForFunction(() => Boolean((window as any).__arcade?.game), undefined, { timeout: 30_000 });

    // ① 真鼠标点「俄罗斯方块」卡带
    await page.evaluate(() => {
      const button = (window as any).__arcade.cartridges.tetris;
      const rect = (window as any).__rect(button);
      (window as any).__tetrisRect = rect;
    });
    const rect = await page.evaluate(() => (window as any).__tetrisRect);
    await clickCanvas(page, rect.left + rect.width / 2, rect.top + rect.height / 2);
    await page.waitForFunction(() => (window as any).__arcade.game === 'tetris');

    // ② 真键盘：方块出生在中间，按右键列号必须变大（下落只改行号，不会误判成"输入生效了"）
    const before = await page.evaluate(() => (window as any).__arcade.model.getCurrent().col);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(() => (window as any).__arcade.model.getCurrent().col);
    expect(after).toBeGreaterThan(before);

    // ③ 空格硬降：方块落地，棋盘上必须出现实心格
    await page.keyboard.press(' ');
    await page.waitForFunction(() => {
      const board = (window as any).__arcade.model.getBoard();
      return board.some((row: unknown[]) => row.some(Boolean));
    });

    // ④ 切到贪吃蛇：换卡带 = 销毁旧的、建新的
    await page.evaluate(() => {
      const button = (window as any).__arcade.cartridges.snake;
      (window as any).__snakeRect = (window as any).__rect(button);
    });
    const snakeRect = await page.evaluate(() => (window as any).__snakeRect);
    await clickCanvas(page, snakeRect.left + snakeRect.width / 2, snakeRect.top + snakeRect.height / 2);
    await page.waitForFunction(() => (window as any).__arcade.game === 'snake');

    // `ICESnakePoint` 是元组 `[row, col]`，不是对象
    const head = await page.evaluate(() => (window as any).__arcade.model.getHead());
    expect(Array.isArray(head)).toBe(true);
    expect(head).toHaveLength(2);

    // 真键盘：把方向掰成「上」，蛇头行号必须开始变小（自动前进 + 方向真的收到了）
    await page.keyboard.press('ArrowUp');
    await page.waitForFunction(
      (startRow: number) => (window as any).__arcade.model.getHead()[0] < startRow,
      head[0],
      { timeout: 5_000 },
    );

    await expectCanvasPainted(page, 0.02);
    expect(errors).toEqual([]);
  });
});
