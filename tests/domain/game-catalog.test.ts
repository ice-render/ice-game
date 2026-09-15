import { GAMES, allItems, catalogSize, entryPages, findGame } from '../../src/domain/game-catalog';

/**
 * 目录层的单测：守的是「首页卡片 / 入口页 / webpack 入口」三者的一致性。
 *
 * 目录里写错一个文件名，症状是"首页点进去 404"—— 那要跑到浏览器里才发现。这里在
 * node 里 0.1 秒就能抓到。跑法：`npm test`（不需要引擎产物、不需要 jsdom）。
 */
describe('game-catalog', () => {
  it('至少有机器，且 key / page 唯一', () => {
    expect(GAMES.length).toBeGreaterThan(0);
    expect(new Set(GAMES.map((g) => g.key)).size).toBe(GAMES.length);
    expect(new Set(GAMES.map((g) => g.page)).size).toBe(GAMES.length);
  });

  it('入口页就是 webpack 产出的两个 HTML（写错了首页点进去会 404）', () => {
    expect(entryPages().sort()).toEqual(['arcade.html', 'windows-xp.html']);
  });

  it('每台机器都填齐了卡片需要的字段', () => {
    for (const game of GAMES) {
      expect(game.title.trim().length).toBeGreaterThan(0);
      // 首页那行副标题只给一行宽度，超长会被裁掉
      expect(game.tagline.length).toBeLessThanOrEqual(34);
      expect(game.accent).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(game.items.length).toBeGreaterThan(0);
      expect(game.controls.length).toBeGreaterThan(0);
      for (const [keys, desc] of game.controls) {
        expect(keys.trim().length).toBeGreaterThan(0);
        expect(desc.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('catalogSize 与 allItems 口径一致', () => {
    const size = catalogSize();
    expect(size.machines).toBe(GAMES.length);
    expect(size.items).toBe(allItems().length);
    expect(size.items).toBeGreaterThanOrEqual(size.machines);
  });

  it('findGame 命中已知 key，未知 key 返回 undefined', () => {
    expect(findGame('arcade')?.title).toBe('ICE Arcade');
    expect(findGame('windows-xp')?.page).toBe('windows-xp.html');
    expect(findGame('nope')).toBeUndefined();
  });

  it('掌机收录的四张卡带就是上游 arcade.html 的 GAMES 注册表', () => {
    expect(findGame('arcade')?.items).toEqual(['俄罗斯方块', '贪吃蛇', '2048', 'CHIP-8']);
  });
});
