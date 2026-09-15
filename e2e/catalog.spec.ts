import { expect, test } from '@playwright/test';
import { PAGES, entryPages } from '../src/domain/catalog';
import { collectErrors, expectCanvasPainted, expectLayoutClean } from './support';

/**
 * **目录驱动的逐页冒烟** —— 新增一个游戏，这里自动多一个用例，不需要改测试。
 *
 * 它只做"这页没坏"的最低限度断言（无报错 + 画布真的画出了东西），
 * 深一点的交互验证放在各游戏自己的 spec 里（如 `breakout.spec.ts`）。
 *
 * 这一层的价值在于**覆盖**：`src/ported/` 里两台整机（掌机 / XP 桌面）是上游搬来的重内容，
 * 改动引擎或组件库版本后最容易悄悄坏掉，靠人工记得去点一遍不现实。
 *
 * 为什么每页都要 `waitForTimeout`：这些页面都有入场/开机动画（XP 还得跑自检、掌机跑 BIOS），
 * 立刻取像素会拿到空帧。等待时间按"最慢的那台机器"给。
 */
test.describe('逐页冒烟（目录驱动）', () => {
  for (const target of entryPages()) {
    const slug = target.replace(/\.html$/, '');
    const info = PAGES.find((p) => p.page === target);

    test(`${target}（${info?.kind}）：无报错且画布有内容`, async ({ page }) => {
      const errors = collectErrors(page);
      await page.goto(`/${target}`, { waitUntil: 'load' });

      // 页面自己会挂调试句柄（`window.__<slug>` 或 `__gameHome` / `__result`）；
      // 灯亮说明脚本真的执行到了末尾，能区分"脚本 404"和"渲染出错"
      await page.waitForTimeout(1600);

      // 整机页的自检画面很暗，"与主色不同"的像素本来就少，阈值取 0.5%
      await expectCanvasPainted(page, 0.005);

      // 画布尺寸必须是 HTML 里声明的设计尺寸（套用模板时变量没注入会变成默认 300×150）
      const size = await page.evaluate(() => {
        const canvas = document.querySelector('canvas') as HTMLCanvasElement;
        return { width: canvas.width, height: canvas.height };
      });
      expect(size.width).toBeGreaterThan(400);
      expect(size.height).toBeGreaterThan(300);

      expect(errors, `${slug} 有页面错误`).toEqual([]);
    });
  }

  test('每页都有可直接打开的相对路径资源（无服务端 / file:// 也能跑）', async ({ page }) => {
    // 小游戏不依赖 fetch，构建产物用相对路径 —— 所以拷走一个 HTML + JS 就能玩。
    // 这条断言防止将来有人把 publicPath 改成绝对路径（那会让分发能力悄悄消失）。
    for (const target of entryPages()) {
      await page.goto(`/${target}`);
      const src = await page.evaluate(() => {
        const script = document.querySelector('script[src]') as HTMLScriptElement | null;
        return script ? script.getAttribute('src') : null;
      });
      expect(src, `${target} 的入口脚本`).toBeTruthy();
      expect(src!.startsWith('/'), `${target} 的脚本路径不该是绝对路径：${src}`).toBe(false);
      expect(src!.startsWith('http'), `${target} 的脚本路径不该是外链：${src}`).toBe(false);
    }
  });

  /**
   * 自研小游戏的**通用版面不变量** —— 只要用了 `kit/shell` 就自动被覆盖，新游戏不用登记。
   *
   * 为什么值得写成通用断言：
   *  · 画布外的内容会被引擎**静默裁掉**（没有溢出报错）；
   *  · 两个构件压在一起更是连告警都没有 —— 实测就是靠这套体检抓到
   *    "breakout 的数值卡压住游戏区 18px"，只有翻截图才看得出来。
   */
  test.describe('小游戏通用不变量', () => {
    const gamePages = PAGES.filter((p) => p.kind === 'game');

    for (const game of gamePages) {
      test(`${game.slug}：外壳内容不越出画布`, async ({ page }) => {
        await page.goto(`/${game.page}`);
        // 统一句柄约定：小游戏都挂 `window.__game`
        const hasHandle = await page
          .waitForFunction(() => Boolean((window as any).__game), undefined, { timeout: 5000 })
          .then(() => true)
          .catch(() => false);
        expect(hasHandle, `${game.slug} 没有暴露 window.__game（小游戏的句柄约定）`).toBe(true);

        const info = await page.evaluate(() => {
          const app = (window as any).__game;
          const canvas = document.querySelector('canvas') as HTMLCanvasElement;
          return {
            canvasHeight: canvas.height,
            canvasWidth: canvas.width,
            layout: app.shell ? app.shell.layout : null,
            hasShell: Boolean(app.shell),
          };
        });

        expect(info.hasShell, `${game.slug} 没用 kit/shell（小游戏应当复用它搭外壳）`).toBe(true);
        expect(
          info.layout.contentBottom,
          `${game.slug} 的外壳内容底边 ${info.layout.contentBottom} 超出画布高度 ${info.canvasHeight}，最下面那行会被裁掉`,
        ).toBeLessThanOrEqual(info.canvasHeight);
        expect(info.layout.actionsTop).toBeGreaterThan(0);
      });

      test(`${game.slug}：版面体检（无越界、无构件交叠）`, async ({ page }) => {
        const errors = collectErrors(page);
        await page.goto(`/${game.page}`);
        await page.waitForFunction(() => Boolean((window as any).__game), undefined, { timeout: 5000 });
        await page.waitForTimeout(500);

        // 初始态（待发球/覆盖层）+ 进行中，两个状态都要干净
        await expectLayoutClean(page);

        // 发球进入进行中，再查一次（游戏跑起来之后版面才真正展开）
        await page.keyboard.press(' ');
        await page.waitForTimeout(600);
        await expectLayoutClean(page);

        expect(errors).toEqual([]);
      });
    }
  });
});
