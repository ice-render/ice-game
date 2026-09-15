/**
 * 游戏厅的商品目录：本仓"能玩什么"的唯一事实来源。
 *
 * 这一层是**纯数据 + 纯函数**，零运行时依赖（不 import 任何一个 ICE 包）：
 * - 首页画布拿它铺卡片；
 * - 单测不需要引擎产物、不需要 jsdom 就能守住"目录与页面一一对应"；
 * - e2e 拿它逐条去访问真实页面（`GAMES` 改了而页面没加，测试会立刻红）。
 *
 * 所以往游戏厅里加一台新机器 = 两件事：加一条目录项 + 加一个 webpack 入口页。
 */

/** 目录项：一台机器（或一张卡带集）。 */
export interface GameEntry {
  /** 稳定标识，用作节点 id 与包内引用，不要改。 */
  key: string;
  /** 卡片标题。 */
  title: string;
  /** 一句话说明，写在标题下面（首页一行装得下，别超 ~30 个汉字）。 */
  tagline: string;
  /** 入口页路径，相对 `dist/` 根。 */
  page: string;
  /** 卡片主色（十六进制）。 */
  accent: string;
  /** 这台机器里能玩到的小游戏 / 程序。 */
  items: string[];
  /** 操作说明：`[按键组合, 作用]` 二元组，首页按两列排。 */
  controls: Array<[string, string]>;
}

/**
 * 目录。顺序即首页卡片顺序。
 *
 * `page` 必须与 `webpack.config.js` 里的 `entry` 名 + 生成的 HTML 文件名一致：
 * 入口名 `arcade` → `dist/arcade.html`；入口名 `windows-xp` → `dist/windows-xp.html`。
 */
export const GAMES: GameEntry[] = [
  {
    key: 'arcade',
    title: 'ICE Arcade',
    tagline: '一台掌机，四张卡带 —— 开机先跑 BIOS 自检再选卡带',
    page: 'arcade.html',
    accent: '#0d6efd',
    items: ['俄罗斯方块', '贪吃蛇', '2048', 'CHIP-8'],
    controls: [
      ['方向键', '移动 / 旋转'],
      ['空格', '硬降 / 暂停'],
      ['P · R · L', '暂停 · 重开 · 排行榜'],
      ['F2', '回到 BIOS 菜单'],
    ],
  },
  {
    key: 'windows-xp',
    title: 'Windows XP',
    tagline: '会自己开机的画布桌面：开机自检 → 欢迎屏 → 桌面',
    page: 'windows-xp.html',
    accent: '#245edb',
    items: [
      '扫雷',
      'ICE Arcade',
      '记事本',
      '画图',
      '我的电脑',
      '我的文档',
      'Internet Explorer',
      '显示属性',
    ],
    controls: [
      ['双击图标', '打开程序'],
      ['拖标题栏', '移动窗口'],
      ['开始菜单', '注销 / 关机'],
      ['右键雷区', '插旗 / 问号'],
    ],
  },
];

/** 按 key 找目录项；找不到返回 `undefined`（不抛错，调用方自己决定怎么兜）。 */
export function findGame(key: string): GameEntry | undefined {
  return GAMES.find((game) => game.key === key);
}

/** 打平所有机器收录的小游戏 / 程序。 */
export function allItems(): string[] {
  return GAMES.reduce<string[]>((acc, game) => acc.concat(game.items), []);
}

/** 目录规模：机器数 / 收录的小游戏与程序数。首页与 README 都引用它，避免两处手写数字。 */
export function catalogSize(): { machines: number; items: number } {
  return { machines: GAMES.length, items: allItems().length };
}

/** 入口页清单（相对 `dist/` 根），供构建校验与 e2e 逐页访问。 */
export function entryPages(): string[] {
  return GAMES.map((game) => game.page);
}
