/**
 * ICE 家族各仓的真实地址 —— 首页 navbar / footer 的链接来源。
 *
 * 为什么单独放一层数据而不写死在界面代码里：
 *  1. **可单测**：URL 形状、去重、必填字段都能在 node 里断言（`npm test` 秒级）；
 *  2. **一处维护**：链接会出现在 navbar、footer（可能还有以后的文档页），
 *     散落在 UI 里就会漏改一个；
 *  3. 本层**零运行时依赖**（不 import 任何 ICE 包），首页只把它当数据读。
 *
 * ## 这些地址是**核实过**的，不是猜的
 *
 * 每个 `url` 都来自对应仓库的 `git remote -v`（github 远端），并逐个用 HTTP 请求确认过
 * 返回 200（见 AGENTS.md 的核实记录）。新增仓库时请**同样核实**，别按命名习惯推断 ——
 * 家族里有 `ice-render-dsl` / `ice-chart-dsl` / `ice-entity-designer-dsl` 三个 DSL 包，
 * 光看名字很容易写错。
 */

/** 家族里的一个仓库。 */
export interface FamilyRepo {
  /** 仓库名（也是 GitHub 上的路径段）。 */
  name: string;
  /** 一句话定位（footer 里显示）。 */
  role: string;
  /** GitHub 地址（https，已核实可访问）。 */
  url: string;
  /**
   * 分组：`core` = 引擎与立即可用的库；`app` = 应用侧样板；`tooling` = 文档/DSL 等。
   * footer 按这个分栏，读者一眼能看出"哪几个是地基、哪几个是应用"。
   */
  group: 'core' | 'app' | 'tooling';
}

/** 家族仓库（顺序 = footer 里的显示顺序）。 */
export const FAMILY_REPOS: FamilyRepo[] = [
  {
    name: 'ice-render',
    role: 'Canvas 2D 渲染引擎（全家桶的地基）',
    url: 'https://github.com/ice-render/ice-render',
    group: 'core',
  },
  {
    name: 'ice-web-components',
    role: '画布原生 UI 控件库（86+ 组件）',
    url: 'https://github.com/ice-render/ice-web-components',
    group: 'core',
  },
  {
    name: 'ice-chart',
    role: '交互式图表库',
    url: 'https://github.com/ice-render/ice-chart',
    group: 'core',
  },
  {
    name: 'ice-entity-designer',
    role: '领域设计器（ER / 流程图 / BPMN / 状态机…）',
    url: 'https://github.com/ice-render/ice-entity-designer',
    group: 'core',
  },
  {
    name: 'ice-smart-water',
    role: '应用侧样板：市政污水厂工艺系统',
    url: 'https://github.com/ice-render/ice-smart-water',
    group: 'app',
  },
  {
    name: 'ice-render-doc',
    role: '文档站',
    url: 'https://github.com/ice-render/ice-render-doc',
    group: 'tooling',
  },
];

/** 家族 GitHub 主页（本仓所在的组织/用户页）。 */
export const FAMILY_HOME = 'https://github.com/ice-render';

/**
 * **本仓自己的状态**。
 *
 * `ice-game` 远端已建好（Gitee `ice-render/ice-game` + GitHub `ice-render/ice-game`），
 * 已双推。这里填 `url` + `published: true`，页脚自动渲染成可点链接。
 */
export const SELF_REPO: { name: string; role: string; url: string | null; published: boolean } = {
  name: 'ice-game',
  role: '本仓：画布游戏厅（用家族控件做的单页小游戏合集）',
  url: 'https://github.com/ice-render/ice-game',
  published: true,
};

/** 按分组取仓库。 */
export function reposInGroup(group: FamilyRepo['group']): FamilyRepo[] {
  return FAMILY_REPOS.filter((repo) => repo.group === group);
}

/** 所有可点链接（含家族主页）；本仓未开源时不含它 —— 页脚据此决定渲染成链接还是纯文本。 */
export function allLinks(): string[] {
  return [...FAMILY_REPOS.map((repo) => repo.url), FAMILY_HOME, ...(SELF_REPO.url ? [SELF_REPO.url] : [])];
}
