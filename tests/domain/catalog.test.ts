import { GROUPS, PAGES, allFeatures, entryPages, findPage, stats, type PageKind } from '../../src/domain/catalog';

/**
 * 目录层的单测：守的是「生成物 / 分组 / 入口页」三者的一致性。
 *
 * 目录里写错一个文件名，症状是"首页点进去 404"—— 那要跑到浏览器里才发现。
 * 这里在 node 里 0.1 秒就能抓到。跑法：`npm test`（不需要引擎产物、不需要 jsdom）。
 *
 * 数据本身来自 `catalog.generated.json`（`npm run gen:catalog` 生成），
 * 所以这些断言同时也是生成器输出格式的守门人。
 */
describe('catalog', () => {
  it('非空，且 slug / page 唯一', () => {
    expect(PAGES.length).toBeGreaterThan(0);
    expect(new Set(PAGES.map((p) => p.slug)).size).toBe(PAGES.length);
    expect(new Set(PAGES.map((p) => p.page)).size).toBe(PAGES.length);
  });

  it('kind 只有两种取值，且与分组一一对应', () => {
    for (const page of PAGES) {
      expect(['game', 'machine']).toContain(page.kind);
    }
    // 每个页都恰好属于一个分组；分组里没有别的 kind 混进来
    const grouped = GROUPS.flatMap((g) => g.items);
    expect(grouped).toHaveLength(PAGES.length);
    for (const group of GROUPS) {
      for (const item of group.items) {
        expect(item.kind).toBe(group.kind);
      }
    }
    // 分组不空（空分组不该出现，否则首页会有个空标题）
    for (const group of GROUPS) {
      expect(group.items.length).toBeGreaterThan(0);
      expect(group.label.trim().length).toBeGreaterThan(0);
    }
  });

  it('每页字段齐备，且 page 就是 slug + .html', () => {
    for (const page of PAGES) {
      expect(page.title.trim().length).toBeGreaterThan(0);
      // 首页那行副标题只给一行宽度，超长会被裁
      expect(page.tagline.length).toBeLessThanOrEqual(34);
      expect(page.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(page.page).toBe(`${page.slug}.html`);
      expect(Array.isArray(page.features)).toBe(true);
      expect(Array.isArray(page.controls)).toBe(true);
      for (const row of page.controls) {
        expect(row).toHaveLength(2);
      }
    }
  });

  it('stats 与 allFeatures / PAGES 口径一致', () => {
    const size = stats();
    expect(size.games + size.machines).toBe(PAGES.length);
    expect(size.games).toBe(PAGES.filter((p) => p.kind === 'game').length);
    expect(size.machines).toBe(PAGES.filter((p) => p.kind === 'machine').length);
    expect(size.features).toBe(allFeatures().length);
  });

  it('entryPages 覆盖所有页面（e2e 靠它逐页冒烟）', () => {
    expect(entryPages().sort()).toEqual(PAGES.map((p) => p.page).sort());
    // 上游移植的两台整机必须在列表里 —— 它们是本仓最重的内容，漏测代价最大
    expect(entryPages()).toEqual(expect.arrayContaining(['arcade.html', 'windows-xp.html']));
  });

  it('findPage 命中已知 slug，未知 slug 返回 undefined', () => {
    expect(findPage('arcade')?.kind).toBe('machine');
    expect(findPage('windows-xp')?.page).toBe('windows-xp.html');
    expect(findPage('breakout')?.kind).toBe('game');
    expect(findPage('nope')).toBeUndefined();
  });

  it('自研小游戏排在整机展厅之前（首页的主次）', () => {
    const kinds = GROUPS.map((g) => g.kind);
    const gameIndex = kinds.indexOf('game' as PageKind);
    const machineIndex = kinds.indexOf('machine' as PageKind);
    if (gameIndex !== -1 && machineIndex !== -1) {
      expect(gameIndex).toBeLessThan(machineIndex);
    }
  });

  it('掌机收录的四张卡带与上游一致；XP 的八个程序与页面一致', () => {
    expect(findPage('arcade')?.features).toEqual(['俄罗斯方块', '贪吃蛇', '2048', 'CHIP-8']);
    expect(findPage('windows-xp')?.features).toHaveLength(8);
  });
});
