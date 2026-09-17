/**
 * 游戏目录 —— 本仓"有哪些页面、怎么分组"的唯一事实来源。
 *
 * 数据来自 `catalog.generated.json`（由 `npm run gen:catalog` 从各游戏目录的 `meta.json` 聚合），
 * 本文件只做两件事：**给它类型**、**给它查询与分组**。
 *
 * 为什么数据是生成物：手工维护的列表一定会漏。加了游戏忘了登记 → 构建收了它、首页却没有入口；
 * 删了游戏忘了删条目 → 首页点进去 404。现在这些都在构建期被门禁挡住。
 *
 * 这一层保持**零运行时依赖**（不 import 任何 ICE 包）：于是 `npm test` 不需要引擎产物、
 * 不需要 jsdom，跑得飞快；首页只把这里当数据源。
 */

import rawCatalog from './catalog.generated.json';

/** 页面种类。`game` = 自研小游戏；`machine` = 上游移植的整机（掌机 / XP 桌面）。 */
export type PageKind = 'game' | 'machine';

/** 一个页面（= 一个入口 = 一个 HTML）。 */
export interface CatalogPage {
  /** 稳定标识，同时是目录名、chunk 名与页面 URL（`<slug>.html`）；不要改。 */
  slug: string;
  kind: PageKind;
  /** 卡片标题。 */
  title: string;
  /** 一句话说明（首页一行，≤34 字）。 */
  tagline: string;
  /** 卡片主色。 */
  accent: string;
  /** 内含的小游戏 / 程序名（整机才有）。 */
  features: string[];
  /** 操作说明：`[按键, 作用]`。 */
  controls: [string, string][];
  /** 产物页面文件名（相对 `dist/` 根）。 */
  page: string;
  /**
   * 有没有封面图（`covers/<slug>.png`，由 `npm run covers` 自动抓取）。
   *
   * 由 `gen:catalog` 在构建前检查文件是否存在得出 —— 所以**构建期就知道**，
   * 首页不用去 fetch 探测。没有封面时首页画占位块（不至于开天窗）。
   */
  cover: boolean;
}

/**
 * `as unknown as` 是必要的：JSON 推断出的 `kind` 是 `string`，而目标是字面量联合。
 * 生成物由 `scan-games.cjs` 校验过（slug/kind/必填字段），测试里还会再断言一次字段合法性 ——
 * 类型断言在这里只是"不再重复表达同一件事"。
 */
const PAGES: CatalogPage[] = (rawCatalog as unknown as { pages: CatalogPage[] }).pages;

export { PAGES };

/** 一个分组（首页按分组分区渲染）。 */
export interface PageGroup {
  kind: PageKind;
  /** 分组标题。 */
  label: string;
  /** 分组说明（写在标题右侧或下方，可空）。 */
  blurb: string;
  items: CatalogPage[];
}

/**
 * 分组定义与顺序。
 *
 * **小游戏在前**：仓的名字叫游戏厅，自研小游戏是主角；两台整机是"展厅"里的彩蛋。
 * 分组靠 `kind` 从生成物里筛，所以新加的游戏只要 `meta.json` 写对 `kind` 就自动归位
 * （`kind` 与分区一致性由 `scan-games.cjs` 强制，写错在构建期就报错）。
 */
const GROUP_META: { kind: PageKind; label: string; blurb: string }[] = [
  { kind: 'game', label: '小游戏', blurb: '每个页面一个游戏，进去就是满屏 —— 不需要服务端' },
  { kind: 'machine', label: '整机展厅', blurb: '从 ice-web-components 的示例移植来的两台整机' },
];

/** 非空分组：没有内容的组不渲染（首页不会出现空标题）。 */
export const GROUPS: PageGroup[] = GROUP_META.map((meta) => ({
  ...meta,
  items: PAGES.filter((page) => page.kind === meta.kind),
})).filter((group) => group.items.length > 0);

/** 按 slug 找页面；找不到返回 `undefined`（不抛错，调用方自己决定怎么兜）。 */
export function findPage(slug: string): CatalogPage | undefined {
  return PAGES.find((page) => page.slug === slug);
}

/** 打平所有页面收录的小游戏 / 程序名。 */
export function allFeatures(): string[] {
  return PAGES.reduce<string[]>((acc, page) => acc.concat(page.features), []);
}

/** 目录规模：小游戏数 / 整机数 / 收录内容数。首页与 README 都引用它，避免手写数字。 */
export function stats(): { games: number; machines: number; features: number } {
  return {
    games: PAGES.filter((p) => p.kind === 'game').length,
    machines: PAGES.filter((p) => p.kind === 'machine').length,
    features: allFeatures().length,
  };
}

/** 入口页清单（相对 `dist/` 根），供构建校验与 e2e 逐页访问。 */
export function entryPages(): string[] {
  return PAGES.map((page) => page.page);
}

/**
 * 封面的站内路径（相对 HTML，因此 `file://` 下也能用）。
 *
 * 只对 `cover === true` 的页返回；调用方（首页）据此决定画封面还是占位块。
 * 路径与 `webpack.config.js` 的 `CopyCoversPlugin` 约定一致（`dist/covers/<slug>.png`）。
 */
export function coverUrl(page: CatalogPage): string | null {
  return page.cover ? `covers/${page.slug}.png` : null;
}

/** 缺封面的页面 slug（首页与门禁都用它提醒）。 */
export function pagesMissingCover(): string[] {
  return PAGES.filter((page) => !page.cover).map((page) => page.slug);
}
