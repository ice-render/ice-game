/**
 * 首页**吸顶导航栏** —— 画布原生实现。
 *
 * ## 为什么是"第二块画布"而不是画在页面画布里
 *
 * 首页是长页面、滚动的是**浏览器窗口**。画在页面画布里的话，导航会跟着内容一起滚走
 * （要它永远可见就得每帧按 scrollY 重画，等于自己造一个 sticky）。
 * 于是用家族里现成的套路：**岛** —— 一块独立画布 + 独立 `ICE` 实例，
 * CSS `position: fixed` 贴住视口顶部。这样：
 *   - 它是真正的吸顶（不随窗口滚动），且零重绘成本；
 *   - 与页面画布共享同一个引擎包（`check:wiring` 仍然保证只打一份引擎）；
 *   - 页面画布那边一行都不用改，只在 CSS 里给它留出顶部位置。
 *
 * 库里其实有 `ICEAffix`（吸顶容器）与 `ICEAnchor`（锚点导航），但**两者都服务于
 * `ICEScrollPane`**（画布内部滚动容器），而这里的滚动发生在窗口上 —— 直接用不上。
 * 这也是本模块存在的理由（而不是"忘了用现成组件"）。
 *
 * ## 宽度是固定的 1180
 *
 * 与页面画布同宽并居中：两者左右对齐，看起来是一个整体的版面；
 * 也因此**不需要响应式重排**（本仓其它页面同样是"固定设计尺寸、窗口小了裁切"）。
 *
 * 内容：左侧品牌徽标 + 名称，中间是分区锚点（点了滚到对应分组），
 * 右侧是家族 GitHub 与文档入口。
 */
import { ICELabel, ICEPanel } from 'ice-web-components';
import { FAMILY_HOME, FAMILY_REPOS } from '../domain/family-repos';
import { createPage, type GamePageHandle } from '../kit';
import { brandBadge, createLink, divider, textWidth, type LinkHandle } from './chrome';

/** 导航栏画布尺寸（CSS 里同步引用这两个值，改这里就够）。 */
export const NAVBAR = {
  width: 1180,
  height: 60,
  /** 底部圆角：顶部是方角（贴着视口边缘），底部圆角与卡片语言一致。 */
  radius: 16,
  /** 内容左右内边距。 */
  padX: 22,
};

/** 一个分区锚点（由首页传入：它才知道各分组在画布里的纵向位置）。 */
export interface NavbarSection {
  key: string;
  label: string;
  /** 目标分组的纵向位置（**页面画布坐标**）。 */
  canvasY: number;
}

export interface NavbarOptions {
  sections: NavbarSection[];
  /**
   * 把"页面画布坐标"换算成"文档坐标"，用于滚动定位与"当前区块"判断。
   * 由首页提供（它知道画布在文档里的位置）；导航栏不猜版面。
   */
  toDocumentY: (canvasY: number) => number;
  /** 打开外链（默认新标签页；测试可注入以便断言）。 */
  openLink?: (url: string) => void;
}

export interface NavbarHandle {
  page: GamePageHandle;
  width: number;
  height: number;
  sections: NavbarSection[];
  /** 当前高亮的分区 key。 */
  activeKey: string | null;
  /** 所有可点链接（含外链）—— e2e 拿它断言"链接都在、地址都对"。 */
  links: { id: string; text: string; url: string | null }[];
  /** 手动改高亮（测试与调试用）。 */
  setActive(key: string | null): void;
  /** 滚到某个分区（分区链接点击走的就是它）。 */
  scrollToSection(key: string): void;
  /** 解绑滚动监听（页面销毁时）。 */
  destroy(): void;
}

export function mountNavbar(options: NavbarOptions): NavbarHandle {
  const canvas = document.getElementById('navbar') as HTMLCanvasElement | null;
  if (!canvas) throw new Error('mountNavbar：找不到 <canvas id="navbar">');

  // 先定尺寸再建引擎：引擎初始化时读的就是 canvas 的宽高
  canvas.width = NAVBAR.width;
  canvas.height = NAVBAR.height;

  const page = createPage({ canvasId: 'navbar', continuousFrames: false });
  const theme = page.theme;

  const openLink = options.openLink || ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));

  /*
   * 背景条：故意**越出画布顶部** `radius` 像素。
   *
   * `ICEPanel` 只支持整体圆角（没有"指定哪几个角"的 API），而这里要的是
   * "顶部方角贴住视口、底部圆角"——把面板上移 radius，圆角部分就画到画布外被裁掉了，
   * 可见部分正好是想要的样子。比自己去改组件或画一条自定义路径都简单。
   */
  const bar = new ICEPanel({
    id: 'navbar-bar',
    interactive: false,
    left: 0,
    top: -NAVBAR.radius,
    width: NAVBAR.width,
    height: NAVBAR.height + NAVBAR.radius,
    radius: NAVBAR.radius,
    style: {
      // 半透明：页面内容从下面滚过时能透出一点，是"磨砂条"的感觉
      fillStyle: 'rgba(9, 12, 18, 0.86)',
      strokeStyle: theme.colors.border,
      lineWidth: 1,
      ...theme.shadows.md,
    },
  });
  page.ice.addChild(bar);

  /* ------------------------------- 左侧品牌 ------------------------------- */

  const badgeSize = 28;
  brandBadge(bar, {
    left: NAVBAR.padX,
    top: Math.round((NAVBAR.height - badgeSize) / 2),
    size: badgeSize,
    accent: theme.colors.primary,
  });
  const brandText = new ICELabel({
    interactive: false,
    left: NAVBAR.padX + badgeSize + 10,
    top: 0,
    width: 120,
    height: NAVBAR.height,
    verticalAlign: 'middle',
    text: 'ICE GAME',
    style: { fontSize: 17, fontWeight: '700', fillStyle: theme.colors.text },
  });
  bar.addChild(brandText, false);

  /* ------------------------------- 分区锚点 ------------------------------- */

  const brandRight = NAVBAR.padX + badgeSize + 10 + textWidth('ICE GAME', 17);
  // 品牌与分区之间一条竖线：把"标识"和"导航"分开，避免看起来像一长串
  divider(bar, { left: brandRight + 18, top: 16, height: NAVBAR.height - 32, color: theme.colors.borderSecondary });

  const sectionLinks: LinkHandle[] = [];
  let cursorX = brandRight + 34;
  for (const section of options.sections) {
    const handle = createLink(bar, page, {
      id: `navbar-section-${section.key}`,
      left: cursorX,
      top: 0,
      height: NAVBAR.height,
      text: section.label,
      fontSize: 13.5,
      paddingX: 12,
      accent: theme.colors.primary,
      underline: true,
      onClick: () => scrollToSection(section.key),
    });
    sectionLinks.push(handle);
    cursorX += handle.node.state.width;
  }

  /* ------------------------------- 右侧外链 ------------------------------- */

  const docRepo = FAMILY_REPOS.find((repo) => repo.name === 'ice-render-doc');
  const externals: { id: string; text: string; url: string; emphasize?: boolean }[] = [
    ...(docRepo ? [{ id: 'navbar-docs', text: '文档', url: docRepo.url }] : []),
    { id: 'navbar-github', text: 'GitHub', url: FAMILY_HOME, emphasize: true },
  ];

  /**
   * 从右往左算位置（最后一个贴右边距，往前依次让位），**先算完位置再挂节点**。
   *
   * 顺序有讲究：GitHub 那颗要垫一层强调底板，底板必须**先挂**（挂载顺序 = 绘制顺序，
   * 后挂的盖在上面）。曾经试过先挂链接再往 `childNodes` 里 unshift 底板 ——
   * 那是绕过引擎的挂载逻辑（不设 `parentNode`、不走置脏），不能用。
   */
  const placed: { item: (typeof externals)[number]; left: number; width: number }[] = [];
  let rightX = NAVBAR.width - NAVBAR.padX;
  for (const item of [...externals].reverse()) {
    const width = textWidth(item.text, 13.5) + 24;
    rightX -= width;
    placed.push({ item, left: rightX, width });
  }
  placed.reverse(); // 还原成从左到右的顺序（便于阅读；挂载顺序另按 need 处理）

  // 强调底板（GitHub）
  for (const { item, left, width } of placed) {
    if (!item.emphasize) continue;
    const plate = new ICEPanel({
      interactive: false,
      left,
      top: Math.round((NAVBAR.height - 32) / 2),
      width,
      height: 32,
      radius: 8,
      style: {
        fillStyle: 'rgba(13, 110, 253, 0.16)',
        strokeStyle: theme.colors.primary,
        lineWidth: 1,
        shadowBlur: 0,
      },
    });
    bar.addChild(plate, false);
  }

  const externalHandles: LinkHandle[] = [];
  for (const { item, left, width } of placed) {
    externalHandles.push(
      createLink(bar, page, {
        id: item.id,
        left,
        top: 0,
        width,
        height: NAVBAR.height,
        text: item.text,
        fontSize: 13.5,
        align: 'center',
        accent: theme.colors.primary,
        underline: true,
        onClick: () => openLink(item.url),
      }),
    );
  }

  /* --------------------------- 当前区块高亮 --------------------------- */

  /**
   * 滚动时高亮"当前所在分组"。
   *
   * 判据：视口上方（留出导航高度 + 一点余量）**最近的一个**分组标题。
   * 用 `toDocumentY` 把画布坐标换算成文档坐标，所以这里不关心版面怎么排。
   *
   * ⚠️ 还没滚过第一个分组时（页面刚打开、停在 hero），要**回退到第一个**而不是"一个都不亮"：
   * 分组标题在 hero 下方，滚到顶时本来就没经过任何标题 —— 按字面规则会得到"无高亮"，
   * 看起来像坏了（实测第一版就是这样）。阅读位置在"第一组之前"，
   * 语义上就该认为当前在第一组。
   */
  const computeActive = (): string | null => {
    if (!options.sections.length) return null;
    const line = window.scrollY + NAVBAR.height + 24;
    let current: string | null = null;
    for (const section of options.sections) {
      if (options.toDocumentY(section.canvasY) <= line) current = section.key;
    }
    return current ?? options.sections[0].key;
  };

  let activeKey: string | null = null;
  const applyActive = () => {
    const next = computeActive();
    if (next === activeKey) return;
    activeKey = next;
    options.sections.forEach((section, index) => {
      sectionLinks[index]?.setActive(section.key === next);
    });
  };

  const onScroll = () => applyActive();
  // `passive: true`：只是读滚动位置、不改滚动行为，别拖慢滚动
  window.addEventListener('scroll', onScroll, { passive: true });

  const scrollToSection = (key: string) => {
    const section = options.sections.find((item) => item.key === key);
    if (!section) return;
    // 减掉导航高度与一点余量，否则目标分组会被导航栏压住
    window.scrollTo({ top: options.toDocumentY(section.canvasY) - NAVBAR.height - 16, behavior: 'smooth' });
    // 平滑滚动过程中 scroll 事件会持续触发，高亮随后自动跟上；这里先立即响应点击
    activeKey = key;
    options.sections.forEach((section2, index) => sectionLinks[index]?.setActive(section2.key === key));
  };

  applyActive();
  page.ice.dirty = true;

  return {
    page,
    width: NAVBAR.width,
    height: NAVBAR.height,
    sections: options.sections,
    get activeKey() {
      return activeKey;
    },
    links: [
      ...options.sections.map((section) => ({ id: `navbar-section-${section.key}`, text: section.label, url: null })),
      ...externals.map((item) => ({ id: item.id, text: item.text, url: item.url })),
    ],
    setActive(key) {
      activeKey = key;
      options.sections.forEach((section, index) => sectionLinks[index]?.setActive(section.key === key));
    },
    scrollToSection,
    destroy() {
      window.removeEventListener('scroll', onScroll);
    },
  };
}
