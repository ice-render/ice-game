/**
 * 游戏厅首页 —— 本工程唯一"自己写的非游戏页面"，把目录铺成**带封面的卡片网格**。
 *
 * 三件事：① 从 `src/domain/catalog.ts` 取分组；② 按列宽自动换行铺卡片；
 * ③ 点卡片/按钮进对应页面。**加一个新游戏不需要改这个文件**。
 *
 * ## 版面形态
 *
 * 卡片以**封面图**为主体（`npm run covers` 自动抓的真实画面），下面是标题、一句话说明、
 * 按键提示与「进入」按钮。没有封面时画一个 accent 色调的占位块 —— 不至于开天窗，
 * 也一眼看得出"这个游戏还没抓封面"。
 *
 * 圆角是**烘在 PNG 里**的：引擎的 `ICEImage` 不支持圆角裁剪（`clipType` 只有 `circle`），
 * 面板也不裁剪子节点，所以圆角只能在生成封面时用离屏画布的 `clip()` 裁好。
 *
 * 画布高度**按内容算**（不是写死的 800）：内容多高画布就多高，页面纵向滚动 ——
 * 这是"大量游戏"下的必然选择，固定画布要么裁卡片、要么逼每张卡缩成一条。
 */
import { ICEImage } from 'ice-render';
import { ICEButton, ICELabel, ICEPanel } from 'ice-web-components';
import { GROUPS, PAGES, coverUrl, pagesMissingCover, stats, type GamePage } from '../domain/catalog';
import { createPage, type GamePageHandle } from '../kit';

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
 * 画布高度 = 头部 + 各分组 + 底部留白。
 * 先算高度、写进 canvas 属性，**再**建引擎 —— 引擎初始化时读的就是这个尺寸
 * （顺序反了会拿到旧的初始高度，下面的卡片全被裁掉）。
 */
function measureCanvasHeight(): number {
  let height = PAD + HEADER_HEIGHT;
  for (const group of GROUPS) {
    const rows = Math.ceil(group.items.length / COLS);
    height += GROUP_HEADER_HEIGHT + rows * CARD_HEIGHT + (rows - 1) * GAP + GROUP_GAP;
  }
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

/* --------------------------------- 头部 --------------------------------- */

const { games, machines, features } = stats();

/** 头部左侧的品牌竖条：让"游戏厅"比一行标题更有存在感。 */
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
    text: 'ICE GAME',
    style: { fontSize: 32, fontWeight: '700', fillStyle: theme.colors.text },
  }),
);
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD + 18,
    top: PAD + 48,
    width: CANVAS_WIDTH - PAD * 2 - 300,
    text: '画布游戏厅 —— 连卡片封面都是自动抓的真实画面，没有一张手工准备的图',
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

/**
 * 组装完毕，显式画一帧。
 *
 * ⚠️ 不能删：引擎的 `addChild(component, markDirty)` 里是 `this.dirty = markDirty` ——
 * 传 `false` 不是"不置脏"，而是**把 dirty 赋成 false**，会清掉前面挂卡片时置上的待渲染标记。
 * 引擎又是"空闲停帧"的（dirty 被消费、又没有动画，就停掉 rAF），
 * 于是最后一次挂载之后不会再有帧：画面停在空白，控制台一个错都不报，点击命中也不会建。
 */
page.ice.dirty = true;

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
};
