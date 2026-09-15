import { expect, test } from '@playwright/test';
import { findPage } from '../src/domain/catalog';
import { RECT_HELPER, clickCanvas, collectErrors, expectCanvasPainted, expectLayoutClean } from './support';

/**
 * 掌机页（`src/machines/arcade`，最早从上游 `ice-web-components/examples/arcade.html` 逐字抽取、现已自维护）。
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

  test('版面体检：BIOS 与卡带两个阶段都无越界、无构件交叠', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/arcade.html');
    await page.waitForFunction(() => Boolean((window as any).__arcade));

    // 阶段 1：BIOS 自检 / 启动菜单（机壳 + 屏幕 + 侧栏都在这一帧）
    await expectLayoutClean(page);

    // 阶段 2：卡带跑起来之后（棋盘 / 分数卡 / 侧栏都展开了）
    await page.waitForFunction(() => Boolean((window as any).__arcade.game), undefined, { timeout: 30_000 });
    await page.waitForTimeout(800);
    await expectLayoutClean(page);

    expect(errors).toEqual([]);
  });
});

/**
 * 掌机居中回归：页面层 body flex 居中 + 字母边（letterbox）缩放后，画布应**始终居中**
 * 于视口（任意比例都不贴边、不被裁切）。这是 2026-09-15 把 arcade 从 `src/ported/` 迁到
 * `src/machines/` 并加居中样式的核心诉求。
 */
test.describe('掌机居中（字母边 + flex 居中）', () => {
  for (const [vw, vh] of [
    [1440, 900],
    [1280, 900],
    [1024, 768],
    [800, 1200],
  ] as const) {
    test(`${vw}x${vh} 掌机在页面居中`, async ({ page }) => {
      await page.setViewportSize({ width: vw, height: vh });
      const errors = collectErrors(page);
      await page.goto('/arcade.html');
      await page.waitForFunction(() => Boolean((window as any).__arcade));

      const box = await page.locator('#canvas').boundingBox();
      expect(box, '画布没有布局盒子').not.toBeNull();
      const cx = box!.x + box!.width / 2;
      const cy = box!.y + box!.height / 2;
      // 居中误差 < 2px（浮点 + 字母边取整允许的余量）
      expect(Math.abs(cx - vw / 2), `水平未居中：中心 x=${cx} 期望 ${vw / 2}`).toBeLessThan(2);
      expect(Math.abs(cy - vh / 2), `垂直未居中：中心 y=${cy} 期望 ${vh / 2}`).toBeLessThan(2);

      expect(errors).toEqual([]);
    });
  }
});
