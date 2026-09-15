/**
 * 游戏厅首页 —— 本工程唯一"自己写的"页面（另外两个页面是从上游逐字抽取的）。
 *
 * 它只做一件事：把 `src/domain/game-catalog.ts` 里的目录铺成两张卡片，点进去就是那台机器。
 * 首页与游戏页共用引擎，所以它是本仓的**集成冒烟**：这里能画出来，说明 webpack 的 alias
 * 钉对了、引擎与组件库是同一份实例。
 *
 * 版面一律由常量 + 栈式排布算出，不手写坐标：
 * 卡片内所有子节点都是**卡片局部坐标**（`left: 28, top: …`），因为卡片自己已经在绝对位置上。
 */
import { ICE, ICEBoxLayout } from 'ice-render';
import {
  ICE_ARCADE_THEME,
  ICEButton,
  ICEHoverManager,
  ICELabel,
  ICEPanel,
  ICEWidget,
  getICEFocusManager,
  iceUIManager,
} from 'ice-web-components';
import { GAMES, catalogSize, type GameEntry } from '../domain/game-catalog';

/* --------------------------------- 版面常量 --------------------------------- */

/** 设计尺寸：与掌机页同宽，窗口小了整页裁切（演示页，不做响应式重排）。 */
const CANVAS = { width: 1180, height: 760 };
const SHELL = { left: 24, top: 24, width: 1132, height: 712 };
/** 卡片区左右各留 40，两张卡片夹 28 的缝 —— 全部由这三个数推出来，不出现第三个魔数。 */
const INNER_PAD = 40;
const CARD_GAP = 28;
const CARD = {
  top: 164,
  width: (SHELL.width - INNER_PAD * 2 - CARD_GAP) / 2,
  height: 496,
};
/** 卡片内缩与行距：卡片内是局部坐标，起点就是内缩量。 */
const PAD = 28;
const ITEMS_TOP = 122;
const ITEM_COLS = 2;
const ITEM_ROW_H = 28;
const ITEM_H = 24;
const CONTROLS_TOP = 280;
const CONTROL_ROW_H = 24;

const ice = new ICE().init('canvas', { dpr: (typeof window !== 'undefined' && window.devicePixelRatio) || 1 });
iceUIManager.registerTheme('arcade', ICE_ARCADE_THEME).setTheme('arcade', ice);
const theme = iceUIManager.getTheme();

new ICEHoverManager(ice).start();
getICEFocusManager(ice).start();

/* --------------------------------- 工具 --------------------------------- */

const goto = (page: string) => {
  window.location.href = page;
};

/**
 * 累加 `left/top` 得到世界坐标（相对画布）。
 * 终止条件是 `cursor.state` 而不是 `cursor`：`ICE` 实例本身没有 `state`，
 * `while (cursor) { …; cursor = cursor.parentNode }` 到根上会读到 `state.left` 而崩。
 */
function worldRect(node: any): { left: number; top: number; width: number; height: number } {
  let left = 0;
  let top = 0;
  let cursor = node;
  while (cursor && cursor.state) {
    left += cursor.state.left || 0;
    top += cursor.state.top || 0;
    cursor = cursor.parentNode;
  }
  return { left, top, width: node.state.width || 0, height: node.state.height || 0 };
}

/** 一行说明。`width` 必须给：不给的话对齐无从谈起。 */
function line(text: string, left: number, top: number, width: number, style: any) {
  return new ICELabel({ interactive: false, left, top, width, text, style });
}

/* --------------------------------- 外壳 --------------------------------- */

const shell = new ICEPanel({
  id: 'game-home-shell',
  left: SHELL.left,
  top: SHELL.top,
  width: SHELL.width,
  height: SHELL.height,
  radius: 14,
  interactive: false,
  style: { fillStyle: theme.colors.background, strokeStyle: theme.colors.border, lineWidth: 1 },
});
ice.addChild(shell);

const { machines, items } = catalogSize();
const headerTop = SHELL.top + 32;
ice.addChild(
  line('ICE GAME', SHELL.left + INNER_PAD, headerTop, 520, {
    fontSize: 30,
    fontWeight: '700',
    fillStyle: theme.colors.text,
  }),
);
ice.addChild(
  line(
    '画布游戏厅 —— 机壳、按钮、方块、连扫雷的雷区，全是引擎画出来的，没有一个位图资源',
    SHELL.left + INNER_PAD,
    headerTop + 44,
    720,
    { fontSize: 13, fillStyle: theme.colors.textSecondary },
  ),
);
/** 规模数字取自目录，不手写 —— 加了机器忘了改这里是不可能的。 */
ice.addChild(
  line(`${machines} 台机器 · ${items} 项可玩`, SHELL.left + SHELL.width - INNER_PAD - 240, headerTop + 8, 240, {
    fontSize: 13,
    fillStyle: theme.colors.textTertiary,
    textAlign: 'right',
  }),
);
ice.addChild(
  line(
    '两个页面各自独占整屏与键盘：进去之后按浏览器「后退」回到这里',
    SHELL.left + INNER_PAD,
    SHELL.top + SHELL.height - 40,
    720,
    { fontSize: 12, fillStyle: theme.colors.textTertiary },
  ),
);

/* --------------------------------- 卡片 --------------------------------- */

/** 小游戏 / 程序：两列圆角芯片，行高固定，列宽由卡片内宽推出来。 */
function renderItems(card: any, game: GameEntry) {
  const colWidth = (CARD.width - PAD * 2) / ITEM_COLS;
  game.items.forEach((name, index) => {
    const col = index % ITEM_COLS;
    const row = Math.floor(index / ITEM_COLS);
    const left = PAD + col * colWidth;
    const top = ITEMS_TOP + row * ITEM_ROW_H;
    card.addChild(
      new ICEPanel({
        interactive: false,
        left,
        top,
        width: colWidth - 8,
        height: ITEM_H,
        radius: 6,
        style: { fillStyle: theme.colors.surface, strokeStyle: theme.colors.borderSecondary, lineWidth: 1 },
      }),
      false,
    );
    card.addChild(
      new ICELabel({
        interactive: false,
        left,
        top,
        width: colWidth - 8,
        height: ITEM_H,
        text: name,
        align: 'center',
        verticalAlign: 'middle',
        style: { fontSize: 12, fillStyle: theme.colors.textSecondary },
      }),
      false,
    );
  });
}

/** 操作说明：左列按键（等宽字体）+ 右列作用。行容器走 BoxLayout，不手算 x。 */
function renderControls(card: any, game: GameEntry) {
  const KEY_W = 104;
  const rows = new ICEWidget({
    left: PAD,
    top: CONTROLS_TOP,
    width: CARD.width - PAD * 2,
    height: CONTROL_ROW_H * game.controls.length,
    fill: false,
    stroke: false,
    interactive: false,
  });
  rows.setLayout(new ICEBoxLayout({ axis: 'y', gap: 0 }));
  game.controls.forEach(([keys, desc]) => {
    const row = new ICEWidget({
      width: CARD.width - PAD * 2,
      height: CONTROL_ROW_H,
      fill: false,
      stroke: false,
      interactive: false,
    });
    row.setLayout(new ICEBoxLayout({ axis: 'x', gap: 10 }));
    row.addChild(
      new ICELabel({
        interactive: false,
        width: KEY_W,
        height: CONTROL_ROW_H,
        text: keys,
        style: { fontSize: 12.5, fontFamily: '"Courier New", monospace', fillStyle: theme.colors.text },
      }),
      false,
    );
    row.addChild(
      new ICELabel({
        interactive: false,
        width: CARD.width - PAD * 2 - KEY_W - 10,
        height: CONTROL_ROW_H,
        text: desc,
        style: { fontSize: 12.5, fillStyle: theme.colors.textSecondary },
      }),
      false,
    );
    rows.addChild(row, false);
  });
  card.addChild(rows, false);
}

const nodes: Record<string, { card: any; button: any }> = {};

GAMES.forEach((game, index) => {
  const left = SHELL.left + INNER_PAD + index * (CARD.width + CARD_GAP);
  const card = new ICEPanel({
    id: `game-card-${game.key}`,
    left,
    top: CARD.top,
    width: CARD.width,
    height: CARD.height,
    radius: 12,
    style: { fillStyle: theme.colors.surface, strokeStyle: theme.colors.border, lineWidth: 1 },
  });
  // 整张卡片可点（不只按钮）—— 卡片是最自然的点击目标
  card.on('click', () => goto(game.page));
  ice.addChild(card);

  /**
   * 左侧 4px 竖条：卡片主色，一眼区分两台机器。
   * 描边一定要给成和填充同色：`ICEPanel` 内部把 `stroke` 写死为 `true`（props 覆盖不了），
   * 而画布的 `lineWidth: 0` 是**非法值会被忽略**、不是"不画"—— 留着默认宽度就会多出一圈描边。
   */
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: 0,
      top: 0,
      width: 4,
      height: CARD.height,
      radius: 2,
      style: { fillStyle: game.accent, strokeStyle: game.accent },
    }),
    false,
  );

  card.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: 26,
      width: CARD.width - PAD * 2,
      text: game.title,
      style: { fontSize: 22, fontWeight: '700', fillStyle: theme.colors.text },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: 60,
      width: CARD.width - PAD * 2,
      text: game.tagline,
      style: { fontSize: 13, fillStyle: theme.colors.textSecondary },
    }),
    false,
  );
  card.addChild(
    new ICEPanel({
      interactive: false,
      left: PAD,
      top: 90,
      width: CARD.width - PAD * 2,
      height: 1,
      // 同上：描边与填充同色，否则这条 1px 分隔线会顶着一圈默认描边
      style: { fillStyle: theme.colors.borderSecondary, strokeStyle: theme.colors.borderSecondary },
    }),
    false,
  );
  card.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: 102,
      width: 200,
      text: '内含',
      style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
    }),
    false,
  );
  renderItems(card, game);
  card.addChild(
    new ICELabel({
      interactive: false,
      left: PAD,
      top: 260,
      width: 200,
      text: '操作',
      style: { fontSize: 12, fillStyle: theme.colors.textTertiary },
    }),
    false,
  );
  renderControls(card, game);

  const button = new ICEButton({
    id: `game-enter-${game.key}`,
    left: PAD,
    top: CARD.height - PAD - 46,
    width: 150,
    height: 46,
    text: '进入',
    radius: 8,
    style: { fillStyle: game.accent, strokeStyle: game.accent },
  });
  // 按钮的点击走事件（构造函数不吃 `onClick`；`ICESegmented` 那类才走构造参数）
  button.on('click', () => goto(game.page));
  card.addChild(button, false);

  nodes[game.key] = { card, button };
});

/**
 * 组装完毕，显式画一帧。
 *
 * ⚠️ 这一行不能删，删了首页就是**一张空白画布**（而且控制台一个错都不报）：
 * 引擎的 `addChild(component, markDirty = true)` 里是 `this.dirty = markDirty` ——
 * 传 `false` 不是"不置脏"，而是**把 dirty 赋成 false**，会清掉前面 `ice.addChild(card)`
 * 置上的待渲染标记。引擎又是"空闲停帧"的（dirty 被消费、又没有动画，就停掉 rAF 循环），
 * 于是最后一次改动之后不会再有帧：画面停在最初的空帧，连点击命中缓存都不会建。
 *
 * 上游两个游戏页没踩这个坑，是因为它们**最后一步总是 `ice.addChild(...)`**（默认 markDirty=true）。
 * 本页最后几次挂载都是 `card.addChild(node, false)`（组件库容器里 `false` 是常规写法），
 * 所以收尾必须补这一句。
 */
ice.dirty = true;

/**
 * 调试 / e2e 句柄：对齐上游示例的 `window.__result` 套路。
 * 给的是**世界坐标**而不是卡片局部坐标 —— e2e 点卡片时必须点画布真实位置，
 * 背像素的测试会在换版面时静默失效。
 */
(window as any).__gameHome = {
  ice,
  games: GAMES,
  nodes,
  worldRect,
  goto,
  size: CANVAS,
};
