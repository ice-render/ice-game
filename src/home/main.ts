/**
 * 游戏厅首页 —— 本工程唯一"自己写的非游戏页面"，把目录铺成**带封面的卡片网格**。
 *
 * 版面自上而下：**吸顶导航**（独立画布 `#navbar`，见 `navbar.ts`）→ hero 标题带 →
 * 分组网格 → **页脚**（家族仓库链接，见 `footer.ts`）。
 *
 * 三件事：① 从 `src/domain/catalog.ts` 取分组；② 按列宽自动换行铺卡片；
 * ③ 点卡片/按钮进对应页面。**加一个新游戏不需要改这个文件**。
 *
 * ## 画布高度按内容算
 *
 * 内容多高画布就多高，页面纵向滚动 —— 这是"大量游戏"下的必然选择，
 * 固定画布要么裁卡片、要么逼每张卡缩成一条。
 * ⚠️ 页脚高度必须从 `measureFooterHeight()`（纯函数）拿：**总高要在创建引擎之前定下来**，
 * 而那时还没有引擎可用，`buildFooter()` 还跑不了。顺序错了页脚就会被画布底边裁掉。
 *
 * ## 圆角是烘在 PNG 里的
 *
 * 引擎的 `ICEImage` 不支持圆角裁剪（`clipType` 只有 `circle`），面板也不裁剪子节点，
 * 所以封面圆角只能在生成时用离屏画布的 `clip()` 裁好（`npm run covers`）。
 */
import { ICEImage } from 'ice-render';
import { ICEButton, ICELabel, ICEPanel } from 'ice-web-components';
import { GROUPS, PAGES, coverUrl, pagesMissingCover, stats, type GamePage } from '../domain/catalog';
import { createPage, type GamePageHandle } from '../kit';
import { buildFooter, measureFooterHeight } from './footer';
import { mountNavbar, NAVBAR, type NavbarHandle } from './navbar';

/** 导航栏高度（引用 `navbar.ts` 的常量，避免两处各写一个数）。 */
const NAVBAR_HEIGHT = NAVBAR.height;

/* --------------------------------- 版面常量 --------------------------------- */

const CANVAS_WIDTH = 1180;
const PAD = 44;
const COLS = 3;
const GAP = 22;
const HEADER_HEIGHT = 148;
const GROUP_HEADER_HEIGHT = 58;
const GROUP_GAP = 26;
/** 最小画布高度：内容少时不至于挤成一条，也不至于留下大片空白。 */
const MIN_CANVAS_HEIGHT = 660;

/**
 * 最后一个分组的底部 → 页脚分隔线的间距。
 *
 * 必须是一个**共享常量**：`measureCanvasHeight()` 用它预留、`buildFooter` 的 `top` 也用它，
 * 两处各写一个数就会出现"页脚比预留低了几像素 → 被画布底边裁掉"这类只在截图里能看出的问题。
 */
const FOOTER_TOP_GAP = 30;

const CARD_WIDTH = Math.floor((CANVAS_WIDTH - PAD * 2 - GAP * (COLS - 1)) / COLS);
/** 封面按 16:9 显示（生成时也是 16:9，所以绘制不会拉伸变形）。 */
const COVER_INSET = 14;
const COVER_WIDTH = CARD_WIDTH - COVER_INSET * 2;
const COVER_HEIGHT = Math.round((COVER_WIDTH * 9) / 16);

/** 卡片各行的纵向偏移：由封面高度推出，改封面尺寸时下面跟着走。 */
const ROW = {
  cover: COVER_INSET,
  title: COVER_INSET + COVER_HEIGHT + 16,
  tagline: COVER_INSET + COVER_HEIGHT + 44,
  meta: COVER_INSET + COVER_HEIGHT + 70,
};
const BUTTON = { width: 104, height: 36 };
const CARD_HEIGHT = ROW.meta + BUTTON.height + 16;

const CARD_RADIUS = 14;

/** chip 宽度估算：CJK 一字约 1em，ASCII 约 0.58em，再加左右内边距。 */
function chipWidth(text: string, fontSize = 11): number {
  let width = 0;
  for (const ch of text) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
  return Math.ceil(width) + 18;
}

/**
 * 画布高度 = hero + 各分组 + 页脚 + 底部留白。
 * 先算高度、写进 canvas 属性，**再**建引擎 —— 引擎初始化时读的就是这个尺寸
 * （顺序反了会拿到旧的初始高度，下面的卡片与页脚全被裁掉）。
 */
function measureCanvasHeight(): number {
  let height = PAD + HEADER_HEIGHT;
  for (const group of GROUPS) {
    const rows = Math.ceil(group.items.length / COLS);
    height += GROUP_HEADER_HEIGHT + rows * CARD_HEIGHT + (rows - 1) * GAP + GROUP_GAP;
  }
  // 页脚（含它的上分隔线）—— 纯函数量高，与 buildFooter 共用同一份布局
  height += FOOTER_TOP_GAP + measureFooterHeight();
  return Math.max(MIN_CANVAS_HEIGHT, height + PAD);
}

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
canvas.width = CANVAS_WIDTH;
canvas.height = measureCanvasHeight();

const page: GamePageHandle = createPage({ continuousFrames: false });
const theme = page.theme;

const goto = (target: string) => {
  window.location.href = target;
};

/**
 * 打开外部链接（新标签页）。
 *
 * 抽成一处而不是各链接自己 `window.open`：`noopener,noreferrer` 这类安全参数只写一遍，
 * 将来要改成"先在站内确认页中转"也只动这里。
 */
const openLinkOutside = (url: string) => {
  window.open(url, '_blank', 'noopener,noreferrer');
};

/* --------------------------------- hero --------------------------------- */

const { games, machines, features } = stats();

/** hero 左侧的品牌竖条：让页面有个明确的视觉起点（品牌名在吸顶导航里，这里不重复）。 */
page.ice.addChild(
  new ICEPanel({
    interactive: false,
    left: PAD,
    top: PAD + 6,
    width: 5,
    height: 42,
    radius: 3,
    style: { fillStyle: theme.colors.primary, strokeStyle: theme.colors.primary },
  }),
);
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD + 18,
    top: PAD,
    width: CANVAS_WIDTH - PAD * 2 - 300,
    text: '画布游戏厅',
    style: { fontSize: 32, fontWeight: '700', fillStyle: theme.colors.text },
  }),
);
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD + 18,
    top: PAD + 48,
    width: CANVAS_WIDTH - PAD * 2 - 300,
    text: '用 ICE 家族的引擎与控件做的单页小游戏 —— 连卡片封面都是自动抓的真实画面',
    style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
  }),
);
/** 规模数字取自目录，不手写 —— 加了游戏忘了改这里是做不到的。 */
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: CANVAS_WIDTH - PAD - 280,
    top: PAD + 14,
    width: 280,
    align: 'right',
    text: `${games} 个小游戏 · ${machines} 台整机 · ${features} 项可玩`,
    style: { fontSize: 13, fillStyle: theme.colors.textTertiary },
  }),
);
/** 头部与内容之间的分隔线（一根细线比整块留白更有信息量）。 */
page.ice.addChild(
  new ICEPanel({
    interactive: false,
    left: PAD,
    top: PAD + HEADER_HEIGHT - 30,
    width: CANVAS_WIDTH - PAD * 2,
    height: 1,
    radius: 0,
    style: { fillStyle: theme.colors.borderSecondary, strokeStyle: theme.colors.borderSecondary },
  }),
);

/* --------------------------------- 卡片 --------------------------------- */

interface CardNodes {
  card: any;
  button: any;
  /** 悬停时高亮的外框（平时隐藏，鼠标上来才显示）。 */
  frame: any;
}

const nodes: Record<string, CardNodes> = {};

/** 没有封面时的占位块：accent 大号首字，看起来是"有意留白"而不是漏了图。 */
function renderCoverPlaceholder(card: any, game: GamePage): void {
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: COVER_INSET,
      top: ROW.cover,
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      radius: 10,
      style: { fillStyle: theme.colors.elevated, strokeStyle: theme.colors.borderSecondary },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: COVER_INSET,
      top: ROW.cover + Math.round(COVER_HEIGHT / 2) - 30,
      width: COVER_WIDTH,
      align: 'center',
      text: game.title.slice(0, 1),
      style: { fontSize: 52, fontWeight: '700', fillStyle: game.accent },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: COVER_INSET,
      top: ROW.cover + Math.round(COVER_HEIGHT / 2) + 32,
      width: COVER_WIDTH,
      align: 'center',
      text: '封面待抓取 · npm run covers',
      style: { fontSize: 11, fillStyle: theme.colors.textTertiary },
    }),
    false,
  );
}

/** 封面图：路径稳定（`covers/<slug>.png`），加载完引擎会自己置脏重绘。 */
function renderCover(card: any, game: GamePage): void {
  const src = coverUrl(game);
  if (!src) {
    renderCoverPlaceholder(card, game);
    return;
  }
  card.addChild(
    new ICEImage({
      id: `game-cover-${game.slug}`,
      interactive: false,
      left: COVER_INSET,
      top: ROW.cover,
      width: COVER_WIDTH,
      height: COVER_HEIGHT,
      src,
    }),
    false,
  );
}

function buildCard(game: GamePage, left: number, top: number): CardNodes {
  const card = new ICEPanel({
    id: `game-card-${game.slug}`,
    left,
    top,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    radius: CARD_RADIUS,
    style: { fillStyle: theme.colors.surface, strokeStyle: theme.colors.border },
  });
  // 整张卡片可点（不只按钮）—— 卡片是最自然的点击目标
  card.on('click', () => goto(game.page));
  page.ice.addChild(card);

  /**
   * 悬停高亮框：与卡片同尺寸叠一层，用该游戏的 accent 色描边，平时 `display: false`。
   *
   * 为什么不直接改卡片自己的描边：卡片是 `ICEPanel`，它内部把 `stroke` 写死为 `true`，
   * 直接改 `strokeStyle` 会让"常态外观"与"悬停外观"耦合在一处；
   * 叠一层专门的高亮框更干净，也让"悬停"只有一个实现点。
   * 事件来自 `ICEHoverManager`（它按 `interactive` + 命中测试派发 `hoverchange`）。
   */
  const frame = new ICEPanel({
    id: `game-hover-${game.slug}`,
    interactive: false,
    left: 0,
    top: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    radius: CARD_RADIUS,
    style: { fillStyle: 'rgba(0,0,0,0)', strokeStyle: game.accent },
  });
  frame.setState({ display: false });
  card.addChild(frame, false);

  /**
   * 悬停时显示高亮框。
   *
   * ⚠️ 事件载荷的形状别猜：`ICEWidget.setHovered()` 调的是
   * `this.trigger('hoverchange', null, { hovered })`，而 `trigger(eventName, originalEvent, param)`
   * 会把数据塞进 **`evt.param`** —— 所以 handler 收到的是 `ICEEvent`，要读 `evt.param.hovered`。
   * 直接读 `payload.hovered` 恒为 `undefined`（实测：悬停框永远不显示，且没有任何报错）。
   */
  card.on('hoverchange', (payload: any) => {
    const hovered = Boolean(payload && payload.param && payload.param.hovered);
    frame.setState({ display: hovered });
    page.ice.dirty = true;
  });

  renderCover(card, game);

  card.addChild(
    new ICELabel({
      interactive: false,
      left: COVER_INSET,
      top: ROW.title,
      width: COVER_WIDTH - 56,
      text: game.title,
      style: { fontSize: 19, fontWeight: '700', fillStyle: theme.colors.text },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: COVER_INSET,
      top: ROW.tagline,
      width: COVER_WIDTH,
      text: game.tagline,
      style: { fontSize: 12.5, fillStyle: theme.colors.textSecondary },
    }),
    false,
  );

  /* 元信息行：左边 chip（内含物 / 按键提示），右边「进入」按钮。 */

  const source =
    game.features.length > 0 ? game.features.slice(0, 3) : game.controls.slice(0, 3).map(([keys]) => keys);
  let chipLeft = COVER_INSET;
  const chipLimit = CARD_WIDTH - COVER_INSET - BUTTON.width - 14;
  for (const text of source) {
    const width = chipWidth(text);
    if (chipLeft + width > chipLimit) break; // 放不下就不再放（宁可少一个 chip，也不越界）
    card.addChild(
      new ICEPanel({
        interactive: false,
        left: chipLeft,
        top: ROW.meta + 4,
        width,
        height: 22,
        radius: 6,
        style: { fillStyle: theme.colors.elevated, strokeStyle: theme.colors.borderSecondary },
      }),
      false,
    );
    card.addChild(
      new ICELabel({
        interactive: false,
        left: chipLeft,
        top: ROW.meta + 4,
        width,
        height: 22,
        align: 'center',
        verticalAlign: 'middle',
        text,
        style: { fontSize: 11, fillStyle: theme.colors.textSecondary },
      }),
      false,
    );
    chipLeft += width + 6;
  }

  const button = new ICEButton({
    id: `game-enter-${game.slug}`,
    left: CARD_WIDTH - COVER_INSET - BUTTON.width,
    top: ROW.meta,
    width: BUTTON.width,
    height: BUTTON.height,
    text: '进入',
    radius: 8,
    style: { fillStyle: game.accent, strokeStyle: game.accent },
  });
  // 按钮点击走事件（构造函数不吃 `onClick`；`ICESegmented` 那类才走构造参数）
  button.on('click', () => goto(game.page));
  card.addChild(button, false);

  // 右上角徽标：叠在封面之上，让类型一眼可辨
  const badgeText = game.kind === 'machine' ? '整机' : '小游戏';
  const badgeWidth = 48;
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: CARD_WIDTH - COVER_INSET - badgeWidth - 8,
      top: ROW.cover + 8,
      width: badgeWidth,
      height: 20,
      radius: 10,
      style: { fillStyle: 'rgba(4,6,10,0.72)', strokeStyle: game.accent },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: CARD_WIDTH - COVER_INSET - badgeWidth - 8,
      top: ROW.cover + 8,
      width: badgeWidth,
      height: 20,
      align: 'center',
      verticalAlign: 'middle',
      text: badgeText,
      style: { fontSize: 11, fillStyle: theme.colors.text },
    }),
    false,
  );

  return { card, button, frame };
}

let cursorY = PAD + HEADER_HEIGHT;

/**
 * 各分组的纵向位置（页面画布坐标）—— 吸顶导航的锚点链接要滚到这里。
 * 在铺卡片的过程中顺手记下，不必等布局结束再回头找。
 */
const sectionAnchors: { key: string; label: string; canvasY: number }[] = [];

for (const group of GROUPS) {
  page.ice.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: cursorY,
      width: 130,
      text: group.label,
      style: { fontSize: 18, fontWeight: '700', fillStyle: theme.colors.text },
    }),
  );
  page.ice.addChild(
    new ICELabel({
      interactive: false,
      left: PAD + 118,
      top: cursorY + 6,
      width: CANVAS_WIDTH - PAD * 2 - 118,
      text: `${group.blurb}　·　${group.items.length} 个`,
      style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
    }),
  );

  const gridTop = cursorY + GROUP_HEADER_HEIGHT;
  group.items.forEach((game, index) => {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const left = PAD + col * (CARD_WIDTH + GAP);
    const top = gridTop + row * (CARD_HEIGHT + GAP);
    nodes[game.slug] = buildCard(game, left, top);
  });

  // 记下分组的纵向位置（吸顶导航的锚点用它滚动）
  sectionAnchors.push({ key: group.kind, label: group.label, canvasY: cursorY });

  const rows = Math.ceil(group.items.length / COLS);
  cursorY = gridTop + rows * CARD_HEIGHT + (rows - 1) * GAP + GROUP_GAP;
}

/** 底部提示：缺封面时直接点名（这是"该跑 covers 了"的唯一提醒处）。 */
const missing = pagesMissingCover();
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD,
    top: cursorY + 8,
    width: CANVAS_WIDTH - PAD * 2,
    text:
      missing.length > 0
        ? `有 ${missing.length} 个页面还没抓封面（${missing.join('、')}）—— 跑 npm run covers`
        : '每个页面各自独占整屏与键盘：进去之后按浏览器「后退」回到这里',
    style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
  }),
);

/* --------------------------------- 页脚 --------------------------------- */

const footer = buildFooter({
  page,
  left: PAD,
  top: cursorY + FOOTER_TOP_GAP,
  width: CANVAS_WIDTH - PAD * 2,
  openLink: openLinkOutside,
});

/**
 * 自检：页脚必须落在画布内。
 *
 * 预留值是 `FOOTER_TOP_GAP + measureFooterHeight()`（与上面 `measureCanvasHeight()` 同一口径），
 * 而 `buildFooter` 用的是同一份布局函数，所以正常情况下必然够用。
 * 留着这道断言是为了"将来有人改了页脚布局、却忘了同步度量"时**立刻报错** ——
 * 否则症状是"页脚被画布底边静默裁掉"，只有翻截图才发现。
 */
{
  const footerBottom = cursorY + FOOTER_TOP_GAP + footer.height;
  if (footerBottom > canvas.height) {
    throw new Error(
      `首页页脚越出画布：页脚底部 ${footerBottom}px > 画布高 ${canvas.height}px。` +
        `检查 footer.ts 的 measureFooterHeight() 与 buildFooter() 是否共用同一份布局。`,
    );
  }
}

/* --------------------------------- 吸顶导航 --------------------------------- */

/**
 * 导航栏是**独立画布**（`#navbar`，CSS `position: fixed`）—— 详见 `navbar.ts` 顶部的说明。
 *
 * 它需要"页面画布坐标 → 文档坐标"的换算来定位锚点，所以把 `toDocumentY` 交给它，
 * 导航栏自己不去猜页面版面（两者职责分开，改版面不用动导航）。
 */
const navbar: NavbarHandle = mountNavbar({
  sections: sectionAnchors,
  toDocumentY: (canvasY) => canvas.getBoundingClientRect().top + window.scrollY + canvasY,
  openLink: openLinkOutside,
});

/**
 * 组装完毕，显式画一帧。
 *
 * ⚠️ 不能删：引擎的 `addChild(component, markDirty)` 里是 `this.dirty = markDirty` ——
 * 传 `false` 不是"不置脏"，而是**把 dirty 赋成 false**，会清掉前面挂卡片时置上的待渲染标记。
 * 引擎又是"空闲停帧"的（dirty 被消费、又没有动画，就停掉 rAF），
 * 于是最后一次挂载之后不会再有帧：画面停在空白，控制台一个错都不报，点击命中也不会建。
 *
 * **两块画布各置一次**：导航栏是另一个 ICE 实例，它的置脏不会影响页面画布。
 */
page.ice.dirty = true;
navbar.page.ice.dirty = true;

/**
 * 调试 / e2e 句柄。
 * 给的是**世界坐标**而不是卡片局部坐标 —— e2e 点卡片必须点画布真实位置，
 * 背像素的测试会在换版面时静默失效。
 */
(window as any).__gameHome = {
  ice: page.ice,
  groups: GROUPS,
  pages: PAGES,
  nodes,
  worldRect: page.worldRect,
  find: page.find,
  goto,
  size: { width: CANVAS_WIDTH, height: canvas.height },
  cardHeight: CARD_HEIGHT,
  missingCovers: missing,
  /** 吸顶导航（独立画布）：e2e 拿它断言锚点、外链与高亮。 */
  navbar: {
    handle: navbar,
    size: { width: navbar.width, height: navbar.height },
    /**
     * **有意的画布出血量**（= 导航条的圆角半径）。
     *
     * 背景条故意上移 `radius` 像素，让顶部两个角变成方角（圆角部分被画布裁掉）、
     * 底部保持圆角 —— `ICEPanel` 只支持整体圆角，这是最省事的做法。
     * e2e 的版面体检要按这个数放行这块出血，所以**从页面暴露出来**，
     * 而不是让测试里写死一个 16（改导航圆角时会两边不一致）。
     */
    bleed: NAVBAR.radius,
    links: navbar.links,
    sections: navbar.sections,
    activeKey: () => navbar.activeKey,
    scrollToSection: (key: string) => navbar.scrollToSection(key),
    worldRect: (node: any) => navbar.page.worldRect(node),
    find: (id: string) => navbar.page.find(id),
    /** 把导航项滚到视野里（点它之前要保证它在视口内）。 */
    canvasTop: () => document.getElementById('navbar')!.getBoundingClientRect().top,
  },
  /** 页脚：链接清单供 e2e 断言"都在、地址都对"。 */
  footer: { links: footer.links, height: footer.height },
};
