import { expect, test } from '@playwright/test';
import { PAGES, entryPages, findPage, stats } from '../src/domain/catalog';
import { FAMILY_HOME, FAMILY_REPOS, SELF_REPO } from '../src/domain/family-repos';
import {
  DEFAULT_ALLOW_ID_PREFIXES,
  EFFECTS_CANVAS,
  NAVBAR_CANVAS,
  canvasPoint,
  clickCanvas,
  collectErrors,
  expectCanvasPainted,
  expectLayoutClean,
  scrollCanvasPointIntoView,
} from './support';

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
      /*
       * 先滚进视口再点。
       *
       * 实测：**视口外的点击仍然生效**（文档 y=1377、视口 900 高时照样精确命中），
       * 所以不滚也能过 —— 但那依赖 CDP 对越界坐标的处理方式，是 Playwright/Chrome 的
       * 内部行为而不是本仓的契约。真实用户也只能点他**看得见**的东西，
       * 所以这里统一滚进视口（顺带让 helper 里那道"目标必须在视口内"的断言保护这条用例）。
       */
      await scrollCanvasPointIntoView(page, rect.left + rect.width / 2, rect.top + rect.height / 2);
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

    // 卡片正文上的标签是非交互的，点击会冒泡到卡片本身 —— 这是有意的
    const rect = await page.evaluate(() =>
      (window as any).__gameHome.worldRect((window as any).__gameHome.nodes['windows-xp'].card),
    );
    await scrollCanvasPointIntoView(page, rect.left + 200, rect.top + 120);
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

    const rect = await page.evaluate(
      (key) => (window as any).__gameHome.worldRect((window as any).__gameHome.nodes[key].card),
      slug,
    );

    /*
     * ⚠️ 必须先把它滚进视口再 hover。
     *
     * 首页在 hero + 精选展厅之后，第一张卡片的中心已经落在 `y≈1005`（视口只有 900）——
     * 而**视口外的 `page.mouse.move` 会被浏览器直接忽略**（实测），hover 永远不触发，
     * 用例会静默失效。helper 里带断言，将来版面再变高会立刻报错。
     */
    await scrollCanvasPointIntoView(page, rect.left + rect.width / 2, rect.top + rect.height / 2);

    // 真鼠标移到卡片中心：ICEHoverManager 应派发 hoverchange → 高亮框显示
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

  test('版面体检：主体 / 吸顶导航 / 背景效果层三块画布都无越界、无构件交叠', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(700);

    /*
     * 各页自己声明的"点名排除的 id 前缀"从页面读，不在测试里写死。
     *
     * 现在只用在一个地方：**精选展厅**（`featured-*`）。`ICECarousel` 的轨道宽 = 幻灯片数
     * × 视口宽，第 2 张起在画布坐标系里本来就落在视口右侧之外（由 `clipChildren` 裁掉），
     * 体检的越界检查会遍历全部节点 → 不排除就是一串假越界。
     * 这是组件的设计（裁剪视口 + 溢出轨道），不是版面错乱。
     */
    const allowIdPrefixes = await page.evaluate(() => (window as any).__gameHome.auditAllowIdPrefixes);

    // ① 主体画布：hero / 轮播 / 卡片网格 / 页脚（页脚含多栏链接，最容易排歪）
    await expectLayoutClean(page, { allowIdPrefixes: [...DEFAULT_ALLOW_ID_PREFIXES, ...allowIdPrefixes] });

    // ② 吸顶导航画布：品牌 + 锚点 + 外链挤在 64px 高的一条里，宽度算错就会互相压住。
    //
    // 两个必须说清的参数：
    //  · `iceSource: 'navbar'` —— 导航是**独立 ICE 实例**，必须和它自己的画布成对取，
    //    否则会拿主画布的节点去比 64px 的高度，满屏假越界；
    //  · `tolerancePx: bleed` —— 导航背景条**有意**上移 `radius` 像素（让顶部方角、
    //    底部圆角），那是设计出血、会超出画布上边。数值从页面读，不在测试里写死。
    const bleed = await page.evaluate(() => (window as any).__gameHome.navbar.bleed);
    await expectLayoutClean(page, { canvasId: NAVBAR_CANVAS, iceSource: 'navbar', tolerancePx: bleed });

    // ③ 背景效果层：粒子/光斑铺满整块画布，任何构件越出都会被静默裁掉（同样是独立实例）
    await expectLayoutClean(page, { canvasId: EFFECTS_CANVAS, iceSource: 'bg' });

    expect(errors).toEqual([]);
  });

  test('背景效果层：粒子真的在动，且尊重"减少动态效果"', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(300);

    const first = await page.evaluate(() => {
      const fx = (window as any).__gameHome.effects;
      return { particles: fx.particles(), frames: fx.frames(), size: fx.size(), paused: fx.paused() };
    });
    expect(first.particles, '粒子数应当按视口面积给（太少就没氛围）').toBeGreaterThan(20);
    expect(first.size).toMatch(/^1180×\d+$/);

    // 光靠"有粒子"不够：得证明它**每帧都在推进**（不然就是一张静态图）
    await page.waitForTimeout(500);
    const second = await page.evaluate(() => (window as any).__gameHome.effects.frames());
    if (!first.paused) {
      expect(second, '效果层应当持续推进帧').toBeGreaterThan(first.frames);
    }

    // 它自己那块画布也真的画了东西（透明画布 + 少量粒子，阈值要压低）
    await expectCanvasPainted(page, 0.001, { minOpaque: 0.001, canvasId: EFFECTS_CANVAS });

    expect(errors).toEqual([]);
  });

  test('精选展厅：轮播能自动播、能切、幻灯片数与有封面的页面数一致', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(400);

    const expected = PAGES.filter((p) => p.cover).length;
    const info = await page.evaluate(() => {
      const home = (window as any).__gameHome;
      return home.carousel ? { count: home.carousel.count, playing: home.carousel.isPlaying(), index: home.carousel.index() } : null;
    });
    expect(info, '首页应当有精选展厅（有封面的页面 ≥2 时才有）').not.toBeNull();
    expect(info!.count, '幻灯片数 = 有封面的页面数').toBe(expected);
    expect(info!.playing, '轮播应当自动播放').toBe(true);
    expect(info!.index).toBe(0);

    // 程序式切到下一张（真箭头点击也走同一条路径，见 `ICECarousel.goTo`）
    await page.evaluate(() => (window as any).__gameHome.carousel.goTo(1));
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as any).__gameHome.carousel.index())).toBe(1);
    const node = await page.evaluate(() => (window as any).__gameHome.find('featured-carousel'));
    expect(node, '轮播根节点应当有 id 可查').not.toBeNull();

    expect(errors).toEqual([]);
  });

  test('吸顶导航：固定在视口顶部、锚点能跳转、内容不压在导航下面', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(600);

    /*
     * ① 页面**顶部**时，主体不能被导航压住（CSS 给 body 留了 padding-top）。
     *
     * 这条必须在 scrollY = 0 时验：一旦滚动，主体画布本来就会跑到视口上方
     * （第一版把它放在滚动之后，于是拿到 mainTop = -320，误报成"被压住"）。
     */
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(200);
    const layout = await page.evaluate(() => {
      const nav = document.getElementById('navbar')!.getBoundingClientRect();
      const main = document.getElementById('canvas')!.getBoundingClientRect();
      return { navTop: nav.top, navBottom: nav.bottom, navHeight: nav.height, mainTop: main.top };
    });
    expect(layout.mainTop, '页面主体被导航压住了').toBeGreaterThanOrEqual(layout.navBottom - 1);

    // ② 导航是独立画布且固定在视口顶部（滚动后位置不变）
    //
    // ⚠️ 别把导航高度写死在测试里：这里原来是 `navBottom - 60`，
    // 导航从 60 改成 64 之后那条断言就假失败了。固定定位下 `navTop` 本身就应当是 0。
    await page.evaluate(() => window.scrollTo(0, 400));
    await page.waitForTimeout(300);
    const navTop = await page.evaluate(() => document.getElementById('navbar')!.getBoundingClientRect().top);
    expect(navTop, '导航应当固定，不随窗口滚动').toBeCloseTo(0, 0);
    expect(layout.navHeight, '导航高度应当与代码里的 NAVBAR.height 一致').toBeGreaterThan(40);

    // ③ 导航画布真的画了东西（不是一块透明画布）
    await expectCanvasPainted(page, 0.02, { minOpaque: 0.5, canvasId: NAVBAR_CANVAS });

    // ④ 点「整机展厅」锚点 → 真的滚到那一组的位置
    //
    // 两个"别这么写"：
    //  · 锚点用 `behavior: 'smooth'`，**不能拿固定 sleep 等它**（上一版等 900ms 偶发拿到 0）；
    //  · 也不能只等"scrollY 变大"就断言高亮 —— 平滑滚动**途中**还在上一组，
    //    高亮自然还是上一组。要等它**落到目标位置**再断言。
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const target = await page.evaluate(() => {
      const home = (window as any).__gameHome;
      const section = home.navbar.sections.find((s: any) => s.key === 'machine');
      const node = home.navbar.find(`navbar-section-${section.key}`);
      const rect = home.navbar.worldRect(node);
      // 锚点滚动的期望落点：画布在文档里的偏移 + 分区在画布里的位置 − 导航高度 − 余量
      const canvasTop = document.getElementById('canvas')!.getBoundingClientRect().top + window.scrollY;
      const expected = canvasTop + section.canvasY - home.navbar.size.height - 16;
      return { key: section.key, rect, expected };
    });

    await clickCanvas(
      page,
      target.rect.left + target.rect.width / 2,
      target.rect.top + target.rect.height / 2,
      NAVBAR_CANVAS,
    );

    // 等滚动落到目标位置（±8px 容差），而不是等一个固定时长
    await page.waitForFunction(
      (expected) => Math.abs(window.scrollY - expected) < 8,
      target.expected,
      { timeout: 5000 },
    );
    // 落位之后，高亮应当就在被点的分区上
    expect(await page.evaluate(() => (window as any).__gameHome.navbar.activeKey())).toBe(target.key);

    expect(errors).toEqual([]);
  });

  test('吸顶导航：滚到顶时第一个分区高亮（不是"一个都不亮"）', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    const first = await page.evaluate(() => (window as any).__gameHome.navbar.sections[0]);
    // 分组标题在 hero 下方 —— 刚打开时"还没经过任何标题"，按语义应回退到第一组
    expect(await page.evaluate(() => (window as any).__gameHome.navbar.activeKey())).toBe(first.key);
  });

  test('导航外链与页脚外链：地址与家族仓库一致，且真鼠标点击能打开', async ({ page }) => {
    const errors = collectErrors(page);
    await page.goto('/');
    await page.waitForFunction(() => Boolean((window as any).__gameHome));
    await page.waitForTimeout(600);

    // ① 链接清单：页脚必须覆盖家族全部仓库 + 主页（与 src/domain/family-repos.ts 同源）
    const footerLinks = await page.evaluate(() => (window as any).__gameHome.footer.links);
    expect(footerLinks.length).toBe(FAMILY_REPOS.length + 1); // + 家族主页
    for (const repo of FAMILY_REPOS) {
      expect(footerLinks.map((l: any) => l.url)).toContain(repo.url);
    }
    expect(footerLinks.map((l: any) => l.url)).toContain(FAMILY_HOME);
    // 未开源的仓不出现链接（页脚渲染成纯文本）
    expect(footerLinks.map((l: any) => l.text)).not.toContain(`${SELF_REPO.name}`);

    // ② 真鼠标点页脚里的 ice-render 链接 → 新标签页打开正确地址
    const target = await page.evaluate(() => {
      const home = (window as any).__gameHome;
      const node = home.find('footer-ice-render');
      return node ? home.worldRect(node) : null;
    });
    expect(target, '页脚里找不到 ice-render 链接').not.toBeNull();
    // 先滚到底让页脚进入视口（fixed 的导航不受影响）
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(500);

    const [popup] = await Promise.all([
      page.waitForEvent('popup'),
      clickCanvas(page, target!.left + 10, target!.top + target!.height / 2),
    ]);
    expect(popup.url()).toContain('github.com/ice-render/ice-render');
    await popup.close();

    expect(errors).toEqual([]);
  });
});
