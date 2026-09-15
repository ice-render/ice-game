/**
 * 游戏厅首页 —— 本工程唯一"自己写的非游戏页面"，把目录铺成网格。
 *
 * 它做三件事：① 从 `src/domain/catalog.ts` 取分组；② 按列宽自动换行铺卡片；
 * ③ 点卡片/按钮进对应页面。**加一个新游戏不需要改这个文件** —— 目录一变，这里自动多一张卡。
 *
 * 版面是**流式 + 网格**：纵向游标自上而下走，每个分组是"一栏卡片"，栏内按列数换行
 * （与 `ice-web-components/examples/gallery.html` 的 "clusters wrap like shelves" 同一思路）。
 * 所以卡片数量涨到几十张时不需要动布局代码，只需要页面能滚。
 *
 * 画布高度**按内容算**（不是写死的 800）：内容多高画布就多高，页面纵向滚动。
 * 这是"大量游戏"下的必然选择 —— 固定画布要么裁掉卡片，要么逼每张卡缩成一小条。
 */
import { ICEButton, ICELabel, ICEPanel } from 'ice-web-components';
import { GROUPS, PAGES, stats, type GamePage } from '../domain/catalog';
import { createPage, type GamePageHandle } from '../kit';

/* --------------------------------- 版面常量 --------------------------------- */

const CANVAS_WIDTH = 1180;
const PAD = 44;
const COLS = 3;
const GAP = 20;
const CARD_HEIGHT = 180;
const HEADER_HEIGHT = 132;
const GROUP_HEADER_HEIGHT = 52;
const GROUP_GAP = 18;
/** 最小画布高度：内容少时不至于挤成一条，也不至于留下大片空白。 */
const MIN_CANVAS_HEIGHT = 620;

const CARD_WIDTH = Math.floor((CANVAS_WIDTH - PAD * 2 - GAP * (COLS - 1)) / COLS);

/** chip 宽度估算：CJK 一字约 1em，ASCII 约 0.58em，再加左右内边距。 */
function chipWidth(text: string, fontSize = 12): number {
  let width = 0;
  for (const ch of text) width += /[\u4e00-\u9fa5\uff00-\uffef]/.test(ch) ? fontSize : fontSize * 0.58;
  return Math.ceil(width) + 20;
}

/**
 * 画布高度 = 头部 + 各分组 + 底部留白。
 * 先算高度、写进 canvas 属性，**再**建引擎 —— 引擎初始化时读的就是这个尺寸
 * （顺序反了会拿到旧的 800 高，下面的卡片全被裁掉）。
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
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD,
    top: PAD,
    width: CANVAS_WIDTH - PAD * 2 - 260,
    text: 'ICE GAME',
    style: { fontSize: 30, fontWeight: '700', fillStyle: theme.colors.text },
  }),
);
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD,
    top: PAD + 46,
    width: CANVAS_WIDTH - PAD * 2,
    text: '画布游戏厅 —— 机壳、按钮、方块、连扫雷的雷区，全是引擎画出来的，没有一个位图资源',
    style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
  }),
);
/** 规模数字取自目录，不手写 —— 加了游戏忘了改这里是做不到的。 */
page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: CANVAS_WIDTH - PAD - 260,
    top: PAD + 10,
    width: 260,
    align: 'right',
    text: `${games} 个小游戏 · ${machines} 台整机 · ${features} 项可玩`,
    style: { fontSize: 13, fillStyle: theme.colors.textTertiary },
  }),
);

/* --------------------------------- 分组与卡片 --------------------------------- */

interface CardNodes {
  card: any;
  button: any;
}

const nodes: Record<string, CardNodes> = {};

/** 一行 chip：整机显示内含物，小游戏显示按键。 */
function renderChips(card: any, game: GamePage, top: number): void {
  const source =
    game.features.length > 0
      ? game.features.slice(0, 3).concat(game.features.length > 3 ? [`+${game.features.length - 3}`] : [])
      : game.controls.slice(0, 3).map(([keys]) => keys);
  let left = 22;
  for (const text of source) {
    const width = chipWidth(text);
    if (left + width > CARD_WIDTH - 22) break; // 放不下就不再放（宁可少一个 chip，也不越界）
    card.addChild(
      new ICEPanel({
        interactive: false,
        left,
        top,
        width,
        height: 24,
        radius: 6,
        style: { fillStyle: theme.colors.elevated, strokeStyle: theme.colors.borderSecondary },
      }),
      false,
    );
    card.addChild(
      new ICELabel({
        interactive: false,
        left,
        top,
        width,
        height: 24,
        align: 'center',
        verticalAlign: 'middle',
        text,
        style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
      }),
      false,
    );
    left += width + 6;
  }
}

function buildCard(game: GamePage, left: number, top: number): CardNodes {
  const card = new ICEPanel({
    id: `game-card-${game.slug}`,
    left,
    top,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    radius: 12,
    style: { fillStyle: theme.colors.surface, strokeStyle: theme.colors.border },
  });
  // 整张卡片可点（不只按钮）—— 卡片是最自然的点击目标
  card.on('click', () => goto(game.page));
  page.ice.addChild(card);

  /**
   * 左侧 4px 竖条：卡片主色，一眼区分不同游戏。
   * 描边必须给成和填充同色：`ICEPanel` 内部把 `stroke` 写死为 `true`（props 覆盖不了），
   * 而 `lineWidth: 0` 是**非法值会被忽略**，留着默认宽度就会多出一圈描边。
   */
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: 0,
      top: 0,
      width: 4,
      height: CARD_HEIGHT,
      radius: 2,
      style: { fillStyle: game.accent, strokeStyle: game.accent },
    }),
    false,
  );

  card.addChild(
    new ICELabel({
      interactive: false,
      left: 22,
      top: 20,
      width: CARD_WIDTH - 44 - 60,
      text: game.title,
      style: { fontSize: 19, fontWeight: '700', fillStyle: theme.colors.text },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: 22,
      top: 50,
      width: CARD_WIDTH - 44,
      text: game.tagline,
      style: { fontSize: 12.5, fillStyle: theme.colors.textSecondary },
    }),
    false,
  );
  renderChips(card, game, 84);

  const button = new ICEButton({
    id: `game-enter-${game.slug}`,
    left: 22,
    top: CARD_HEIGHT - 58,
    width: 108,
    height: 38,
    text: '进入',
    radius: 8,
    style: { fillStyle: game.accent, strokeStyle: game.accent },
  });
  // 按钮点击走事件（构造函数不吃 `onClick`；`ICESegmented` 那类才走构造参数）
  button.on('click', () => goto(game.page));
  card.addChild(button, false);

  // 右上角徽标：整机 / 小游戏
  const badgeText = game.kind === 'machine' ? '整机' : '小游戏';
  const badgeWidth = 46;
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: CARD_WIDTH - 22 - badgeWidth,
      top: 22,
      width: badgeWidth,
      height: 20,
      radius: 10,
      style: { fillStyle: theme.colors.background, strokeStyle: theme.colors.borderSecondary },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: CARD_WIDTH - 22 - badgeWidth,
      top: 22,
      width: badgeWidth,
      height: 20,
      align: 'center',
      verticalAlign: 'middle',
      text: badgeText,
      style: { fontSize: 11, fillStyle: theme.colors.textTertiary },
    }),
    false,
  );

  return { card, button };
}

let cursorY = PAD + HEADER_HEIGHT;

for (const group of GROUPS) {
  page.ice.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: cursorY,
      width: 110,
      text: group.label,
      style: { fontSize: 17, fontWeight: '700', fillStyle: theme.colors.text },
    }),
  );
  page.ice.addChild(
    new ICELabel({
      interactive: false,
      left: PAD + 110,
      top: cursorY + 5,
      width: CANVAS_WIDTH - PAD * 2 - 110,
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

page.ice.addChild(
  new ICELabel({
    interactive: false,
    left: PAD,
    top: cursorY + 6,
    width: CANVAS_WIDTH - PAD * 2,
    text: '每个页面各自独占整屏与键盘：进去之后按浏览器「后退」回到这里',
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
};
