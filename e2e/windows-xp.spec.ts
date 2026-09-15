import { expect, test, type Page } from '@playwright/test';
import { findPage } from '../src/domain/catalog';
import { RECT_HELPER, collectErrors, dblclickCanvas, expectCanvasPainted } from './support';

/**
 * Windows XP 桌面页（`src/games/windows-xp`，从上游 `examples/windows-xp.html` 逐字抽取）。
 *
 * 这页最有意思的地方是它**会开机**：自检 → 欢迎屏 → 桌面是一台状态机
 * （`window.__result.session.phase`），所以 e2e 也按真实使用顺序走一遍，
 * 而不是直接把状态设成 desktop 去截个图 —— 后者会把"开机流程本身坏了"漏掉。
 */

/** 桌面图标顺序，与页面里的 `ICON_ORDER` 一致。 */
const ICON_ORDER = ['computer', 'documents', 'notepad', 'paint', 'minesweeper', 'ie', 'display', 'arcade'];

/**
 * 把机器一路开到桌面：开机（任意键跳过）→ 登录（回车选人）→ 密码（回车直接进）。
 * 用**真键盘**逐个阶段推进（而不是在页面里伪造 KeyboardEvent 或直接改状态），
 * 这样失败时能区分"状态机坏了"和"键盘监听没接上"。
 */
async function bootToDesktop(page: Page) {
  await page.waitForFunction(() => Boolean((window as any).__result));
  for (let i = 0; i < 12; i += 1) {
    const phase = await page.evaluate(() => (window as any).__result.session.phase);
    if (phase === 'desktop') return;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
  }
  const phase = await page.evaluate(() => (window as any).__result.session.phase);
  throw new Error(`开机流程没走到桌面，停在 ${phase}`);
}

test.describe('Windows XP 桌面', () => {
  test('开机自检画面有内容，内置程序数量与目录一致', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript({ content: RECT_HELPER });
    await page.goto('/windows-xp.html');

    await page.waitForFunction(() => Boolean((window as any).__result));
    // 自检画面是黑底 + 四色旗 + 进度块，与主色（黑）不同的像素本来就少
    await expectCanvasPainted(page, 0.005);

    const phase = await page.evaluate(() => (window as any).__result.session.phase);
    expect(['boot', 'login']).toContain(phase);

    // 目录里写的"八个程序"必须是这台机器真的有的
    const expected = findPage('windows-xp')!.features.length;
    const actual = await page.evaluate(() => (window as any).__result.APPS.length);
    expect(actual).toBe(expected);

    expect(errors).toEqual([]);
  });

  test('一路开机到桌面，双击图标打开扫雷', async ({ page }) => {
    const errors = collectErrors(page);
    await page.addInitScript({ content: RECT_HELPER });
    await page.goto('/windows-xp.html');

    await bootToDesktop(page);
    // 桌面 = 壁纸 + 图标列 + 任务栏 + 开机自动打开的「我的电脑」
    await expectCanvasPainted(page, 0.08);
    const opened = await page.evaluate(() => (window as any).__result.openWindows.size);
    expect(opened).toBeGreaterThan(0);

    // 桌面图标靠**双击**打开
    await page.evaluate((order) => {
      const index = order.indexOf('minesweeper');
      const tile = (window as any).__result.iconTiles[index];
      (window as any).__minesweeperRect = (window as any).__rect(tile);
    }, ICON_ORDER);
    const rect = await page.evaluate(() => (window as any).__minesweeperRect);
    await dblclickCanvas(page, rect.left + rect.width / 2, rect.top + rect.height / 2);

    await page.waitForFunction(() => (window as any).__result.openWindows.has('minesweeper'));
    const count = await page.evaluate(() => (window as any).__result.openWindows.size);
    expect(count).toBeGreaterThan(opened);

    expect(errors).toEqual([]);
  });
});
