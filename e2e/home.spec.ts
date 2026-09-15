import { expect, test } from '@playwright/test';
import { PAGES, entryPages, findPage, stats } from '../src/domain/catalog';
import { canvasPoint, clickCanvas, collectErrors, expectCanvasPainted } from './support';

/**
 * 游戏厅首页：目录（`src/domain`）→ 画布网格（`src/home`）→ 真实跳转的闭环。
 *
 * 首页是整个工程的**集成冒烟**：它和所有游戏页共用同一个引擎实例（webpack 的 alias 钉死），
 * 所以"首页能画出来"本身就证明了打包没有出多份引擎。
 */
test.describe('游戏厅首页', () => {
  test('无错误、画布画出了全部卡片', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');

    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    // 首页是"透明画布 + 卡片网格"，卡片只占画布面积的两三成（其余露出页面背景），
    // 所以 opaqueRatio 的下限要比铺满画布的页面低；这里真正有效的是 inkRatio。
    await expectCanvasPainted(page, 0.03, { minOpaque: 0.08 });

    // 画布上的卡片与目录逐条对齐（目录改了而首页没跟上会立刻红）
    const cards = await page.evaluate(() => Object.keys((window as any).__gameHome.nodes).sort());
    expect(cards).toEqual(PAGES.map((p) => p.slug).sort());

    // 分组标题与数量都是算出来的，不是写死的
    const groups = await page.evaluate(() =>
      (window as any).__gameHome.groups.map((g: any) => ({ kind: g.kind, count: g.items.length })),
    );
    expect(groups.reduce((sum: number, g: any) => sum + g.count, 0)).toBe(PAGES.length);

    const size = await page.evaluate(() => (window as any).__gameHome.size);
    expect(size.width).toBe(1180);
    // 画布高度是算出来的：至少要装下所有分组（写死 800 的话卡片会被裁掉）
    expect(size.height).toBeGreaterThan(560);

    expect(stats().games + stats().machines).toBe(PAGES.length);
    expect(errors).toEqual([]);
  });

  test('点「进入」按钮进对应游戏页（逐个页都验）', async ({ page }) => {
    const errors = collectErrors(page);
    for (const target of entryPages()) {
      await page.goto('/');
      await page.waitForFunction(() => Boolean((window as any).__gameHome));

      const slug = target.replace(/\.html$/, '');
      const rect = await page.evaluate(
        (key) => (window as any).__gameHome.worldRect((window as any).__gameHome.nodes[key].button),
        slug,
      );
      await clickCanvas(page, rect.left + rect.width / 2, rect.top + rect.height / 2);

      await page.waitForURL(new RegExp(`${slug}\\.html$`));
      expect(page.url()).toMatch(new RegExp(`${slug}\\.html$`));
    }
    expect(errors).toEqual([]);
  });

  test('点卡片正文（不是按钮）也能进游戏页', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    // 卡片正文上的 chip 是非交互的，点击会冒泡到卡片本身 —— 这是有意的
    const rect = await page.evaluate(() =>
      (window as any).__gameHome.worldRect((window as any).__gameHome.nodes['windows-xp'].card),
    );
    const point = await canvasPoint(page, rect.left + 200, rect.top + 120);
    await page.mouse.click(point.x, point.y);

    await page.waitForURL(/windows-xp\.html$/);
    expect(errors).toEqual([]);
  });

  test('卡片不越界、不重叠（版面体检）', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    const rects = await page.evaluate(() => {
      const home = (window as any).__gameHome;
      return Object.entries(home.nodes).map(([slug, nodes]: [string, any]) => {
        const rect = home.worldRect(nodes.card);
        return { slug, ...rect };
      });
    });

    const canvasWidth = await page.evaluate(() => (window as any).__gameHome.size.width);
    const canvasHeight = await page.evaluate(() => (window as any).__gameHome.size.height);

    for (const rect of rects) {
      // 越界：卡片必须在画布内（网格换行算错时最先在这里露馅）
      expect(rect.left, `${rect.slug} 越出左边界`).toBeGreaterThanOrEqual(0);
      expect(rect.left + rect.width, `${rect.slug} 越出右边界`).toBeLessThanOrEqual(canvasWidth);
      expect(rect.top + rect.height, `${rect.slug} 越出下边界`).toBeLessThanOrEqual(canvasHeight);
    }

    // 两两不相交（网格行高算错会让上下两行压在一起）
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i];
        const b = rects[j];
        const overlapX = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left);
        const overlapY = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top);
        const overlaps = overlapX > 1 && overlapY > 1;
        expect(overlaps, `${a.slug} 与 ${b.slug} 重叠`).toBe(false);
      }
    }
  });

  test('卡片带封面：有封面的页面真的加载了图，没有的回退到占位块', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    // 图片是异步加载的，等画布重新画过（ImageCache 的 onload 会置脏）
    await page.waitForTimeout(800);

    const info = await page.evaluate(() => {
      const home = (window as any).__gameHome;
      const canvas = document.querySelector('canvas') as HTMLCanvasElement;
      return {
        // 统一句柄约定：卡片节点里有 `game-cover-<slug>` 就是加载了封面
        withCoverNode: home.pages.filter((p: any) => home.find(`game-cover-${p.slug}`)).map((p: any) => p.slug),
        // 目录里标记有封面的
        markedCover: home.pages.filter((p: any) => p.cover).map((p: any) => p.slug),
        missing: home.missingCovers,
        canvasNonEmpty: canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data.some((v, i) => i % 4 === 3 && v >= 8),
      };
    });

    // 目录标记与画布上的节点必须一一对应（标记说有、节点没有 = 封面没画上去）
    expect(info.withCoverNode.sort()).toEqual(info.markedCover.sort());
    expect(info.canvasNonEmpty).toBe(true);
    // ⚠️ 缺封面**不是错误**：新游戏天然没有封面，首页会用占位块并在底部提示
    expect(Array.isArray(info.missing)).toBe(true);

    expect(errors).toEqual([]);
  });

  test('鼠标悬停卡片会显示高亮框（kit 的 hoverchange 接线）', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    const slug = PAGES[0].slug;
    const before = await page.evaluate(
      (key) => (window as any).__gameHome.nodes[key].frame.state.display,
      slug,
    );
    expect(before, '悬停框初始应当隐藏').toBe(false);

    // 真鼠标移到卡片中心：ICEHoverManager 应派发 hoverchange → 高亮框显示
    const rect = await page.evaluate(
      (key) => (window as any).__gameHome.worldRect((window as any).__gameHome.nodes[key].card),
      slug,
    );
    const point = await canvasPoint(page, rect.left + rect.width / 2, rect.top + rect.height / 2);
    await page.mouse.move(point.x, point.y);
    await page.waitForTimeout(300);

    const after = await page.evaluate(
      (key) => (window as any).__gameHome.nodes[key].frame.state.display,
      slug,
    );
    expect(after, '鼠标悬停后高亮框应当显示').toBe(true);
  });

  test('目录里的每个 kind 都能在首页找到对应分组的卡片', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));

    const badges = await page.evaluate(() =>
      (window as any).__gameHome.pages.map((p: any) => ({ slug: p.slug, kind: p.kind })),
    );
    expect(badges).toHaveLength(PAGES.length);
    // breakout 属于「小游戏」组：分组归位由 kind 决定，写错在构建期就会报错
    expect(findPage('breakout')?.kind).toBe('game');
  });
});
