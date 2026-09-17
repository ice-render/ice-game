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
 * ## ⚠️ 结构：**背景层与内容层必须分开**
 *
 * 想要"顶部两个角是方角（贴住视口）、底部两个角是圆角"，最省事的做法是把背景面板
 * 上移 `radius` 像素、让上边越出画布被裁掉 —— `ICEPanel` 只支持整体圆角，
 * 没有"指定哪几个角"这种 API。
 *
 * **但子节点是相对父容器定位的**：把导航项挂在 `top: -radius` 的容器下，
 * 它们的 `top: 0` 就变成了画布 y = -radius —— 整条导航的内容被顶掉 `radius` 像素。
 * 实测症状：文字贴上边缘、徽标只剩半截（当时还以为是"垂直居中坏了"）。
 *
 * 所以这里分成两个兄弟层：
 *   ```
 *   #navbar 画布
 *   ├── bar      （top: -radius，只是背景；越出部分被裁掉 → 顶部方角、底部圆角）
 *   └── content  （top: 0，高度 = 导航高度；**所有导航项挂这里**，坐标正常）
 *   ```
 * 一眼看不出差别，但再也不会互相干扰。改这个文件时别把两层合回去。
 */
import { ICELabel, ICEPanel, ICEWidget } from 'ice-web-components';
import { FAMILY_HOME, FAMILY_REPOS } from '../domain/family-repos';
import { GamePage } from '../kit';
import { brandBadge, createLink, textWidth, type LinkHandle } from './chrome';

/** 导航栏画布尺寸（CSS 里同步引用高度，改这里就够）。 */
export const NAVBAR = {
  width: 1180,
  height: 64,
  /** 底部圆角（顶部是方角，靠背景层上移裁掉）。 */
  radius: 18,
  /** 内容左右内边距。 */
  padX: 26,
};

/** 导航项 / 按钮的胶囊尺寸与字号。 */
const PILL = { height: 36, fontSize: 13.5 };
/** 品牌徽标尺寸。 */
const BADGE_SIZE = 30;

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
  page: GamePage;
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

  const page = new GamePage({ canvasId: 'navbar', continuousFrames: false });
  const theme = page.theme;
  const accent = theme.colors.primary;

  const openLink = options.openLink || ((url: string) => window.open(url, '_blank', 'noopener,noreferrer'));

  /* ------------------------------ 背景层 ------------------------------ */

  // 上移 radius、高度多出 radius：越出画布的上边（含两个圆角）被裁掉 → 顶部方角、底部圆角
  const barGradient = page.ice.createLinearGradient(0, -NAVBAR.radius, 0, NAVBAR.height);
  barGradient.addColorStop(0, 'rgba(18, 25, 40, 0.94)');
  barGradient.addColorStop(0.62, 'rgba(11, 15, 24, 0.90)');
  barGradient.addColorStop(1, 'rgba(8, 11, 18, 0.86)');

  page.ice.addChild(
    new ICEPanel({
      id: 'navbar-bar',
      interactive: false,
      left: 0,
      top: -NAVBAR.radius,
      width: NAVBAR.width,
      height: NAVBAR.height + NAVBAR.radius,
      radius: NAVBAR.radius,
      style: {
        fillStyle: barGradient,
        strokeStyle: 'rgba(94, 132, 214, 0.30)',
        lineWidth: 1,
        ...theme.shadows.md,
      },
    }),
  );

  /*
   * 顶部一条"霓虹"线：画布最上沿 2px 的横向渐变（两端透明、中间亮）。
   *
   * 挂在**画布根**上而不是 bar 里：bar 顶部那两个角被裁掉了，
   * 挂在 bar 里的话线会跟着圆角一起被切掉两端。
   */
  const topLine = page.ice.createLinearGradient(0, 0, NAVBAR.width, 0);
  topLine.addColorStop(0, 'rgba(13, 110, 253, 0)');
  topLine.addColorStop(0.26, 'rgba(13, 110, 253, 0.70)');
  topLine.addColorStop(0.5, 'rgba(96, 196, 255, 0.95)');
  topLine.addColorStop(0.74, 'rgba(13, 110, 253, 0.70)');
  topLine.addColorStop(1, 'rgba(13, 110, 253, 0)');
  page.ice.addChild(
    new ICEPanel({
      id: 'navbar-topline',
      interactive: false,
      left: 0,
      top: 0,
      width: NAVBAR.width,
      height: 2,
      radius: 0,
      style: { fillStyle: topLine, strokeStyle: 'rgba(0,0,0,0)', lineWidth: 0, shadowBlur: 0 },
    }),
  );

  /* ------------------------------ 内容层 ------------------------------ */

  // 所有导航项挂在这一层（top: 0，坐标与"看起来的位置"一致）
  const content = new ICEWidget({
    id: 'navbar-content',
    interactive: false,
    left: 0,
    top: 0,
    width: NAVBAR.width,
    height: NAVBAR.height,
    fill: false,
    stroke: false,
  });
  page.ice.addChild(content);

  /* ------------------------------- 品牌 ------------------------------- */

  const badgeLeft = NAVBAR.padX;
  const badgeTop = Math.round((NAVBAR.height - BADGE_SIZE) / 2);
  const badgeGradient = page.ice.createLinearGradient(
    badgeLeft,
    badgeTop,
    badgeLeft + BADGE_SIZE,
    badgeTop + BADGE_SIZE,
  );
  badgeGradient.addColorStop(0, '#4d94ff');
  badgeGradient.addColorStop(1, '#0b5ed7');
  brandBadge(content, {
    left: badgeLeft,
    top: badgeTop,
    size: BADGE_SIZE,
    accent,
    fillStyle: badgeGradient,
    glow: true,
  });

  const brandLeft = badgeLeft + BADGE_SIZE + 12;
  content.addChild(
    new ICELabel({
      interactive: false,
      left: brandLeft,
      top: 0,
      width: 150,
      height: NAVBAR.height,
      align: 'left',
      verticalAlign: 'middle',
      text: 'ICE GAME',
      style: { fontSize: 18, fontWeight: '700', fillStyle: theme.colors.text },
    }),
    false,
  );

  /* --------------------------- 分区锚点（胶囊） --------------------------- */

  const brandRight = brandLeft + textWidth('ICE GAME', 18);

  // 品牌区与导航区之间的竖线（分栏暗示）
  content.addChild(
    new ICEPanel({
      interactive: false,
      left: brandRight + 14,
      top: Math.round((NAVBAR.height - 22) / 2),
      width: 1,
      height: 22,
      radius: 0,
      style: {
        fillStyle: 'rgba(255,255,255,0.12)',
        strokeStyle: 'rgba(255,255,255,0)',
        lineWidth: 0,
        shadowBlur: 0,
      },
    }),
    false,
  );

  let cursorX = brandRight + 32;
  const sectionLinks: LinkHandle[] = [];
  for (const section of options.sections) {
    const handle = createLink(content, page, {
      id: `navbar-section-${section.key}`,
      left: cursorX,
      top: Math.round((NAVBAR.height - PILL.height) / 2),
      height: PILL.height,
      text: section.label,
      fontSize: PILL.fontSize,
      paddingX: 16,
      align: 'center',
      accent,
      pill: true,
      onClick: () => scrollToSection(section.key),
    });
    sectionLinks.push(handle);
    cursorX += handle.node.state.width + 6;
  }

  /* ------------------------------- 右侧外链 ------------------------------- */

  const docRepo = FAMILY_REPOS.find((repo) => repo.name === 'ice-render-doc');
  const externals: { id: string; text: string; url: string; solid: boolean }[] = [
    ...(docRepo ? [{ id: 'navbar-docs', text: '文档', url: docRepo.url, solid: false }] : []),
    { id: 'navbar-github', text: 'GitHub', url: FAMILY_HOME, solid: true },
  ];

  /**
   * 从右往左算位置，**先算完再挂节点**。
   *
   * 顺序有讲究：胶囊底必须在内容之前挂（挂载顺序 = 绘制顺序，后挂的盖在上面）。
   * 曾经试过先挂链接、再往 `childNodes` 里 unshift 底色 —— 那是绕过引擎的挂载逻辑
   * （不设 `parentNode`、不走置脏），不能用。
   */
  const placed: { item: (typeof externals)[number]; left: number; width: number }[] = [];
  let rightX = NAVBAR.width - NAVBAR.padX;
  for (const item of [...externals].reverse()) {
    const width = textWidth(item.text, PILL.fontSize) + 40;
    rightX -= width;
    placed.push({ item, left: rightX, width });
    rightX -= 8;
  }
  placed.reverse();

  const externalHandles: LinkHandle[] = [];
  for (const { item, left, width } of placed) {
    externalHandles.push(
      createLink(content, page, {
        id: item.id,
        left,
        top: Math.round((NAVBAR.height - PILL.height) / 2),
        width,
        height: PILL.height,
        text: item.text,
        fontSize: PILL.fontSize,
        align: 'center',
        accent,
        pill: true,
        solid: item.solid,
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
   * 监听用 `passive: true`（不改滚动行为，别拖慢滚动）。
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
  window.addEventListener('scroll', onScroll, { passive: true });

  const scrollToSection = (key: string) => {
    const section = options.sections.find((item) => item.key === key);
    if (!section) return;
    // 减掉导航高度与一点余量，否则目标分组会被导航栏压住
    window.scrollTo({ top: options.toDocumentY(section.canvasY) - NAVBAR.height - 16, behavior: 'smooth' });
    // 平滑滚动过程中 scroll 事件会持续触发，高亮随后自动跟上；这里先立即响应点击
    activeKey = key;
    options.sections.forEach((item, index) => sectionLinks[index]?.setActive(item.key === key));
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
